"""Lightweight PostGIS thermal comfort refresh (no Spark or Hadoop needed).

Refreshes weather (Open-Meteo), AQI (WAQI), traffic (TomTom), solar shadows,
NDVI/LST proxies, `segment_live_comfort`, `weather_hourly_forecast` and
`tcs_simulations` directly inside PostgreSQL.

Inputs must be real: each one comes from the live API or the last real cached
reading. If neither exists the refresh is skipped and served rows stay as they
are. See `_resolve_input`.

Usage:
    docker compose exec api python -m ingestion.fast_refresh
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Callable

import psycopg2

from ingestion.config import DATABASE_URL, SURABAYA_LAT, SURABAYA_LNG, LiveDataUnavailable
from spark_jobs.utils.normalization import (
    shade_ratio_sql,
    DEFAULT_SMOOTHNESS_SCORE,
    DEFAULT_SURFACE_SCORE,
    DEFAULT_SURFACE_TEMP_CORRECTION,
    SMOOTHNESS_SCORES,
    SURFACE_SCORES,
    SURFACE_TEMP_CORRECTION,
)

WIB = timezone(timedelta(hours=7))

DAYLIGHT_HOURS = list(range(6, 18))  # 06:00-17:00 WIB, the slots of shade_by_hour
NIGHT_SHADE_RATIO = 0.85  # TCS relief when there is no direct sun, shared with Spark Job 3


def _case_sql(column: str, values: dict[str, float], default: float) -> str:
    """Render a lookup table as a SQL CASE so SQL and Spark share one source."""
    branches = " ".join(f"WHEN '{key}' THEN {value}" for key, value in values.items())
    return f"CASE {column} {branches} ELSE {default} END"


SURFACE_SCORE_SQL = _case_sql("s.surface_type", SURFACE_SCORES, DEFAULT_SURFACE_SCORE)


def _shade_sql(tan_elevation: str) -> str:
    return shade_ratio_sql(
        "COALESCE(ctx.nearby_buildings, 0)",
        "COALESCE(ctx.avg_building_height, 10.0)",
        "COALESCE(ctx.nearby_trees, 0)",
        "GREATEST(COALESCE(s.length_m, 50.0), 1.0)",
        tan_elevation,
    )


SHADE_NOW_SQL = _shade_sql("%(tan)s")
SHADE_BY_HOUR_SQL = _shade_sql("u.tan_elev")
SMOOTHNESS_SCORE_SQL = _case_sql("s.smoothness", SMOOTHNESS_SCORES, DEFAULT_SMOOTHNESS_SCORE)
SURFACE_TEMP_SQL = _case_sql(
    "s.surface_type", SURFACE_TEMP_CORRECTION, DEFAULT_SURFACE_TEMP_CORRECTION
)


def _surabaya_solar_elevation_deg(dt_wib: datetime) -> float:
    """Fast astronomical solar elevation for Surabaya (-7.2575, 112.7521)."""
    day_of_year = dt_wib.timetuple().tm_yday
    declination = 23.45 * math.sin(math.radians((360.0 / 365.0) * (day_of_year - 81)))
    solar_noon_offset = (SURABAYA_LNG - 105.0) / 15.0
    hour_float = dt_wib.hour + dt_wib.minute / 60.0
    b = math.radians((360.0 / 365.0) * (day_of_year - 81))
    equation_of_time_h = (9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)) / 60.0
    hour_angle = 15.0 * ((hour_float + solar_noon_offset + equation_of_time_h) - 12.0)

    lat_rad = math.radians(SURABAYA_LAT)
    dec_rad = math.radians(declination)
    ha_rad = math.radians(hour_angle)

    sin_elev = (
        math.sin(lat_rad) * math.sin(dec_rad)
        + math.cos(lat_rad) * math.cos(dec_rad) * math.cos(ha_rad)
    )
    elev = math.degrees(math.asin(max(-1.0, min(1.0, sin_elev))))
    return max(0.0, elev)


def _tan_elevation(dt_wib: datetime) -> float:
    """Tangent of solar elevation, floored so shadow lengths stay finite near sunset."""
    elev_deg = max(5.0, _surabaya_solar_elevation_deg(dt_wib))
    return max(0.12, math.tan(math.radians(elev_deg)))


@dataclass(frozen=True)
class LiveInputs:
    air_temp: float
    apparent_temp: float
    aqi_value: float
    traffic_points: list[tuple[float, float, float]]  # (lat, lng, congestion_ratio)
    weather_doc: dict
    sources: dict[str, str]  # input name -> "live" or "cached"


def _resolve_input(
    name: str,
    parse: Callable,
    cached: Callable,
    live: Callable | None = None,
):
    """Return (parsed value, source), trying the live API and then the last real reading.

    Raises LiveDataUnavailable when neither yields a usable value.
    """
    attempts = [("live", live)] if live else []
    attempts.append(("cached", cached))
    for source, loader in attempts:
        try:
            parsed = parse(loader())
        except Exception as exc:
            print(f"  [FastRefresh] {name} ({source}) unavailable: {exc}")
            continue
        if parsed is not None:
            return parsed, source
    raise LiveDataUnavailable(f"no real {name} reading, live or cached")


def _parse_weather(doc: dict | None) -> tuple[float, float, dict] | None:
    current = (doc or {}).get("current") or {}
    temp, apparent = current.get("temperature_2m"), current.get("apparent_temperature")
    if temp is None or apparent is None:
        return None
    return float(temp), float(apparent), doc


def _parse_aqi(doc: dict | None) -> float | None:
    """WAQI reports a missing station reading as the string "-"."""
    try:
        return float((doc or {}).get("aqi"))
    except (TypeError, ValueError):
        return None


def _parse_traffic(points: list[dict] | None) -> list[tuple[float, float, float]] | None:
    """Keep only points with a measured ratio. Speeds above free flow count as 0."""
    parsed = [
        (float(p["lat"]), float(p["lng"]), max(0.0, min(1.0, float(p["congestion_ratio"]))))
        for p in (points or [])
        if p.get("congestion_ratio") is not None
    ]
    return parsed or None


def _fetch_live_environmental_inputs(skip_external_http: bool = False) -> LiveInputs:
    """Collect real inputs, or raise LiveDataUnavailable if any is missing."""
    from ingestion.aqi_collector import fetch_aqi, get_latest_aqi
    from ingestion.traffic_collector import fetch_all_traffic, get_latest_traffic
    from ingestion.weather_collector import fetch_current_weather, get_latest_weather

    (air_temp, apparent_temp, weather_doc), weather_source = _resolve_input(
        "weather",
        _parse_weather,
        get_latest_weather,
        None if skip_external_http else fetch_current_weather,
    )
    aqi_value, aqi_source = _resolve_input(
        "AQI", _parse_aqi, get_latest_aqi, None if skip_external_http else fetch_aqi
    )
    traffic_points, traffic_source = _resolve_input(
        "traffic",
        _parse_traffic,
        get_latest_traffic,
        None if skip_external_http else fetch_all_traffic,
    )
    return LiveInputs(
        air_temp=air_temp,
        apparent_temp=apparent_temp,
        aqi_value=aqi_value,
        traffic_points=traffic_points,
        weather_doc=weather_doc,
        sources={"weather": weather_source, "aqi": aqi_source, "traffic": traffic_source},
    )


def run_fast_refresh(skip_external_http: bool = False) -> dict:
    """Refresh every Surabaya street segment in one transaction."""
    from ingestion.weather_collector import store_hourly_forecast

    t0 = time.perf_counter()
    now_wib = datetime.now(WIB)
    hour_wib = now_wib.hour
    today = now_wib.date()

    try:
        inputs = _fetch_live_environmental_inputs(skip_external_http=skip_external_http)
    except LiveDataUnavailable as exc:
        print(f"[FastRefresh] Skipped, served data left unchanged: {exc}")
        return {"status": "skipped", "reason": str(exc)}

    # Before sunrise and after sunset, direct solar radiation is zero.
    is_daytime = 6 <= hour_wib <= 17
    elev_deg = max(5.0, _surabaya_solar_elevation_deg(now_wib)) if is_daytime else 0.0
    tan_elev = _tan_elevation(now_wib) if is_daytime else 1.0
    hourly_tans = [
        _tan_elevation(now_wib.replace(hour=hour, minute=0)) for hour in DAYLIGHT_HOURS
    ]

    aqi_score = max(0.0, min(1.0, 1.0 - (inputs.aqi_value / 150.0)))
    ratios = [point[2] for point in inputs.traffic_points]

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    try:
        # 1. Ensure spatial context exists and store today's real hourly forecast
        cur.execute("SELECT refresh_segment_spatial_context(FALSE);")
        ctx_count = int(cur.fetchone()[0] or 0)
        forecast_rows = store_hourly_forecast(cur, inputs.weather_doc)

        # 2. NDVI proxy (OSM tree density) and LST proxy (air temp + surface material)
        cur.execute(
            f"""
            INSERT INTO segment_raster_scores (segment_id, avg_ndvi, avg_lst, computed_at)
            SELECT
                s.segment_id,
                ROUND((0.10 + LEAST(COALESCE(ctx.nearby_trees, 0)::numeric / 10.0, 1.0) * 0.62)::numeric, 4)::double precision,
                ROUND((%(air_temp)s + {SURFACE_TEMP_SQL})::numeric, 2)::double precision,
                %(today)s::date
            FROM segments s
            LEFT JOIN segment_spatial_context ctx ON ctx.segment_id = s.segment_id
            ON CONFLICT (segment_id, computed_at) DO UPDATE SET
                avg_ndvi = EXCLUDED.avg_ndvi,
                avg_lst  = EXCLUDED.avg_lst;
            """,
            {"air_temp": inputs.air_temp, "today": today},
        )

        # 3. Shade for the current hour
        if is_daytime:
            cur.execute(
                f"""
                INSERT INTO segment_shadows (segment_id, hour_of_day, shade_ratio, computed_at)
                SELECT
                    s.segment_id,
                    %(hour)s::smallint,
                    {SHADE_NOW_SQL}::double precision,
                    %(today)s::date
                FROM segments s
                LEFT JOIN segment_spatial_context ctx ON ctx.segment_id = s.segment_id
                ON CONFLICT (segment_id, hour_of_day, computed_at) DO UPDATE SET
                    shade_ratio = EXCLUDED.shade_ratio;
                """,
                {"hour": hour_wib, "tan": tan_elev, "today": today},
            )
        else:
            cur.execute(
                """
                INSERT INTO segment_shadows (segment_id, hour_of_day, shade_ratio, computed_at)
                SELECT s.segment_id, %(hour)s::smallint, %(shade)s::double precision, %(today)s::date
                FROM segments s
                ON CONFLICT (segment_id, hour_of_day, computed_at) DO UPDATE SET
                    shade_ratio = EXCLUDED.shade_ratio;
                """,
                {"hour": hour_wib, "shade": NIGHT_SHADE_RATIO, "today": today},
            )

        # 4. Serving table: TCS per segment, using each segment's nearest traffic station
        cur.execute(
            f"""
            WITH stations AS (
                SELECT * FROM unnest(
                    %(st_lat)s::float8[], %(st_lng)s::float8[], %(st_ratio)s::float8[]
                ) AS st(lat, lng, ratio)
            ),
            seg AS (
                SELECT
                    s.segment_id, s.surface_type, s.smoothness, s.length_m,
                    ST_Y(ST_Centroid(s.geom)) AS lat,
                    ST_X(ST_Centroid(s.geom)) AS lng
                FROM segments s
            )
            INSERT INTO segment_live_comfort (
                segment_id, tcs_value, apparent_temp, shade_ratio, shade_by_hour,
                avg_ndvi, avg_lst, aqi_value, traffic_level, updated_at
            )
            SELECT
                s.segment_id,
                LEAST(1.0, GREATEST(0.0,
                    0.35 * LEAST(1.0, 0.7 * sh.shade_ratio + 0.3 * LEAST(rs.avg_ndvi * 2.0, 1.0))
                    + 0.30 * LEAST(1.0, GREATEST(0.0, 1.0 - (((0.6 * %(apparent)s + 0.4 * rs.avg_lst) - 28.0) / 17.0)))
                    + 0.15 * %(aqi_score)s
                    + 0.10 * LEAST(1.0, GREATEST(0.0, 1.0 - nearest.ratio))
                    + 0.10 * (0.5 * {SURFACE_SCORE_SQL} + 0.5 * {SMOOTHNESS_SCORE_SQL})
                ))::double precision,
                %(apparent)s::double precision,
                sh.shade_ratio::double precision,
                ARRAY(
                    SELECT ({SHADE_BY_HOUR_SQL})::real
                    FROM unnest(%(hourly_tans)s::float8[]) WITH ORDINALITY AS u(tan_elev, ord)
                    ORDER BY u.ord
                ),
                rs.avg_ndvi::double precision,
                rs.avg_lst::double precision,
                %(aqi_value)s::double precision,
                nearest.ratio::double precision,
                NOW()
            FROM seg s
            JOIN segment_raster_scores rs
                ON rs.segment_id = s.segment_id AND rs.computed_at::date = %(today)s::date
            JOIN segment_shadows sh
                ON sh.segment_id = s.segment_id
               AND sh.hour_of_day::smallint = %(hour)s::smallint
               AND sh.computed_at::date = %(today)s::date
            LEFT JOIN segment_spatial_context ctx ON ctx.segment_id = s.segment_id
            CROSS JOIN LATERAL (
                SELECT st.ratio FROM stations st
                ORDER BY (st.lat - s.lat) ^ 2 + (st.lng - s.lng) ^ 2
                LIMIT 1
            ) nearest
            ON CONFLICT (segment_id) DO UPDATE SET
                tcs_value     = EXCLUDED.tcs_value,
                apparent_temp = EXCLUDED.apparent_temp,
                shade_ratio   = EXCLUDED.shade_ratio,
                shade_by_hour = EXCLUDED.shade_by_hour,
                avg_ndvi      = EXCLUDED.avg_ndvi,
                avg_lst       = EXCLUDED.avg_lst,
                aqi_value     = EXCLUDED.aqi_value,
                traffic_level = EXCLUDED.traffic_level,
                updated_at    = NOW();
            """,
            {
                "st_lat": [point[0] for point in inputs.traffic_points],
                "st_lng": [point[1] for point in inputs.traffic_points],
                "st_ratio": ratios,
                "apparent": inputs.apparent_temp,
                "aqi_score": aqi_score,
                "aqi_value": inputs.aqi_value,
                "hourly_tans": hourly_tans,
                "today": today,
                "hour": hour_wib,
            },
        )
        updated_segments = cur.rowcount

        # Latest snapshot for sync_segment_live_comfort and the Supabase copy
        cur.execute("TRUNCATE TABLE thermal_comfort_scores RESTART IDENTITY;")
        cur.execute(
            """
            INSERT INTO thermal_comfort_scores (
                segment_id, tcs_value, apparent_temp, shade_ratio, aqi_value, traffic_level, computed_at
            )
            SELECT
                segment_id, tcs_value, apparent_temp, shade_ratio, aqi_value, traffic_level, updated_at
            FROM segment_live_comfort;
            """
        )

        # 5. Intervention scenarios from the TCS formula's own sensitivity (source = 'formula').
        # Spark Job 6 writes the MLlib variant (source = 'mllib'); the UI labels which one is shown.
        # Green: +0.25 NDVI and +0.20 canopy shade. Cool pavement: -3.5 C surface temperature.
        cur.execute(
            """
            WITH scenario AS (
                SELECT
                    lc.segment_id,
                    lc.tcs_value AS current_tcs,
                    LEAST(1.0, lc.tcs_value + (
                        0.35 * (
                            0.7 * LEAST(0.20, GREATEST(0.0, 0.95 - day.avg_shade))
                            + 0.3 * GREATEST(0.0, LEAST(1.0, LEAST(0.72, lc.avg_ndvi + 0.25) * 2.0) - LEAST(1.0, lc.avg_ndvi * 2.0))
                        )
                    )) AS green,
                    LEAST(1.0, lc.tcs_value + (
                        0.30 * 0.4 * LEAST(3.5, GREATEST(0.0, lc.avg_lst - 28.0)) / 17.0
                    )) AS cool
                FROM segment_live_comfort lc
                CROSS JOIN LATERAL (
                    SELECT AVG(hourly)::double precision AS avg_shade FROM unnest(lc.shade_by_hour) AS hourly
                ) day
            )
            INSERT INTO tcs_simulations (
                segment_id, current_tcs, predicted_tcs_green, predicted_tcs_cool,
                tcs_improvement_green, tcs_improvement_cool, simulated_at, source
            )
            SELECT segment_id, current_tcs, green, cool, green - current_tcs, cool - current_tcs, NOW(), 'formula'
            FROM scenario
            ON CONFLICT (segment_id) DO UPDATE SET
                current_tcs           = EXCLUDED.current_tcs,
                predicted_tcs_green   = EXCLUDED.predicted_tcs_green,
                predicted_tcs_cool    = EXCLUDED.predicted_tcs_cool,
                tcs_improvement_green = EXCLUDED.tcs_improvement_green,
                tcs_improvement_cool  = EXCLUDED.tcs_improvement_cool,
                simulated_at          = NOW(),
                source                = EXCLUDED.source;
            """
        )

        conn.commit()
    finally:
        cur.close()
        conn.close()

    elapsed = round(time.perf_counter() - t0, 2)
    summary = {
        "status": "ok",
        "elapsed_sec": elapsed,
        "segments_updated": updated_segments,
        "spatial_context_rows": ctx_count,
        "forecast_rows": forecast_rows,
        "hour_wib": hour_wib,
        "solar_elevation_deg": round(elev_deg, 1),
        "air_temp_c": inputs.air_temp,
        "apparent_temp_c": inputs.apparent_temp,
        "aqi_value": inputs.aqi_value,
        "traffic_ratio_avg": round(sum(ratios) / len(ratios), 3),
        "input_sources": inputs.sources,
    }
    print(f"[FastRefresh] Updated {updated_segments} segments in {elapsed}s -> {summary}")
    return summary


if __name__ == "__main__":
    run_fast_refresh()
