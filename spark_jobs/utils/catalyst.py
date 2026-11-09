"""Spark Catalyst helpers shared by the jobs."""
from __future__ import annotations

from pyspark.sql import Column
from pyspark.sql.functions import col, lit, when


def lookup_expr(column: str, values: dict[str, float], default: float) -> Column:
    """Map a string column through a lookup table without a Python UDF."""
    expr = lit(default)
    for key, value in values.items():
        expr = when(col(column) == key, lit(value)).otherwise(expr)
    return expr
