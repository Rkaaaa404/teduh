"""Spark Job 3: Thermal Comfort Score Calculation (Pure Catalyst Vectorized).

Optimized Architecture:
- Reuses shared SparkSession (`spark_jobs.session`)
- Replaces row-by-row Python `@udf` with 100% native JVM Catalyst expressions
- Handles nighttime WIB hours cleanly (when solar hour < 6 or > 17)
- Atomically syncs `segment_live_comfort` in PostGIS for O(1) API serving
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone, timedelta
import psycopg2

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import col, lit, when, least, greatest, coalesce, current_timestamp

from spark_jobs.config import (
    JDBC_URL,
    JDBC_PROPS,
    RAW_DATA_DIR,
    BRONZE_DIR,
    GOLD_DIR,
    HDFS_ENABLED,
    DB_USER,
    DB_PASS,
    DB_HOST,
    DB_PORT,
    DB_NAME,
)
from spark_jobs.session import get_or_create_spark

WIB = timezone(timedelta(hours=7))


def _load_raster_scores(spark: SparkSession) -> DataFrame:
    gold_path = f"{GOLD_DIR}/segment_raster_scores"
    try:
        return spark.read.parquet(gold_path).select("segment_id", "avg_ndvi", "avg_lst")
    except Exception:
        query = """
        (SELECT DISTINCT ON (segment_id) segment_id, avg_ndvi, avg_lst
         FROM segment_raster_scores
         ORDER BY segment_id, computed_at DESC) AS latest_raster
        """
        return spark.read.jdbc(JDBC_URL, query, properties=JDBC_PROPS)


def _load_shadow_scores(spark: SparkSession, hour: int) -> DataFrame:
    if hour < 6 or hour > 17:
        # Nighttime in Surabaya: zero direct solar radiation -> high relief (0.85 equivalent)
        return (
            spark.read.jdbc(JDBC_URL, "(SELECT segment_id FROM segments) AS s_ids", properties=JDBC_PROPS)
            .withColumn("shade_ratio", lit(0.85))
        )

    gold_path = f"{GOLD_DIR}/segment_shadows/hour_of_day={hour}"
    try:
        return spark.read.parquet(gold_path).select("segment_id", "shade_ratio")
    except Exception:
        query = f"""
        (SELECT DISTINCT ON (segment_id) segment_id, shade_ratio
         FROM segment_shadows
         WHERE hour_of_day = {int(hour)}
         ORDER BY segment_id, computed_at DESC) AS latest_shadow
        """
        return spark.read.jdbc(JDBC_URL, query, properties=JDBC_PROPS)


def _load_traffic_aqi_df(spark: SparkSession) -> DataFrame | None:
    gold_path = f"{GOLD_DIR}/segment_traffic_aqi"
    try:
        return spark.read.parquet(gold_path).select("segment_id", "congestion_ratio", "aqi_value")
    except Exception:
        return None


def _get_current_weather(spark: SparkSession) -> dict:
    if HDFS_ENABLED:
        try:
            rows = spark.read.text(f"{BRONZE_DIR}/weather").collect()
            if rows:
                current = json.loads(rows[-1][0]).get("current", {})
                return {
                    "apparent_temperature": float(current.get("apparent_temperature", 33.0)),
                    "temperature_2m": float(current.get("temperature_2m", 32.0)),
                }
        except Exception:
            pass

    weather_dir = os.path.join(RAW_DATA_DIR, "weather")
    if os.path.exists(weather_dir):
        files = sorted([f for f in os.listdir(weather_dir) if f.startswith("weather_")], reverse=True)
        if files:
            with open(os.path.join(weather_dir, files[0]), "r", encoding="utf-8") as f:
                current = json.load(f).get("current", {})
            return {
                "apparent_temperature": float(current.get("apparent_temperature", 33.0)),
                "temperature_2m": float(current.get("temperature_2m", 32.0)),
            }
    return {"apparent_temperature": 33.0, "temperature_2m": 32.0}


def _get_fallback_aqi_and_traffic() -> tuple[float, float]:
    aqi_val = 50.0
    aqi_dir = os.path.join(RAW_DATA_DIR, "aqi")
    if os.path.exists(aqi_dir):
        files = sorted([f for f in os.listdir(aqi_dir) if f.startswith("aqi_")], reverse=True)
        if files:
            with open(os.path.join(aqi_dir, files[0]), "r", encoding="utf-8") as f:
                aqi_val = float(json.load(f).get("aqi", 50.0))

    traffic_val = 0.30
    traffic_dir = os.path.join(RAW_DATA_DIR, "traffic")
    if os.path.exists(traffic_dir):
        files = sorted([f for f in os.listdir(traffic_dir) if f.startswith("traffic_")], reverse=True)
        if files:
            with open(os.path.join(traffic_dir, files[0]), "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and data:
                ratios = [float(d.get("congestion_ratio", 0.3)) for d in data if d.get("congestion_ratio") is not None]
                if ratios:
                    traffic_val = sum(ratios) / len(ratios)
    return aqi_val, traffic_val


def compute_thermal_comfort(spark: SparkSession, hour: int) -> DataFrame:
    """Compute TCS across all segments using 100% native Spark Catalyst expressions."""
    segments_df = spark.read.jdbc(
        JDBC_URL,
        "(SELECT segment_id, surface_type, smoothness FROM segments) AS seg_base",
        properties=JDBC_PROPS,
    )
    raster_df = _load_raster_scores(spark)
    shadow_df = _load_shadow_scores(spark, hour)
    traffic_aqi_df = _load_traffic_aqi_df(spark)

    weather = _get_current_weather(spark)
    apparent_temp = float(weather["apparent_temperature"])
    fb_aqi, fb_traffic = _get_fallback_aqi_and_traffic()

    joined = (
        segments_df
        .join(raster_df, "segment_id", "left")
        .join(shadow_df, "segment_id", "left")
    )
    if traffic_aqi_df is not None:
        joined = joined.join(traffic_aqi_df, "segment_id", "left")
    else:
        joined = (
            joined
            .withColumn("congestion_ratio", lit(fb_traffic))
            .withColumn("aqi_value", lit(fb_aqi))
        )

    shade_col = coalesce(col("shade_ratio"), lit(0.20))
    ndvi_col = coalesce(col("avg_ndvi"), lit(0.15))
    lst_col = coalesce(col("avg_lst"), lit(35.0))
    aqi_col = coalesce(col("aqi_value"), lit(fb_aqi))
    traffic_col = coalesce(col("congestion_ratio"), lit(fb_traffic))

    # Sub-scores (matching spark_jobs/utils/normalization.py 1-to-1)
    shade_score = least(lit(1.0), greatest(lit(0.0), lit(0.7) * shade_col + lit(0.3) * least(ndvi_col * lit(2.0), lit(1.0))))
    temp_combined = lit(0.6 * apparent_temp) + lit(0.4) * lst_col
    temp_score = least(lit(1.0), greatest(lit(0.0), lit(1.0) - ((temp_combined - lit(28.0)) / lit(17.0))))
    aqi_score = least(lit(1.0), greatest(lit(0.0), lit(1.0) - (aqi_col / lit(150.0))))
    traffic_score = least(lit(1.0), greatest(lit(0.0), lit(1.0) - traffic_col))

    s_score = (
        when(col("surface_type") == "asphalt", lit(0.90))
        .when(col("surface_type") == "paving_stones", lit(0.85))
        .when(col("surface_type") == "concrete", lit(0.80))
        .when(col("surface_type") == "concrete:plates", lit(0.75))
        .when(col("surface_type") == "sett", lit(0.70))
        .when(col("surface_type") == "compacted", lit(0.60))
        .when(col("surface_type") == "fine_gravel", lit(0.50))
        .when(col("surface_type").isin("gravel", "grass"), lit(0.40))
        .when(col("surface_type").isin("unpaved", "ground"), lit(0.30))
        .when(col("surface_type").isin("dirt", "sand"), lit(0.20))
        .otherwise(lit(0.50))
    )
    sm_score = (
        when(col("smoothness") == "excellent", lit(1.0))
        .when(col("smoothness") == "good", lit(0.8))
        .when(col("smoothness") == "intermediate", lit(0.6))
        .when(col("smoothness") == "bad", lit(0.3))
        .when(col("smoothness") == "very_bad", lit(0.1))
        .when(col("smoothness") == "horrible", lit(0.05))
        .otherwise(lit(0.5))
    )
    surface_score = lit(0.5) * s_score + lit(0.5) * sm_score

    tcs_col = least(
        lit(1.0),
        greatest(
            lit(0.0),
            lit(0.35) * shade_score
            + lit(0.30) * temp_score
            + lit(0.15) * aqi_score
            + lit(0.10) * traffic_score
            + lit(0.10) * surface_score,
        ),
    )

    return joined.select(
        col("segment_id"),
        tcs_col.cast("double").alias("tcs_value"),
        lit(apparent_temp).cast("double").alias("apparent_temp"),
        shade_col.cast("double").alias("shade_ratio"),
        aqi_col.cast("double").alias("aqi_value"),
        traffic_col.cast("double").alias("traffic_level"),
        current_timestamp().alias("computed_at"),
    )


def run(hour: int | None = None, spark: SparkSession | None = None):
    """Main entry point for Thermal Comfort Score job."""
    if hour is None:
        hour = datetime.now(WIB).hour

    print(f"=== Spark Job 3: Thermal Comfort Score (hour={hour:02d}:00 WIB) ===")
    own_session = spark is None
    if own_session:
        spark = get_or_create_spark("Teduh_ThermalComfort")

    try:
        result_df = compute_thermal_comfort(spark, hour).cache()
        count = result_df.count()
        print(f"  Computed TCS for {count} segments")

        gold_path = f"{GOLD_DIR}/thermal_comfort_scores"
        try:
            result_df.write.mode("overwrite").parquet(gold_path)
            print(f"  ✓ Written Gold Parquet: {gold_path}")
        except Exception as exc:
            print(f"  [Warning] Gold Parquet write skipped: {exc}")

        (
            result_df.coalesce(4)
            .write.mode("append")
            .jdbc(JDBC_URL, "thermal_comfort_scores", properties=JDBC_PROPS)
        )
        result_df.unpersist()

        # Synchronize fast O(1) serving table `segment_live_comfort` & prune stale rows
        db_url = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        try:
            cur.execute("SELECT sync_segment_live_comfort();")
            synced = cur.fetchone()[0]
            conn.commit()
            print(f"  ✓ Synced segment_live_comfort ({synced} rows)")
        finally:
            cur.close()
            conn.close()
    finally:
        if own_session and spark is not None:
            spark.stop()


if __name__ == "__main__":
    run()
