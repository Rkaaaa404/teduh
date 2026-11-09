"""Read the newest real reading of a raw input for the Spark jobs.

HDFS Bronze holds one compact JSON document per category (written by step 1.5
of `run_pipeline`). The local raw directory is the cache behind it. There are
no default values here: when nothing real exists the caller gets
`LiveDataUnavailable` and the job stops without overwriting served data.
"""
from __future__ import annotations

import json
import os

from pyspark.sql import SparkSession

from ingestion.config import LiveDataUnavailable
from spark_jobs.config import BRONZE_DIR, HDFS_ENABLED, RAW_DATA_DIR


def latest_local_file(category: str) -> str | None:
    """Path of the newest raw file for a category; filenames sort by timestamp."""
    directory = os.path.join(RAW_DATA_DIR, category)
    if not os.path.isdir(directory):
        return None
    names = sorted(f for f in os.listdir(directory) if f.endswith(".json"))
    return os.path.join(directory, names[-1]) if names else None


def _latest_bronze_doc(spark: SparkSession, category: str) -> dict | list | None:
    try:
        rows = spark.read.text(f"{BRONZE_DIR}/{category}").collect()
    except Exception as exc:
        print(f"  [Bronze] {category} unreadable: {exc}")
        return None
    for row in reversed(rows):
        try:
            doc = json.loads(row[0])
        except ValueError:
            continue
        if isinstance(doc, (dict, list)):
            return doc
    return None


def require_latest_doc(spark: SparkSession, category: str) -> dict | list:
    """Return the newest document from Bronze or the local cache, or raise."""
    if HDFS_ENABLED:
        doc = _latest_bronze_doc(spark, category)
        if doc:
            return doc

    path = latest_local_file(category)
    if path:
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
        if doc:
            return doc

    raise LiveDataUnavailable(f"no real {category} reading in Bronze or the local cache")


def require_current_weather(spark: SparkSession) -> dict[str, float]:
    """Return the measured air and apparent temperature, or raise."""
    current = require_latest_doc(spark, "weather").get("current") or {}
    temperature, apparent = current.get("temperature_2m"), current.get("apparent_temperature")
    if temperature is None or apparent is None:
        raise LiveDataUnavailable("latest weather reading has no temperature")
    return {"temperature_2m": float(temperature), "apparent_temperature": float(apparent)}
