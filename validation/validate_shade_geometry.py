"""Compare the shade formula with shadows computed from real OSM footprints.

For a fixed sample of segments, each building footprint and tree crown is cast
along the true sun direction, and the shaded share of the segment is measured.
Run in the Spark image: `python -m validation.validate_shade_geometry`.
"""
from __future__ import annotations

import math
import os
from datetime import datetime

import psycopg2

from spark_jobs.utils.normalization import (
    SHADE_BUILDING_WIDTH_M,
    SHADE_TREE_CROWN_M,
    shade_ratio,
)
from spark_jobs.utils.solar_position import get_surabaya_solar_position

SAMPLE_SIZE = 400
DATES = [(2026, 11, 9), (2026, 6, 21)]  # sun near zenith, sun at its lowest noon
HOURS = [7, 9, 12, 15, 17]
METRES_PER_DEG_LAT = 110540.0
METRES_PER_DEG_LNG = 111320.0 * math.cos(math.radians(7.26))
MAX_CAST_M = 120.0

MEASURE_SQL = """
WITH sample AS (
    SELECT s.segment_id, s.geom, s.length_m, c.nearby_buildings, c.avg_building_height, c.nearby_trees
    FROM segments s JOIN segment_spatial_context c USING (segment_id)
    WHERE s.segment_id = ANY(%(ids)s)
)
SELECT sm.length_m, sm.nearby_buildings, sm.avg_building_height, sm.nearby_trees,
       COALESCE(ST_Length(ST_Intersection(sm.geom, shadow.geom)) / NULLIF(ST_Length(sm.geom), 0), 0)
FROM sample sm
LEFT JOIN LATERAL (
    SELECT ST_Union(ST_MakeValid(cast_shape)) AS geom FROM (
        SELECT ST_ConvexHull(ST_Collect(b.geom, ST_Translate(
                   b.geom, %(ux)s * COALESCE(b.height_m, 10.0), %(uy)s * COALESCE(b.height_m, 10.0)
               ))) AS cast_shape
        FROM buildings b
        WHERE b.geom && ST_Expand(sm.geom, %(reach)s)
        UNION ALL
        SELECT ST_Buffer(ST_Translate(t.geom, %(ux)s * t.height_m, %(uy)s * t.height_m),
                         t.crown_radius_m / %(m_per_deg)s)
        FROM trees t
        WHERE t.geom && ST_Expand(sm.geom, %(reach)s)
    ) shapes
) shadow ON TRUE
"""


def measure(cur, ids, when):
    """Rows of (length, buildings, height, trees, true_shade, tan_elevation) at a moment."""
    sun = get_surabaya_solar_position(when)
    tan_elev = max(0.1, math.tan(math.radians(max(1.0, sun.elevation))))
    shadow_per_metre = 1.0 / tan_elev
    azimuth = math.radians(sun.azimuth)
    cur.execute(
        MEASURE_SQL,
        {
            "ids": ids,
            "ux": -math.sin(azimuth) * shadow_per_metre / METRES_PER_DEG_LNG,
            "uy": -math.cos(azimuth) * shadow_per_metre / METRES_PER_DEG_LAT,
            "reach": min(MAX_CAST_M, 25.0 * shadow_per_metre + 5.0) / METRES_PER_DEG_LAT,
            "m_per_deg": METRES_PER_DEG_LAT,
        },
    )
    return [tuple(row) + (tan_elev,) for row in cur.fetchall()]


def error(rows, width):
    total = 0.0
    for length, buildings, height, trees, real, tan in rows:
        total += abs(shade_ratio(buildings, height, trees, length, tan, building_width=width) - real)
    return total / len(rows)


def previous_formula(length, buildings, height, trees, tan):
    building_part = min(1.0, buildings * (height / tan) * 3.0 / (length + 1.0))
    return min(1.0, building_part + min(0.5, trees * 8.0 / (length + 1.0)))


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute("SELECT setseed(0.42)")
    cur.execute(
        "SELECT segment_id FROM segments WHERE length_m BETWEEN 10 AND 400 ORDER BY random() LIMIT %s",
        (SAMPLE_SIZE,),
    )
    ids = [r[0] for r in cur.fetchall()]

    by_condition = {}
    for year, month, day in DATES:
        for hour in HOURS:
            by_condition[(month, hour)] = measure(cur, ids, datetime(year, month, day, hour))
    conn.close()
    rows = [r for group in by_condition.values() for r in group]

    best = min((w / 4.0 for w in range(1, 81)), key=lambda w: error(rows, w))
    print(f"width in use {SHADE_BUILDING_WIDTH_M} m, crown {SHADE_TREE_CROWN_M} m, best fit {best} m")
    print("month hour | real model previous | model_MAE previous_MAE | previous_full%")
    for (month, hour), group in by_condition.items():
        n = len(group)
        real = [r[4] for r in group]
        model = [shade_ratio(b, h, t, l, tan) for l, b, h, t, _, tan in group]
        previous = [previous_formula(l, b, h, t, tan) for l, b, h, t, _, tan in group]
        model_mae = sum(abs(a - b) for a, b in zip(model, real)) / n
        previous_mae = sum(abs(a - b) for a, b in zip(previous, real)) / n
        full = 100.0 * sum(1 for value in previous if value >= 0.99) / n
        print(
            f"{month:>5} {hour:>4} | {sum(real) / n:.3f} {sum(model) / n:.3f} {sum(previous) / n:.3f}"
            f" | {model_mae:.3f} {previous_mae:.3f} | {full:.0f}"
        )
    print(f"overall MAE at width in use: {error(rows, SHADE_BUILDING_WIDTH_M):.3f}")


if __name__ == "__main__":
    main()
