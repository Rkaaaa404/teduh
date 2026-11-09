"""Spark Job 5: Graph Weight Export (Pure Catalyst Vectorized).

Offline Gold artifact only: the API does not read `edge_weights`. Routing
computes its cost at query time in `api/routes/navigation.py`.

Optimized Architecture:
- Reuses shared SparkSession (`spark_jobs.session`)
- Replaces Python `@udf`s with native Catalyst arithmetic
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import col, lit, when

from spark_jobs.config import JDBC_URL, JDBC_PROPS, GOLD_DIR
from spark_jobs.session import get_or_create_spark

MAX_PENALTY_MULTIPLIER = 3.0
WEIGHT_VALIDITY_HOURS = 1
OUTPUT_DIR = os.getenv("GRAPH_WEIGHT_DIR", "./data/routing_weights")


def _load_latest_tcs(spark: SparkSession) -> DataFrame:
    gold_path = f"{GOLD_DIR}/thermal_comfort_scores"
    try:
        return spark.read.parquet(gold_path).select("segment_id", "tcs_value")
    except Exception:
        query = """
        (SELECT segment_id, tcs_value FROM segment_live_comfort) AS live_tcs
        """
        return spark.read.jdbc(JDBC_URL, query, properties=JDBC_PROPS)


def compute_edge_weights(spark: SparkSession) -> DataFrame:
    tcs_df = _load_latest_tcs(spark)
    segments_df = spark.read.jdbc(
        JDBC_URL,
        "(SELECT segment_id, length_m FROM segments) AS seg_lengths",
        properties=JDBC_PROPS,
    )

    joined_df = segments_df.join(tcs_df, "segment_id", "inner")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    valid_from = now
    valid_until = now + timedelta(hours=WEIGHT_VALIDITY_HOURS)

    base_cost_col = when(
        col("length_m").isNotNull() & (col("length_m") > 0),
        col("length_m") / lit(1.33),
    ).otherwise(lit(0.0))

    penalty_col = base_cost_col * ((lit(1.0) - col("tcs_value")) * lit(MAX_PENALTY_MULTIPLIER - 1.0))

    return (
        joined_df.withColumn("base_cost", base_cost_col.cast("double"))
        .withColumn("thermal_penalty", penalty_col.cast("double"))
        .withColumn("total_cost", (base_cost_col + penalty_col).cast("double"))
        .select(
            col("segment_id"),
            col("base_cost"),
            col("thermal_penalty"),
            col("total_cost"),
            lit(str(valid_from)).cast("timestamp").alias("valid_from"),
            lit(str(valid_until)).cast("timestamp").alias("valid_until"),
        )
    )


def run(spark: SparkSession | None = None):
    """Main entry point for Graph Weight Export job."""
    print("=== Spark Job 5: Graph Weight Export ===")
    own_session = spark is None
    if own_session:
        spark = get_or_create_spark("Teduh_GraphWeight", enable_sedona=False)

    try:
        result_df = compute_edge_weights(spark).cache()
        count = result_df.count()
        print(f"  Computed weights for {count} edges")

        gold_path = f"{GOLD_DIR}/edge_weights"
        try:
            result_df.write.mode("overwrite").parquet(gold_path)
            print(f"  ✓ Written Gold Parquet: {gold_path}")
        except Exception as exc:
            print(f"  [Warning] Gold Parquet write skipped: {exc}")

        (
            result_df.coalesce(4)
            .write.mode("overwrite")
            .option("truncate", "true")
            .jdbc(JDBC_URL, "edge_weights", properties=JDBC_PROPS)
        )
        print("  ✓ Written edge_weights to PostgreSQL")

        if os.getenv("EXPORT_ROUTING_JSON", "false").lower() == "true":
            os.makedirs(OUTPUT_DIR, exist_ok=True)
            rows = result_df.select("segment_id", "base_cost", "thermal_penalty", "total_cost").collect()
            weights = {
                str(r["segment_id"]): {
                    "base_cost": r["base_cost"],
                    "thermal_penalty": r["thermal_penalty"],
                    "total_cost": r["total_cost"],
                }
                for r in rows
            }
            out_file = os.path.join(OUTPUT_DIR, "edge_weights.json")
            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(weights, f)
            print(f"  ✓ Exported JSON weights to {out_file}")

        result_df.unpersist()
    finally:
        if own_session and spark is not None:
            spark.stop()


if __name__ == "__main__":
    run()
