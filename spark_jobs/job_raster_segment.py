"""Spark Job 1: Raster Segmentation (NDVI/LST per street segment).

Optimized Architecture:
- Reuses shared SparkSession (`spark_jobs.session`)
- Reads pre-indexed `segment_spatial_context` + `segments` in ONE lightweight JDBC pass
  (eliminating 16M unindexed JVM WKB cross-join evaluations)
- Computes NDVI & LST proxies using 100% native Spark Catalyst expressions (zero Python @udf)
"""
from __future__ import annotations

from datetime import date
from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import col, lit, least, round as spark_round, coalesce

from spark_jobs.config import JDBC_URL, JDBC_PROPS, GOLD_DIR
from spark_jobs.live_inputs import require_current_weather
from spark_jobs.session import get_or_create_spark
from spark_jobs.utils.catalyst import lookup_expr
from spark_jobs.utils.normalization import DEFAULT_SURFACE_TEMP_CORRECTION, SURFACE_TEMP_CORRECTION

MAX_TREES_FOR_MAX_NDVI = 10.0
NDVI_MIN = 0.10
NDVI_MAX = 0.72


def compute_raster_proxies(spark: SparkSession, air_temp: float, target_date: date) -> DataFrame:
    """Compute NDVI and LST per segment in a single native Spark pass."""
    query = """
    (SELECT
        s.segment_id,
        s.surface_type,
        COALESCE(ctx.nearby_trees, 0) AS tree_count
     FROM segments s
     LEFT JOIN segment_spatial_context ctx ON ctx.segment_id = s.segment_id
    ) AS seg_raster_input
    """
    base_df = spark.read.jdbc(JDBC_URL, query, properties=JDBC_PROPS)

    ndvi_expr = spark_round(
        lit(NDVI_MIN)
        + least(coalesce(col("tree_count"), lit(0)).cast("double") / lit(MAX_TREES_FOR_MAX_NDVI), lit(1.0))
        * lit(NDVI_MAX - NDVI_MIN),
        4,
    )

    correction_expr = lookup_expr("surface_type", SURFACE_TEMP_CORRECTION, DEFAULT_SURFACE_TEMP_CORRECTION)

    return base_df.select(
        col("segment_id"),
        ndvi_expr.alias("avg_ndvi"),
        spark_round(lit(float(air_temp)) + correction_expr, 2).alias("avg_lst"),
        lit(str(target_date)).cast("date").alias("computed_at"),
    )


def run(air_temp: float | None = None, spark: SparkSession | None = None):
    """Main entry point for Raster Segmentation job."""
    today = date.today()
    own_session = spark is None
    if own_session:
        spark = get_or_create_spark("Teduh_RasterSegment")

    try:
        if air_temp is None:
            air_temp = require_current_weather(spark)["temperature_2m"]
        print(f"=== Spark Job 1: Raster Segmentation ({today}, air_temp={air_temp}°C) ===")

        result_df = compute_raster_proxies(spark, air_temp, today).cache()
        row_count = result_df.count()
        print(f"  Computed raster scores for {row_count} segments")

        gold_path = f"{GOLD_DIR}/segment_raster_scores"
        try:
            result_df.write.mode("overwrite").parquet(gold_path)
            print(f"  ✓ Written HDFS/Lakehouse Gold Parquet: {gold_path}")
        except Exception as exc:
            print(f"  [Warning] Gold Parquet write skipped: {exc}")

        (
            result_df.coalesce(4)
            .write.mode("overwrite")
            .option("truncate", "true")
            .jdbc(JDBC_URL, "segment_raster_scores", properties=JDBC_PROPS)
        )
        result_df.unpersist()
        print("  ✓ Written segment_raster_scores to PostgreSQL")
    finally:
        if own_session and spark is not None:
            spark.stop()


if __name__ == "__main__":
    run()
