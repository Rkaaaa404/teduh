"""Score Normalization Helpers.

Normalizes raw environmental values into 0.0-1.0 comfort scores
for use in the Thermal Comfort Score formula.

This module must stay free of pyspark imports: `ingestion.fast_refresh` imports
the lookup tables below so the SQL fast path and the Spark path cannot drift.
"""

import math

SURFACE_SCORES = {
    "asphalt": 0.9,
    "paving_stones": 0.85,
    "concrete": 0.8,
    "concrete:plates": 0.75,
    "sett": 0.7,
    "compacted": 0.6,
    "fine_gravel": 0.5,
    "gravel": 0.4,
    "unpaved": 0.3,
    "ground": 0.3,
    "dirt": 0.2,
    "sand": 0.2,
    "grass": 0.4,
}
DEFAULT_SURFACE_SCORE = 0.5

SMOOTHNESS_SCORES = {
    "excellent": 1.0,
    "good": 0.8,
    "intermediate": 0.6,
    "bad": 0.3,
    "very_bad": 0.1,
    "horrible": 0.05,
}
DEFAULT_SMOOTHNESS_SCORE = 0.5

# LST proxy: degrees added to air temperature per surface material.
SURFACE_TEMP_CORRECTION = {
    "asphalt": 8.0,
    "concrete": 6.0,
    "concrete:plates": 5.5,
    "paving_stones": 4.0,
    "sett": 4.0,
    "compacted": 3.0,
    "gravel": 2.0,
    "fine_gravel": 2.0,
    "unpaved": 2.0,
    "ground": 1.0,
    "dirt": 1.0,
    "sand": 5.0,
    "grass": -2.0,
}
DEFAULT_SURFACE_TEMP_CORRECTION = 4.0


def normalize_shade(shade_ratio: float, ndvi: float) -> float:
    """Shade comfort score. Higher shade = more comfortable.

    Args:
        shade_ratio: 0.0-1.0 from shadow model.
        ndvi: 0.0-1.0 proxy estimated from OSM tree density (not satellite imagery).

    Returns:
        Normalized score 0.0-1.0.
    """
    # NDVI contribution capped (values > 0.5 are dense vegetation)
    ndvi_component = min(ndvi * 2.0, 1.0)
    combined = 0.7 * shade_ratio + 0.3 * ndvi_component
    return max(0.0, min(1.0, combined))


def normalize_temperature(apparent_temp: float, lst: float) -> float:
    """Temperature comfort score. Lower temp = more comfortable.

    Range calibrated for Surabaya: 28C (comfortable) to 45C (extreme).

    Args:
        apparent_temp: Apparent temperature in Celsius.
        lst: Surface temperature proxy in Celsius (air temperature + material correction).

    Returns:
        Normalized score 0.0-1.0 (1.0 = comfortable, 0.0 = extreme heat).
    """
    TEMP_MIN = 28.0  # comfortable threshold
    TEMP_MAX = 45.0  # extreme heat threshold

    temp_combined = 0.6 * apparent_temp + 0.4 * lst
    score = 1.0 - (temp_combined - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)
    return max(0.0, min(1.0, score))


# Shade model. The width is fitted by validation/validate_shade_geometry.py.
SHADE_CONTEXT_RADIUS_M = 55.0  # radius in which `nearby_buildings` are counted
SHADE_BUILDING_WIDTH_M = 3.25  # length of segment shaded per building whose shadow reaches it
SHADE_TREE_CROWN_M = 8.0
TCS_PER_SHADE = 0.35 * 0.7  # TCS change for a full 0-to-1 change in shade


def shade_ratio_sql(buildings: str, height: str, trees: str, length: str, tan_elevation: str) -> str:
    """Share of a segment in shade, as SQL valid in both PostgreSQL and Spark.

    Only buildings whose shadow is long enough to reach the street count. Coverage
    follows 1 - exp(-x) so that overlapping shadows cannot add up past full shade.
    """
    reach = f"LEAST(1.0, ({height} / {tan_elevation}) / {SHADE_CONTEXT_RADIUS_M})"
    return (
        f"(1.0 - EXP(-({SHADE_BUILDING_WIDTH_M} * {buildings} * {reach}"
        f" + {SHADE_TREE_CROWN_M} * {trees}) / ({length} + 1.0)))"
    )


def shade_ratio(
    buildings: float,
    height: float,
    trees: float,
    length: float,
    tan_elevation: float,
    building_width: float = SHADE_BUILDING_WIDTH_M,
) -> float:
    """The same model as `shade_ratio_sql`, for validation and tests."""
    reach = min(1.0, (height / tan_elevation) / SHADE_CONTEXT_RADIUS_M)
    exposure = (building_width * buildings * reach + SHADE_TREE_CROWN_M * trees) / (length + 1.0)
    return 1.0 - math.exp(-exposure)


def normalize_aqi(aqi_value: float) -> float:
    """Air quality comfort score. Lower AQI = more comfortable.

    AQI scale: 0-50 Good, 51-100 Moderate, 101-150 Unhealthy for Sensitive,
    151+ Unhealthy.

    Args:
        aqi_value: AQI index value (0-500+).

    Returns:
        Normalized score 0.0-1.0.
    """
    AQI_MAX = 150.0  # Beyond this = 0.0 comfort
    score = 1.0 - (aqi_value / AQI_MAX)
    return max(0.0, min(1.0, score))


def normalize_traffic(congestion_ratio: float) -> float:
    """Traffic comfort score. Less congestion = more comfortable.

    Congestion affects pedestrians via noise, exhaust fumes, and danger.

    Args:
        congestion_ratio: 0.0-1.0 (0=free flow, 1=complete gridlock).

    Returns:
        Normalized score 0.0-1.0.
    """
    return max(0.0, min(1.0, 1.0 - congestion_ratio))


def normalize_surface(surface_type: str, smoothness: str) -> float:
    """Surface quality comfort score.

    Args:
        surface_type: OSM surface tag value.
        smoothness: OSM smoothness tag value.

    Returns:
        Normalized score 0.0-1.0.
    """
    s = SURFACE_SCORES.get(surface_type, DEFAULT_SURFACE_SCORE)
    sm = SMOOTHNESS_SCORES.get(smoothness, DEFAULT_SMOOTHNESS_SCORE)
    return 0.5 * s + 0.5 * sm


def compute_tcs(
    shade_score: float,
    temp_score: float,
    aqi_score: float,
    traffic_score: float,
    surface_score: float,
) -> float:
    """Compute final Thermal Comfort Score.

    Weighted combination of all sub-scores.

    Args:
        shade_score: Normalized shade comfort (0-1).
        temp_score: Normalized temperature comfort (0-1).
        aqi_score: Normalized AQI comfort (0-1).
        traffic_score: Normalized traffic comfort (0-1).
        surface_score: Normalized surface comfort (0-1).

    Returns:
        TCS value 0.0 (extremely uncomfortable) to 1.0 (very comfortable).
    """
    W_SHADE = 0.35
    W_TEMP = 0.30
    W_AQI = 0.15
    W_TRAFFIC = 0.10
    W_SURFACE = 0.10

    tcs = (
        W_SHADE * shade_score
        + W_TEMP * temp_score
        + W_AQI * aqi_score
        + W_TRAFFIC * traffic_score
        + W_SURFACE * surface_score
    )
    return max(0.0, min(1.0, tcs))
