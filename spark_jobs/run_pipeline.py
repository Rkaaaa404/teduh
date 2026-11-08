"""COMMUTE-COOL Smart Unified Big Data Pipeline Orchestrator.

Upgrades over legacy pipeline:
1. Smart Idempotency: Automatically skips Overpass re-download, destructive DB wipe,
   and slow pgRouting rebuild when Surabaya OSM base geometry is already loaded
   (pass `--force-osm` to force a fresh OSM reload).
2. Single Shared SparkSession (`local[2]`, `1g` heap, `8` shuffle partitions):
   Eliminates 7 sequential JVM startups & keeps laptop CPU/RAM cool.
3. Zero-Downtime Serving Sync: Updates `segment_live_comfort` atomically so the
   frontend map & routing engine never experience empty tables during runs.
"""
from __future__ import annotations

import os
import sys
import time
import traceback
from datetime import datetime, timezone, timedelta

sys.path.insert(0, "/app")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

WIB = timezone(timedelta(hours=7))


def wait_for_db(max_retries: int = 30, delay: int = 2) -> bool:
    import psycopg2
    db_url = os.getenv("DATABASE_URL", "postgresql://cc_user:cc_dev_pass@postgres:5432/commute_cool")
    for i in range(max_retries):
        try:
            conn = psycopg2.connect(db_url)
            conn.close()
            print(f"[Pipeline] Database ready (attempt {i + 1})")
            return True
        except Exception:
            if i < max_retries - 1:
                time.sleep(delay)
    print("[Pipeline] ERROR: Database not available after retries")
    return False


def ensure_serving_schema() -> None:
    """Apply idempotent `optimize_serving.sql` functions & indexes if missing."""
    import psycopg2
    db_url = os.getenv("DATABASE_URL", "postgresql://cc_user:cc_dev_pass@postgres:5432/commute_cool")
    sql_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "database",
        "optimize_serving.sql",
    )
    if not os.path.exists(sql_path):
        return
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    try:
        with open(sql_path, "r", encoding="utf-8") as f:
            cur.execute(f.read())
        conn.commit()
    finally:
        cur.close()
        conn.close()


def step_1_ingest_apis(force_osm: bool = False) -> float:
    """Fetch live weather, AQI, and traffic; fetch OSM only if DB is empty or `--force-osm`."""
    print("\n" + "=" * 60)
    print("STEP 1: Ingestion - Fetch Real Environmental APIs")
    print("=" * 60)

    air_temp = 32.0
    try:
        from ingestion.weather_collector import fetch_current_weather
        weather = fetch_current_weather()
        air_temp = float(weather.get("current", {}).get("temperature_2m", 32.0))
        print(f"  ✓ Weather: {air_temp}°C")
    except Exception as e:
        print(f"  ✗ Weather fetch failed: {e}")

    try:
        from ingestion.aqi_collector import fetch_aqi
        aqi = fetch_aqi()
        if aqi:
            print(f"  ✓ AQI: {aqi.get('aqi', 'N/A')}")
        else:
            print("  ⚠ AQI: No API token, using baseline")
    except Exception as e:
        print(f"  ✗ AQI fetch failed: {e}")

    try:
        from ingestion.traffic_collector import fetch_all_traffic
        traffic = fetch_all_traffic()
        print(f"  ✓ Traffic: {len(traffic)} measurement points")
    except Exception as e:
        print(f"  ✗ Traffic fetch failed: {e}")

    from ingestion.osm_loader import is_osm_already_populated
    if not force_osm and is_osm_already_populated():
        print("  ✓ OSM Geometry already populated in PostGIS -> skipping Overpass download!")
    else:
        try:
            from ingestion.osm_fetcher import fetch_all
            osm_paths = fetch_all()
            print(f"  ✓ OSM Data downloaded: {list(osm_paths.values())}")
        except Exception as e:
            print(f"  ✗ OSM fetch failed: {e}")

    return air_temp


def step_1_5_upload_to_hdfs_bronze(spark) -> None:
    """Upload ingested raw JSON files to HDFS Bronze layer if HDFS is enabled."""
    from spark_jobs.config import BRONZE_DIR, RAW_DATA_DIR, HDFS_ENABLED
    if not HDFS_ENABLED:
        print("\n[Bronze] HDFS_NAMENODE unset -> using local Bronze cache.")
        return

    print("\n" + "=" * 60)
    print("STEP 1.5: Sync Raw Data to HDFS Bronze Layer")
    print("=" * 60)

    for cat in ("weather", "aqi", "traffic"):
        local_path = os.path.join(RAW_DATA_DIR, cat)
        hdfs_path = f"{BRONZE_DIR}/{cat}"
        if os.path.exists(local_path) and os.listdir(local_path):
            df = spark.read.text(f"file://{os.path.abspath(local_path)}/*.json")
            for attempt in range(12):
                try:
                    df.write.mode("overwrite").text(hdfs_path)
                    print(f"  ✓ Synced {cat} -> {hdfs_path}")
                    break
                except Exception as exc:
                    err_str = str(exc)
                    if attempt < 11 and ("SafeMode" in err_str or "ConnectException" in err_str):
                        print(f"  ⏳ HDFS SafeMode warming up (attempt {attempt + 1}/12), waiting 3s...")
                        time.sleep(3)
                        continue
                    print(f"  ⚠ HDFS Bronze sync warning for {cat}: {exc}")
                    break


def step_2_load_osm_idempotent(force_osm: bool = False) -> None:
    """Load OSM into PostGIS & build pgRouting topology ONLY when needed."""
    print("\n" + "=" * 60)
    print("STEP 2: Verify / Load PostGIS Spatial Network & Context")
    print("=" * 60)

    from ingestion.osm_loader import is_osm_already_populated, load_all, ensure_spatial_context

    already_ready = (not force_osm) and is_osm_already_populated()
    load_all(force=force_osm)

    if already_ready:
        print("  ✓ pgRouting topology already active -> skipping rebuild!")
        return

    print("  Building pgRouting network topology...")
    import psycopg2
    db_url = os.getenv("DATABASE_URL", "postgresql://cc_user:cc_dev_pass@postgres:5432/commute_cool")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    try:
        cur.execute("SELECT build_routing_topology();")
        conn.commit()
        cur.execute("SELECT COUNT(*) FROM segments_noded_vertices_pgr;")
        node_count = cur.fetchone()[0]
        print(f"  ✓ Topology built: {node_count} vertices")
    except Exception as e:
        conn.rollback()
        print(f"  ✗ Topology build failed: {e}")
    finally:
        cur.close()
        conn.close()

    ensure_spatial_context(force_rebuild=False)


def main():
    start_time = time.perf_counter()
    force_osm = "--force-osm" in sys.argv
    now_wib = datetime.now(WIB)

    print("╔════════════════════════════════════════════════════════════╗")
    print("║   TEDUH / COMMUTE-COOL Smart Big Data Pipeline v2          ║")
    print("║   1x Shared SparkSession (local[2]) + PostGIS Serving      ║")
    print(f"║   {now_wib.strftime('%Y-%m-%d %H:%M:%S WIB')}                            ║")
    print("╚════════════════════════════════════════════════════════════╝")

    if not wait_for_db():
        sys.exit(1)

    ensure_serving_schema()
    air_temp = step_1_ingest_apis(force_osm=force_osm)
    step_2_load_osm_idempotent(force_osm=force_osm)

    from spark_jobs.session import get_or_create_spark, stop_shared_spark
    spark = get_or_create_spark("CommuteCool_UnifiedPipeline", enable_sedona=True)

    try:
        step_1_5_upload_to_hdfs_bronze(spark)

        try:
            from spark_jobs.job_raster_segment import run as run_raster
            run_raster(air_temp=air_temp, spark=spark)
        except Exception as e:
            print(f"  [Fallback] Job 1 error: {e}")
            traceback.print_exc()

        try:
            from spark_jobs.job_shadow_model import run as run_shadow
            run_shadow(target_date=now_wib.date(), spark=spark)
        except Exception as e:
            print(f"  [Fallback] Job 2 error: {e}")
            traceback.print_exc()

        try:
            from spark_jobs.job_traffic_aqi import run as run_traffic
            run_traffic(spark=spark)
        except Exception as e:
            print(f"  [Fallback] Job 4 error: {e}")
            traceback.print_exc()

        try:
            from spark_jobs.job_thermal_comfort import run as run_tcs
            run_tcs(hour=now_wib.hour, spark=spark)
        except Exception as e:
            print(f"  [Fallback] Job 3 error: {e}")
            traceback.print_exc()
            from ingestion.fast_refresh import run_fast_refresh
            run_fast_refresh(skip_external_http=True)

        try:
            from spark_jobs.job_graph_weight import run as run_weights
            run_weights(spark=spark)
        except Exception as e:
            print(f"  [Fallback] Job 5 error: {e}")
            traceback.print_exc()

        try:
            from spark_jobs.job_tcs_predictor import train_and_simulate
            train_and_simulate(spark=spark)
        except Exception as e:
            print(f"  [Fallback] Job 6 error: {e}")
            traceback.print_exc()

    finally:
        stop_shared_spark()

    elapsed = time.perf_counter() - start_time
    print("\n" + "=" * 60)
    print(f"✓ Unified Pipeline complete in {elapsed:.1f}s")
    print("=" * 60)
    sys.exit(0)


if __name__ == "__main__":
    main()
