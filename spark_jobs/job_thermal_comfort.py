"""Spark Job 3: Thermal Comfort Score Calculation (Pure Catalyst Vectorized).

Optimized Architecture:
- Reuses shared SparkSession (`spark_jobs.session`)
- Replaces row-by-row Python `@udf` with 100% native JVM Catalyst expressions
- Handles nighttime WIB hours cleanly (when solar hour < 6 or > 17)
- Atomically syncs `segment_live_comfort` in PostGIS for O(1) API serving
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import psycopg2

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import col, lit, least, greatest, current_timestamp

from spark_jobs.config import (
    JDBC_URL,
    JDBC_PROPS,
    GOLD_DIR,
    DB_USER,
    DB_PASS,
    DB_HOST,
    DB_PORT,
    DB_NAME,
)
from spark_jobs.live_inputs import require_current_weather
from spark_jobs.session import get_or_create_spark
from spark_jobs.utils.catalyst import lookup_expr
from spark_jobs.utils.normalization import (
    DEFAULT_SMOOTHNESS_SCORE,
    DEFAULT_SURFACE_SCORE,
    SMOOTHNESS_SCORES,
    SURFACE_SCORES,
)

WIB = timezone(timedelta(hours=7))
NIGHT_SHADE_RATIO = 0.85  # TCS relief when there is no direct sun, shared with fast_refresh


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
            .withColumn("shade_ratio", lit(NIGHT_SHADE_RATIO))
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


def _load_traffic_aqi_df(spark: SparkSession) -> DataFrame:
    """Per-segment traffic and AQI from Job 4 (Gold Parquet, else its staging table)."""
    columns = ("segment_id", "congestion_ratio", "aqi_value")
    try:
        return spark.read.parquet(f"{GOLD_DIR}/segment_traffic_aqi").select(*columns)
    except Exception:
        return spark.read.jdbc(JDBC_URL, "segment_traffic_aqi_staging", properties=JDBC_PROPS).select(*columns)


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

    apparent_temp = require_current_weather(spark)["apparent_temperature"]

    # Inner joins: a segment without real inputs gets no score rather than a made-up one.
    joined = (
        segments_df
        .join(raster_df, "segment_id", "inner")
        .join(shadow_df, "segment_id", "inner")
        .join(traffic_aqi_df, "segment_id", "inner")
    )

    shade_col = col("shade_ratio")
    ndvi_col = col("avg_ndvi")
    lst_col = col("avg_lst")
    aqi_col = col("aqi_value")
    traffic_col = col("congestion_ratio")

    # Sub-scores (matching spark_jobs/utils/normalization.py 1-to-1)
    shade_score = least(lit(1.0), greatest(lit(0.0), lit(0.7) * shade_col + lit(0.3) * least(ndvi_col * lit(2.0), lit(1.0))))
    temp_combined = lit(0.6 * apparent_temp) + lit(0.4) * lst_col
    temp_score = least(lit(1.0), greatest(lit(0.0), lit(1.0) - ((temp_combined - lit(28.0)) / lit(17.0))))
    aqi_score = least(lit(1.0), greatest(lit(0.0), lit(1.0) - (aqi_col / lit(150.0))))
    traffic_score = least(lit(1.0), greatest(lit(0.0), lit(1.0) - traffic_col))

    s_score = lookup_expr("surface_type", SURFACE_SCORES, DEFAULT_SURFACE_SCORE)
    sm_score = lookup_expr("smoothness", SMOOTHNESS_SCORES, DEFAULT_SMOOTHNESS_SCORE)
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
