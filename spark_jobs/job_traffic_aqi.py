"""Spark Job 4: Traffic & AQI Aggregation per segment.

Optimized Architecture:
- Eliminates slow correlated scalar SQL subquery + WKB deserialization per row
- Reads numeric segment centroids directly from PostGIS and computes nearest
  TomTom traffic station using vectorized Spark Catalyst expressions.
"""
from __future__ import annotations

import json
import os
from functools import reduce

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import col, lit, least, struct, pow as spark_pow

from spark_jobs.config import JDBC_URL, JDBC_PROPS, RAW_DATA_DIR, BRONZE_DIR, GOLD_DIR, HDFS_ENABLED
from spark_jobs.session import get_or_create_spark


def load_latest_traffic(spark: SparkSession) -> list[dict]:
    """Read the most recent traffic data from HDFS Bronze or local cache."""
    if HDFS_ENABLED:
        try:
            rows = spark.read.text(f"{BRONZE_DIR}/traffic").collect()
            traffic_data = []
            for r in rows:
                try:
                    parsed = json.loads(r[0])
                    if isinstance(parsed, list):
                        traffic_data.extend(parsed)
                except Exception:
                    pass
            if traffic_data:
                return traffic_data
        except Exception:
            pass

    traffic_dir = os.path.join(RAW_DATA_DIR, "traffic")
    if not os.path.exists(traffic_dir):
        return []
    files = sorted([f for f in os.listdir(traffic_dir) if f.startswith("traffic_")], reverse=True)
    if not files:
        return []
    with open(os.path.join(traffic_dir, files[0]), "r", encoding="utf-8") as f:
        return json.load(f)


def load_latest_aqi(spark: SparkSession) -> dict:
    """Read the most recent AQI data from HDFS Bronze or local cache."""
    if HDFS_ENABLED:
        try:
            rows = spark.read.text(f"{BRONZE_DIR}/aqi").collect()
            if rows:
                return json.loads(rows[-1][0])
        except Exception:
            pass

    aqi_dir = os.path.join(RAW_DATA_DIR, "aqi")
    if not os.path.exists(aqi_dir):
        return {"aqi": 50}
    files = sorted([f for f in os.listdir(aqi_dir) if f.startswith("aqi_")], reverse=True)
    if not files:
        return {"aqi": 50}
    with open(os.path.join(aqi_dir, files[0]), "r", encoding="utf-8") as f:
        return json.load(f)


def aggregate_traffic_to_segments(spark: SparkSession) -> DataFrame:
    """Assign nearest TomTom congestion_ratio to each segment using pure Catalyst math."""
    traffic_data = load_latest_traffic(spark)
    valid_points = [
        (float(d["lat"]), float(d["lng"]), float(d.get("congestion_ratio") or 0.3))
        for d in traffic_data
        if d.get("lat") is not None and d.get("lng") is not None
    ]

    if not valid_points:
        print("  No live TomTom points configured; assigning baseline 0.30 congestion")
        return (
            spark.read.jdbc(JDBC_URL, "(SELECT segment_id FROM segments) AS seg_ids", properties=JDBC_PROPS)
            .withColumn("congestion_ratio", lit(0.3))
        )

    centroid_query = """
    (SELECT
        segment_id,
        ST_Y(ST_Centroid(geom)) AS lat,
        ST_X(ST_Centroid(geom)) AS lng
     FROM segments
    ) AS seg_centroids
    """
    seg_df = spark.read.jdbc(JDBC_URL, centroid_query, properties=JDBC_PROPS)

    # `least(struct(dist_sq, ratio), ...)` picks the struct with minimum squared distance!
    dist_structs = [
        struct(
            (spark_pow(col("lat") - lit(p_lat), 2) + spark_pow(col("lng") - lit(p_lng), 2)).alias("d2"),
            lit(p_ratio).alias("ratio"),
        )
        for (p_lat, p_lng, p_ratio) in valid_points
    ]

    nearest_struct = dist_structs[0] if len(dist_structs) == 1 else least(*dist_structs)
    return seg_df.select(
        col("segment_id"),
        nearest_struct.getField("ratio").cast("double").alias("congestion_ratio"),
    )


def run(spark: SparkSession | None = None):
    """Main entry point for Traffic & AQI Aggregation job."""
    print("=== Spark Job 4: Traffic & AQI Aggregation ===")
    own_session = spark is None
    if own_session:
        spark = get_or_create_spark("CommuteCool_TrafficAQI")

    try:
        traffic_df = aggregate_traffic_to_segments(spark)
        aqi_value = float(load_latest_aqi(spark).get("aqi", 50.0))
        print(f"  City-wide AQI: {aqi_value}")

        result_df = traffic_df.withColumn("aqi_value", lit(aqi_value)).cache()
        count = result_df.count()
        print(f"  Aggregated traffic+AQI for {count} segments")

        gold_path = f"{GOLD_DIR}/segment_traffic_aqi"
        try:
            result_df.write.mode("overwrite").parquet(gold_path)
            print(f"  ✓ Written Gold Parquet: {gold_path}")
        except Exception as exc:
            print(f"  [Warning] Gold Parquet write skipped: {exc}")

        (
            result_df.coalesce(4)
            .write.mode("overwrite")
            .option("truncate", "true")
            .jdbc(JDBC_URL, "segment_traffic_aqi_staging", properties=JDBC_PROPS)
        )
        result_df.unpersist()
        print("  ✓ Written segment_traffic_aqi_staging to PostgreSQL")
    finally:
        if own_session and spark is not None:
            spark.stop()


if __name__ == "__main__":
    run()
