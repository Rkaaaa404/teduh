"""Spark Job 4: Traffic & AQI Aggregation per segment.

Optimized Architecture:
- Eliminates slow correlated scalar SQL subquery + WKB deserialization per row
- Reads numeric segment centroids directly from PostGIS and computes nearest
  TomTom traffic station using vectorized Spark Catalyst expressions.
"""
from __future__ import annotations

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import col, lit, least, struct, pow as spark_pow

from ingestion.config import LiveDataUnavailable
from spark_jobs.config import JDBC_URL, JDBC_PROPS, GOLD_DIR
from spark_jobs.live_inputs import require_latest_doc
from spark_jobs.session import get_or_create_spark


def load_latest_aqi_value(spark: SparkSession) -> float:
    """Return the measured city AQI. WAQI reports a missing reading as "-"."""
    raw_value = require_latest_doc(spark, "aqi").get("aqi")
    try:
        return float(raw_value)
    except (TypeError, ValueError) as exc:
        raise LiveDataUnavailable(f"latest AQI reading is not a number: {raw_value!r}") from exc


def aggregate_traffic_to_segments(spark: SparkSession) -> DataFrame:
    """Assign nearest TomTom congestion_ratio to each segment using pure Catalyst math."""
    # A ratio of 0.0 is real free-flow traffic, so test for None rather than truthiness.
    # Speeds above free flow produce a negative ratio, which counts as no congestion.
    valid_points = [
        (float(d["lat"]), float(d["lng"]), max(0.0, float(d["congestion_ratio"])))
        for d in require_latest_doc(spark, "traffic")
        if d.get("lat") is not None
        and d.get("lng") is not None
        and d.get("congestion_ratio") is not None
    ]
    if not valid_points:
        raise LiveDataUnavailable("latest traffic reading has no usable points")

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
        spark = get_or_create_spark("Teduh_TrafficAQI")

    try:
        traffic_df = aggregate_traffic_to_segments(spark)
        aqi_value = load_latest_aqi_value(spark)
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
