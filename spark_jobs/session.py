"""Shared Laptop-Friendly SparkSession Singleton for COMMUTE-COOL.

Avoids launching 7 separate 2GB JVMs across pipeline steps.
Caps CPU cores (`local[2]`), shuffle partitions (`8`), and driver heap (`1g`)
so local laptops stay cool and responsive while running Apache Spark + Sedona + MLlib.
"""
from __future__ import annotations

import os
from pyspark.sql import SparkSession

_SHARED_SPARK: SparkSession | None = None
_SEDONA_REGISTERED: bool = False


def get_or_create_spark(
    app_name: str = "CommuteCool_UnifiedPipeline",
    enable_sedona: bool = True,
) -> SparkSession:
    """Return an active laptop-tuned SparkSession (creating it once if needed)."""
    global _SHARED_SPARK, _SEDONA_REGISTERED

    if _SHARED_SPARK is not None and _SHARED_SPARK._jsc is not None:
        if enable_sedona and not _SEDONA_REGISTERED:
            _register_sedona(_SHARED_SPARK)
        return _SHARED_SPARK

    master_url = os.getenv("SPARK_MASTER_URL", "local[2]")
    driver_mem = os.getenv("SPARK_DRIVER_MEMORY", "1g")
    shuffle_parts = os.getenv("SPARK_SHUFFLE_PARTITIONS", "8")

    builder = (
        SparkSession.builder
        .appName(app_name)
        .master(master_url)
        .config("spark.driver.memory", driver_mem)
        .config("spark.sql.shuffle.partitions", shuffle_parts)
        .config("spark.default.parallelism", "4")
        .config("spark.ui.enabled", "false")
        .config("spark.sql.adaptive.enabled", "true")
        .config("spark.serializer", "org.apache.spark.serializer.KryoSerializer")
    )

    try:
        from sedona.utils import SedonaKryoRegistrator
        builder = builder.config("spark.kryo.registrator", SedonaKryoRegistrator.getName)
    except Exception:
        pass

    _SHARED_SPARK = builder.getOrCreate()
    _SHARED_SPARK.sparkContext.setLogLevel("WARN")

    if enable_sedona:
        _register_sedona(_SHARED_SPARK)

    return _SHARED_SPARK


def _register_sedona(spark: SparkSession) -> None:
    global _SEDONA_REGISTERED
    if _SEDONA_REGISTERED:
        return
    try:
        from sedona.register import SedonaRegistrator
        SedonaRegistrator.registerAll(spark)
        _SEDONA_REGISTERED = True
    except Exception as exc:
        print(f"  [SparkSession] Sedona registration warning: {exc}")


def stop_shared_spark() -> None:
    """Cleanly shut down the shared SparkSession at the end of the pipeline."""
    global _SHARED_SPARK, _SEDONA_REGISTERED
    if _SHARED_SPARK is not None:
        try:
            _SHARED_SPARK.stop()
        except Exception:
            pass
        _SHARED_SPARK = None
        _SEDONA_REGISTERED = False

