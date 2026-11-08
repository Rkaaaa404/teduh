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
from pyspark.sql.functions import col, lit, when, least, round as spark_round, coalesce

from spark_jobs.config import JDBC_URL, JDBC_PROPS, GOLD_DIR
from spark_jobs.session import get_or_create_spark

MAX_TREES_FOR_MAX_NDVI = 10.0
NDVI_MIN = 0.10
NDVI_MAX = 0.72
DEFAULT_AIR_TEMP = 32.0


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

    correction_expr = (
        when(col("surface_type") == "asphalt", lit(8.0))
        .when(col("surface_type") == "concrete", lit(6.0))
        .when(col("surface_type") == "concrete:plates", lit(5.5))
        .when(col("surface_type") == "paving_stones", lit(4.0))
        .when(col("surface_type") == "sett", lit(4.0))
        .when(col("surface_type") == "compacted", lit(3.0))
        .when(col("surface_type").isin("gravel", "fine_gravel", "unpaved"), lit(2.0))
        .when(col("surface_type").isin("ground", "dirt"), lit(1.0))
        .when(col("surface_type") == "grass", lit(-2.0))
        .otherwise(lit(4.0))
    )

    return base_df.select(
        col("segment_id"),
        ndvi_expr.alias("avg_ndvi"),
        spark_round(lit(float(air_temp)) + correction_expr, 2).alias("avg_lst"),
        lit(str(target_date)).cast("date").alias("computed_at"),
    )


def run(air_temp: float | None = None, spark: SparkSession | None = None):
    """Main entry point for Raster Segmentation job."""
    if air_temp is None:
        air_temp = DEFAULT_AIR_TEMP

    today = date.today()
    print(f"=== Spark Job 1: Raster Segmentation ({today}, air_temp={air_temp}°C) ===")

    own_session = spark is None
    if own_session:
        spark = get_or_create_spark("CommuteCool_RasterSegment")

    try:
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
