"""Spark Job 2: Dynamic Shadow Modeling (Vectorized Single-Pass Architecture).

Optimized Architecture:
- Eliminates loading 688,248 raw building polygons into Spark driver heap
- Eliminates 12x repeated correlated PostGIS subqueries (~2.08M GiST probes)
- Reads static `segment_spatial_context` ONCE (< 2 MB), broadcasts 12 Surabaya
  solar elevation angles (06:00-17:00 WIB), computes all 696,048 segment-hour
  shade ratios in pure Spark Catalyst math (zero Python @udf), and writes in
  one batched pass!
"""
from __future__ import annotations

import math
from datetime import datetime, date
import psycopg2

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import broadcast, col, expr, lit
from pyspark.sql.types import StructType, StructField, IntegerType, DoubleType

from spark_jobs.utils.normalization import shade_ratio_sql
from spark_jobs.utils.solar_position import get_surabaya_solar_position
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
from spark_jobs.session import get_or_create_spark

HOURS_OF_DAY = list(range(6, 18))  # 06:00 to 17:00 WIB


def _build_hourly_solar_df(spark: SparkSession, target_date: date) -> DataFrame:
    """Create a tiny 12-row broadcast DataFrame of `(hour_of_day, tan_elev)`."""
    rows = []
    for hour in HOURS_OF_DAY:
        dt = datetime(target_date.year, target_date.month, target_date.day, hour, 0, 0)
        solar_pos = get_surabaya_solar_position(dt)
        if solar_pos.elevation <= 0:
            continue
        tan_val = max(0.1, math.tan(math.radians(max(1.0, solar_pos.elevation))))
        rows.append((int(hour), float(tan_val)))
        print(
            f"  Solar {hour:02d}:00 WIB -> elevation={solar_pos.elevation:.1f}°, "
            f"azimuth={solar_pos.azimuth:.1f}°"
        )

    schema = StructType(
        [
            StructField("hour_of_day", IntegerType(), False),
            StructField("tan_elev", DoubleType(), False),
        ]
    )
    return spark.createDataFrame(rows, schema=schema)


def run(target_date: date | None = None, spark: SparkSession | None = None):
    """Main entry point for Vectorized Shadow Model job."""
    if target_date is None:
        target_date = date.today()

    print(f"=== Spark Job 2: Dynamic Shadow Modeling ({target_date}) ===")
    own_session = spark is None
    if own_session:
        spark = get_or_create_spark("Teduh_ShadowModel")

    try:
        # Ensure `segment_spatial_context` exists & clear target_date rows cleanly
        db_url = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        try:
            cur.execute("SELECT refresh_segment_spatial_context(FALSE);")
            cur.execute("DELETE FROM segment_shadows WHERE computed_at = %s;", (target_date,))
            conn.commit()
        finally:
            cur.close()
            conn.close()

        # Read static segment neighborhood metrics ONCE (< 2 MB instead of 12x 688k scans!)
        context_query = """
        (SELECT
            s.segment_id,
            GREATEST(COALESCE(s.length_m, 50.0), 1.0) AS length_m,
            COALESCE(ctx.nearby_buildings, 0) AS nearby_buildings,
            COALESCE(ctx.nearby_trees, 0) AS nearby_trees,
            COALESCE(ctx.avg_building_height, 10.0) AS avg_building_height
         FROM segments s
         LEFT JOIN segment_spatial_context ctx ON ctx.segment_id = s.segment_id
        ) AS seg_ctx
        """
        seg_df = spark.read.jdbc(JDBC_URL, context_query, properties=JDBC_PROPS)
        solar_df = _build_hourly_solar_df(spark, target_date)

        # Pure JVM vectorized shadow projection across all 12 hours simultaneously
        total_shade_col = expr(
            shade_ratio_sql(
                "nearby_buildings", "avg_building_height", "nearby_trees", "length_m", "tan_elev"
            )
        )

        all_hours_df = (
            seg_df.crossJoin(broadcast(solar_df))
            .select(
                col("segment_id"),
                col("hour_of_day").cast("short").alias("hour_of_day"),
                total_shade_col.cast("double").alias("shade_ratio"),
                lit(str(target_date)).cast("date").alias("computed_at"),
            )
            .cache()
        )

        total_rows = all_hours_df.count()
        print(f"  Computed {total_rows} segment-hour shadow records in single vectorized pass")

        # Write partitioned Gold Parquet once
        gold_path = f"{GOLD_DIR}/segment_shadows"
        try:
            all_hours_df.write.mode("overwrite").partitionBy("hour_of_day").parquet(gold_path)
            print(f"  ✓ Written partitioned Gold Parquet: {gold_path}")
        except Exception as exc:
            print(f"  [Warning] Gold Parquet write skipped: {exc}")

        # Single high-throughput batched JDBC write to PostGIS
        (
            all_hours_df.repartition(4)
            .write.mode("append")
            .jdbc(JDBC_URL, "segment_shadows", properties=JDBC_PROPS)
        )
        all_hours_df.unpersist()
        print("  ✓ Written all 12 hours of segment_shadows to PostgreSQL")
    finally:
        if own_session and spark is not None:
            spark.stop()


if __name__ == "__main__":
    run()
