"""Spark Job 6: AI/ML Predictive Simulations (Decision Tree Regressor).

Optimized Architecture:
- Reuses shared SparkSession (`spark_jobs.session`)
- Deduplicates per-segment inputs cleanly so `tcs_simulations` never gets duplicate rows
- Caches assembled vector DataFrame in memory for fast model training + 2 scenario transforms
"""
from __future__ import annotations

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import col, current_timestamp, when, lit
from pyspark.ml.feature import VectorAssembler
from pyspark.ml.regression import DecisionTreeRegressor

from spark_jobs.config import JDBC_URL, JDBC_PROPS, GOLD_DIR
from spark_jobs.session import get_or_create_spark


def load_dataset(spark: SparkSession) -> DataFrame:
    """Assemble deduplicated segment feature dataset from Gold Parquet or PostGIS."""
    segments_df = spark.read.jdbc(
        JDBC_URL,
        "(SELECT segment_id FROM segments) AS seg_ids",
        properties=JDBC_PROPS,
    )

    try:
        raster_df = (
            spark.read.parquet(f"{GOLD_DIR}/segment_raster_scores")
            .select("segment_id", "avg_ndvi", "avg_lst")
            .dropDuplicates(["segment_id"])
        )
    except Exception:
        raster_df = spark.read.jdbc(
            JDBC_URL,
            "(SELECT segment_id, avg_ndvi, avg_lst FROM segment_live_comfort) AS rs_live",
            properties=JDBC_PROPS,
        )

    try:
        shadow_df = (
            spark.read.parquet(f"{GOLD_DIR}/segment_shadows")
            .groupBy("segment_id")
            .avg("shade_ratio")
            .withColumnRenamed("avg(shade_ratio)", "avg_shade")
        )
    except Exception:
        shadow_df = spark.read.jdbc(
            JDBC_URL,
            "(SELECT segment_id, AVG(shade_ratio) AS avg_shade FROM segment_shadows GROUP BY segment_id) AS sh_avg",
            properties=JDBC_PROPS,
        )

    try:
        traffic_aqi_df = (
            spark.read.parquet(f"{GOLD_DIR}/segment_traffic_aqi")
            .select("segment_id", "congestion_ratio", "aqi_value")
            .dropDuplicates(["segment_id"])
        )
    except Exception:
        traffic_aqi_df = spark.read.jdbc(
            JDBC_URL,
            "(SELECT segment_id, traffic_level AS congestion_ratio, aqi_value FROM segment_live_comfort) AS ta_live",
            properties=JDBC_PROPS,
        )

    try:
        tcs_df = (
            spark.read.parquet(f"{GOLD_DIR}/thermal_comfort_scores")
            .select("segment_id", "tcs_value")
            .dropDuplicates(["segment_id"])
        )
    except Exception:
        tcs_df = spark.read.jdbc(
            JDBC_URL,
            "(SELECT segment_id, tcs_value FROM segment_live_comfort) AS tcs_live",
            properties=JDBC_PROPS,
        )

    dataset_df = (
        segments_df
        .join(raster_df, "segment_id", "left")
        .join(shadow_df, "segment_id", "left")
        .join(traffic_aqi_df, "segment_id", "left")
        .join(tcs_df, "segment_id", "inner")
    )

    return dataset_df.na.fill(
        {
            "avg_ndvi": 0.15,
            "avg_lst": 36.0,
            "avg_shade": 0.20,
            "congestion_ratio": 0.30,
            "aqi_value": 50.0,
            "tcs_value": 0.50,
        }
    )


def train_and_simulate(spark: SparkSession | None = None):
    """Train MLlib DecisionTreeRegressor and simulate Green & Cool Pavement interventions."""
    print("=== Spark Job 6: AI/ML Predictive Simulations ===")
    own_session = spark is None
    if own_session:
        spark = get_or_create_spark("CommuteCool_MLPredictor", enable_sedona=False)

    try:
        dataset_df = load_dataset(spark).cache()
        row_count = dataset_df.count()
        if row_count == 0:
            print("  [Warning] No training data available yet.")
            dataset_df.unpersist()
            return

        print(f"  Training DecisionTreeRegressor on {row_count} Surabaya street segments...")
        feature_cols = ["avg_ndvi", "avg_lst", "avg_shade", "congestion_ratio", "aqi_value"]
        assembler = VectorAssembler(inputCols=feature_cols, outputCol="features")
        vector_df = assembler.transform(dataset_df)

        dt = DecisionTreeRegressor(featuresCol="features", labelCol="tcs_value", maxDepth=5)
        model = dt.fit(vector_df)

        # Scenario 1: Urban Greening (+0.25 NDVI + +0.20 canopy shade)
        green_sim_df = (
            dataset_df.withColumn(
                "avg_ndvi",
                when(col("avg_ndvi") + 0.25 > 0.72, lit(0.72)).otherwise(col("avg_ndvi") + 0.25),
            )
            .withColumn(
                "avg_shade",
                when(col("avg_shade") + 0.20 > 0.95, lit(0.95)).otherwise(col("avg_shade") + 0.20),
            )
        )
        green_pred_df = (
            model.transform(assembler.transform(green_sim_df))
            .select(col("segment_id"), col("prediction").alias("predicted_tcs_green"))
        )

        # Scenario 2: Cool Pavement (-3.5C Surface LST)
        cool_sim_df = dataset_df.withColumn(
            "avg_lst",
            when(col("avg_lst") - 3.5 < 28.0, lit(28.0)).otherwise(col("avg_lst") - 3.5),
        )
        cool_pred_df = (
            model.transform(assembler.transform(cool_sim_df))
            .select(col("segment_id"), col("prediction").alias("predicted_tcs_cool"))
        )

        simulations_final_df = (
            dataset_df.select(col("segment_id"), col("tcs_value").alias("current_tcs"))
            .join(green_pred_df, "segment_id", "inner")
            .join(cool_pred_df, "segment_id", "inner")
            .withColumn("tcs_improvement_green", col("predicted_tcs_green") - col("current_tcs"))
            .withColumn("tcs_improvement_cool", col("predicted_tcs_cool") - col("current_tcs"))
            .withColumn("simulated_at", current_timestamp())
        )

        (
            simulations_final_df.coalesce(4)
            .write.mode("overwrite")
            .option("truncate", "true")
            .jdbc(JDBC_URL, "tcs_simulations", properties=JDBC_PROPS)
        )
        dataset_df.unpersist()
        print(f"  ✓ Saved {row_count} ML simulation predictions to tcs_simulations")
    finally:
        if own_session and spark is not None:
            spark.stop()


if __name__ == "__main__":
    train_and_simulate()
