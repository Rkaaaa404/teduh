"""Dashboard API routes - High-speed Surabaya analytics backed by `segment_live_comfort` + 60s TTL cache."""
from __future__ import annotations

import json
from fastapi import APIRouter, HTTPException

from api.conditions import (
    HourConditions,
    apparent_at_hour_sql,
    build_hourly_trend,
    shade_at_hour_sql,
    tcs_at_hour_sql,
    wib_hour,
)
from api.models.schemas import (
    UHIResponse,
    UHISummary,
    UHIHotspot,
    PriorityCorridorsResponse,
    PriorityCorridor,
    WalkabilityStats,
)
from api.db import ALERT_SEVERITY_RANK_SQL, get_conn, ttl_cache_get, ttl_cache_set

router = APIRouter()


async def _peak_conditions(conn) -> HourConditions:
    """The hottest daylight hour of the latest forecast.

    Planning outputs are judged at this hour. Otherwise they would depend on when
    the data was refreshed, and be empty after a night-time refresh.
    """
    row = await conn.fetchrow(
        """
        SELECT hour_of_day, apparent_temp
        FROM weather_hourly_forecast
        WHERE hour_of_day BETWEEN 6 AND 17
          AND forecast_date = (SELECT MAX(forecast_date) FROM weather_hourly_forecast)
        ORDER BY apparent_temp DESC, hour_of_day
        LIMIT 1
        """
    )
    if row is None:
        return HourConditions(hour=wib_hour(None), basis="current")
    return HourConditions(
        hour=row["hour_of_day"], basis="forecast", apparent_temp=float(row["apparent_temp"])
    )


def _reported_hour(conditions: HourConditions) -> int | None:
    return conditions.hour if conditions.basis == "forecast" else None


@router.get("/uhi", response_model=UHIResponse)
async def get_uhi_hotspots():
    """Get Urban Heat Island hotspot map data using O(1) `segment_live_comfort`."""
    cached = ttl_cache_get("dashboard:uhi")
    if cached is not None:
        return cached

    async with get_conn() as conn:
        conditions = await _peak_conditions(conn)
        tcs = tcs_at_hour_sql(conditions)
        summary_row = await conn.fetchrow(
            f"""
            SELECT
                COUNT(*) AS total_segments,
                COUNT(*) FILTER (WHERE ({tcs}) < 0.4) AS critical_segments,
                COALESCE(AVG({tcs}), 0) AS avg_city_tcs,
                MAX(lc.updated_at) AS data_as_of
            FROM segment_live_comfort lc
            """
        )

        hotspot_rows = await conn.fetch(
            f"""
            SELECT
                s.segment_id,
                s.name,
                ST_AsGeoJSON(s.geom, 5) AS geometry,
                lc.avg_lst,
                ({tcs}) AS avg_tcs,
                ({shade_at_hour_sql(conditions)}) AS shade_ratio
            FROM segment_live_comfort lc
            JOIN segments s ON s.segment_id = lc.segment_id
            WHERE ({tcs}) < 0.55
            ORDER BY avg_tcs ASC
            LIMIT 100
            """
        )

    hotspots = [
        UHIHotspot(
            segment_id=row["segment_id"],
            geometry=json.loads(row["geometry"]) if isinstance(row["geometry"], str) else row["geometry"],
            avg_lst=round(float(row["avg_lst"]), 1),
            avg_tcs=round(float(row["avg_tcs"]), 3),
            street_name=row["name"],
            shade_ratio=round(float(row["shade_ratio"]), 3),
        )
        for row in hotspot_rows
    ]

    resp = UHIResponse(
        hotspots=hotspots,
        summary=UHISummary(
            total_segments=summary_row["total_segments"] or 0,
            critical_segments=summary_row["critical_segments"] or 0,
            avg_city_tcs=round(float(summary_row["avg_city_tcs"] or 0), 3),
            data_as_of=summary_row["data_as_of"],
            conditions_hour=_reported_hour(conditions),
        ),
    )
    ttl_cache_set("dashboard:uhi", resp, ttl_sec=60.0)
    return resp


@router.get("/priority-corridors", response_model=PriorityCorridorsResponse)
async def get_priority_corridors():
    """Get recommended corridors for greening/canopy installation."""
    cached = ttl_cache_get("dashboard:priority_corridors")
    if cached is not None:
        return cached

    async with get_conn() as conn:
        conditions = await _peak_conditions(conn)
        tcs = tcs_at_hour_sql(conditions)
        rows = await conn.fetch(
            f"""
            WITH corridors AS (
                SELECT
                    COALESCE(s.name, 'Unnamed ' || COALESCE(s.highway_type, 'path') || ' corridor') AS corridor_name,
                    ARRAY_AGG(s.segment_id) AS segment_ids,
                    AVG({tcs}) AS avg_tcs,
                    AVG({shade_at_hour_sql(conditions)}) AS avg_shade,
                    AVG({apparent_at_hour_sql(conditions)}) AS avg_temp,
                    AVG(lc.aqi_value) AS avg_aqi,
                    AVG(lc.traffic_level) AS avg_traffic,
                    ST_Centroid(ST_Collect(s.geom)) AS corridor_center
                FROM segment_live_comfort lc
                JOIN segments s ON s.segment_id = lc.segment_id
                WHERE ({tcs}) < 0.58
                GROUP BY COALESCE(s.name, 'Unnamed ' || COALESCE(s.highway_type, 'path') || ' corridor')
            )
            SELECT
                c.corridor_name,
                c.segment_ids,
                c.avg_tcs,
                c.avg_shade,
                c.avg_temp,
                c.avg_aqi,
                c.avg_traffic,
                COALESCE(tr.cnt, 0) AS max_transit,
                tr.nearest_name AS nearest_transit_name,
                (1.0 - c.avg_tcs) * 0.6 + LEAST(COALESCE(tr.cnt, 0)::float / 3.0, 1.0) * 0.4 AS priority_score
            FROM corridors c
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) FILTER (WHERE ST_DWithin(t.geom, c.corridor_center, 0.003)) AS cnt,
                    (SELECT t2.name FROM transit_stops t2 ORDER BY t2.geom <-> c.corridor_center LIMIT 1) AS nearest_name
                FROM transit_stops t
            ) tr ON true
            ORDER BY priority_score DESC
            LIMIT 15
            """
        )

    corridors = []
    for row in rows:
        transit_count = row["max_transit"] or 0
        access = "high" if transit_count >= 2 else ("medium" if transit_count >= 1 else "low")
        avg_tcs = float(row["avg_tcs"])
        avg_shade = float(row["avg_shade"])
        avg_temp = float(row["avg_temp"])
        avg_aqi = float(row["avg_aqi"])
        avg_traffic = float(row["avg_traffic"])

        recs = []
        if avg_shade < 0.25:
            recs.append("Tanam pohon peneduh / pergola")
        if avg_temp > 35.5:
            recs.append("Material permukaan jalan dingin (cool pavement)")
        if avg_aqi > 100.0 or avg_traffic > 0.45:
            recs.append("Barikade vegetasi penyerap polusi (green barrier)")

        if not recs:
            if avg_tcs < 0.4:
                recs.append("Prioritas Tinggi: Intervensi kenyamanan terpadu")
            else:
                recs.append("Sedang: Perawatan rutin trotoar & vegetasi")

        corridors.append(
            PriorityCorridor(
                corridor_name=row["corridor_name"],
                segments=row["segment_ids"][:10],
                avg_tcs=round(avg_tcs, 3),
                transit_access=access,
                nearest_transit=row["nearest_transit_name"],
                recommendation=" & ".join(recs),
                priority_score=round(float(row["priority_score"]), 3),
            )
        )

    resp = PriorityCorridorsResponse(corridors=corridors)
    ttl_cache_set("dashboard:priority_corridors", resp, ttl_sec=60.0)
    return resp


@router.get("/walkability", response_model=WalkabilityStats)
async def get_walkability_stats():
    """Get walkability and transit accessibility statistics."""
    cached = ttl_cache_get("dashboard:walkability")
    if cached is not None:
        return cached

    async with get_conn() as conn:
        conditions = await _peak_conditions(conn)
        tcs = tcs_at_hour_sql(conditions)
        row = await conn.fetchrow(
            f"""
            WITH transit_access AS (
                SELECT
                    ts.stop_id,
                    AVG({tcs}) AS avg_surrounding_tcs
                FROM transit_stops ts
                LEFT JOIN segments s
                    ON s.geom && ST_Expand(ts.geom, 0.007)
                   AND ST_DWithin(s.geom, ts.geom, 0.007)
                LEFT JOIN segment_live_comfort lc ON lc.segment_id = s.segment_id
                GROUP BY ts.stop_id
            )
            SELECT
                COUNT(*) AS total_stops,
                COUNT(*) FILTER (WHERE avg_surrounding_tcs > 0.55) AS comfortable,
                COALESCE(
                    COUNT(*) FILTER (WHERE avg_surrounding_tcs > 0.55)::float / NULLIF(COUNT(*), 0) * 100,
                    0
                ) AS comfortable_pct
            FROM transit_access
            """
        )

        avg_tcs_val = await conn.fetchval(f"SELECT COALESCE(AVG({tcs}), 0) FROM segment_live_comfort lc")

    resp = WalkabilityStats(
        total_transit_stops=row["total_stops"] or 0,
        comfortable_stops=row["comfortable"] or 0,
        comfortable_percentage=round(float(row["comfortable_pct"] or 0), 1),
        avg_tcs_city=round(float(avg_tcs_val or 0.0), 3),
        conditions_hour=_reported_hour(conditions),
    )
    ttl_cache_set("dashboard:walkability", resp, ttl_sec=60.0)
    return resp


@router.get("/active-alerts")
async def get_active_alerts():
    """Get active weather warnings."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            f"""
            SELECT title, severity, description, issued_at, expires_at
            FROM weather_alerts
            WHERE is_active = TRUE
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY {ALERT_SEVERITY_RANK_SQL}, issued_at DESC
            """
        )
    return [
        {
            "title": row["title"],
            "severity": row["severity"],
            "description": row["description"],
            "issued_at": str(row["issued_at"]) if row["issued_at"] else None,
            "expires_at": str(row["expires_at"]) if row["expires_at"] else None,
        }
        for row in rows
    ]


@router.get("/temperature-heatmap")
async def get_temperature_heatmap():
    """Get centroids of segments with effective surface/apparent temperatures for lightweight UHI rendering."""
    cached = ttl_cache_get("dashboard:temp_heatmap")
    if cached is not None:
        return cached

    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT
                s.segment_id,
                (0.6 * lc.apparent_temp + 0.4 * lc.avg_lst) AS temp,
                ST_X(ST_Centroid(s.geom)) AS lng,
                ST_Y(ST_Centroid(s.geom)) AS lat
            FROM segment_live_comfort lc
            JOIN segments s ON s.segment_id = lc.segment_id
            WHERE COALESCE(s.length_m, 0) >= 20
            ORDER BY lc.tcs_value ASC
            LIMIT 2000
            """
        )

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(float(row["lng"]), 5), round(float(row["lat"]), 5)],
                },
                "properties": {
                    "temp": round(float(row["temp"]), 1),
                    "segment_id": row["segment_id"],
                },
            }
            for row in rows
            if row["lng"] is not None and row["lat"] is not None
        ],
    }
    ttl_cache_set("dashboard:temp_heatmap", geojson, ttl_sec=60.0)
    return geojson


@router.get("/simulations")
async def get_tcs_simulations():
    """Get AI/ML scenario simulation comparison results."""
    cached = ttl_cache_get("dashboard:simulations")
    if cached is not None:
        return cached

    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT
                s.segment_id,
                s.name AS street_name,
                ST_AsGeoJSON(s.geom, 5) AS geometry,
                sim.current_tcs,
                sim.predicted_tcs_green,
                sim.predicted_tcs_cool,
                sim.tcs_improvement_green,
                sim.tcs_improvement_cool,
                sim.source
            FROM tcs_simulations sim
            JOIN segments s ON s.segment_id = sim.segment_id
            ORDER BY sim.tcs_improvement_green DESC
            LIMIT 50
            """
        )

    resp = [
        {
            "segment_id": row["segment_id"],
            "street_name": row["street_name"] or f"Segment #{row['segment_id']}",
            "geometry": json.loads(row["geometry"]) if isinstance(row["geometry"], str) else row["geometry"],
            "current_tcs": round(row["current_tcs"], 3),
            "predicted_tcs_green": round(row["predicted_tcs_green"], 3),
            "predicted_tcs_cool": round(row["predicted_tcs_cool"], 3),
            "tcs_improvement_green": round(row["tcs_improvement_green"], 3),
            "tcs_improvement_cool": round(row["tcs_improvement_cool"], 3),
            "source": row["source"],
        }
        for row in rows
    ]
    ttl_cache_set("dashboard:simulations", resp, ttl_sec=60.0)
    return resp


@router.get("/heat-prediction")
async def get_heat_prediction():
    """Daily heat outlook: real hourly forecast plus stored per-segment comfort and scenarios."""
    cached = ttl_cache_get("dashboard:heat_prediction")
    if cached is not None:
        return cached

    async with get_conn() as conn:
        hot_rows = await conn.fetch(
            """
            SELECT
                s.segment_id,
                COALESCE(s.name, COALESCE(s.highway_type, 'path') || ' #' || s.segment_id::text) AS street_name,
                s.highway_type,
                s.has_shade_tree,
                lc.tcs_value AS current_tcs,
                lc.apparent_temp,
                lc.shade_ratio,
                lc.aqi_value,
                sim.predicted_tcs_green,
                sim.predicted_tcs_cool
            FROM segment_live_comfort lc
            JOIN tcs_simulations sim ON lc.segment_id = sim.segment_id
            JOIN segments s ON lc.segment_id = s.segment_id
            ORDER BY lc.tcs_value ASC
            LIMIT 50
            """
        )

        agg_row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) FILTER (WHERE lc.tcs_value < 0.5) AS hot_count,
                COUNT(*) FILTER (WHERE lc.tcs_value BETWEEN 0.5 AND 0.65) AS warm_count,
                COUNT(*) FILTER (WHERE lc.tcs_value > 0.65) AS cool_count,
                COUNT(*) AS total_count,
                AVG(lc.tcs_value) AS avg_tcs,
                AVG(lc.apparent_temp) AS avg_apparent_temp,
                MAX(0.6 * lc.apparent_temp + 0.4 * lc.avg_lst) AS max_apparent_temp,
                AVG(lc.shade_ratio) AS avg_shade,
                AVG(sim.predicted_tcs_green) AS avg_green_tcs,
                AVG(sim.predicted_tcs_cool) AS avg_cool_tcs,
                MODE() WITHIN GROUP (ORDER BY sim.source) AS simulation_source
            FROM segment_live_comfort lc
            LEFT JOIN tcs_simulations sim ON lc.segment_id = sim.segment_id
            """
        )

        forecast_rows = await conn.fetch(
            """
            SELECT hour_of_day, apparent_temp
            FROM weather_hourly_forecast
            WHERE forecast_date = (SELECT MAX(forecast_date) FROM weather_hourly_forecast)
              AND hour_of_day BETWEEN 6 AND 21
            ORDER BY hour_of_day
            """
        )

        shade_rows = await conn.fetch(
            """
            SELECT slot, AVG(lc.shade_by_hour[slot])::double precision AS avg_shade
            FROM segment_live_comfort lc
            CROSS JOIN generate_series(1, 12) AS slot
            GROUP BY slot
            """
        )

    total = int(agg_row["total_count"] or 0)
    if total == 0:
        raise HTTPException(status_code=503, detail="Data kenyamanan termal belum tersedia.")

    avg_tcs = float(agg_row["avg_tcs"])
    base_app_temp = float(agg_row["avg_apparent_temp"])
    forecast = [(int(row["hour_of_day"]), float(row["apparent_temp"])) for row in forecast_rows]

    hourly_trend = build_hourly_trend(
        avg_tcs=avg_tcs,
        avg_green=float(agg_row["avg_green_tcs"]) if agg_row["avg_green_tcs"] is not None else None,
        avg_cool=float(agg_row["avg_cool_tcs"]) if agg_row["avg_cool_tcs"] is not None else None,
        avg_shade_now=float(agg_row["avg_shade"]),
        avg_apparent_now=base_app_temp,
        shade_by_slot={row["slot"]: row["avg_shade"] for row in shade_rows if row["avg_shade"] is not None},
        forecast=forecast,
    )
    peak_heat_hour = max(forecast, key=lambda point: point[1])[0] if forecast else None

    hot_count = int(agg_row["hot_count"] or 0)
    warm_count = int(agg_row["warm_count"] or 0)
    cool_count = int(agg_row["cool_count"] or 0)

    hot_zones = []
    for row in hot_rows:
        current = float(row["current_tcs"])
        green = float(row["predicted_tcs_green"])
        cool_pred = float(row["predicted_tcs_cool"])
        improvement_pct = round((green - current) / max(current, 0.01) * 100, 1)
        hot_zones.append(
            {
                "segment_id": row["segment_id"],
                "street_name": row["street_name"],
                "highway_type": row["highway_type"] or "path",
                "has_shade_tree": bool(row["has_shade_tree"]),
                "current_tcs": round(current, 3),
                "apparent_temp": round(float(row["apparent_temp"]), 1),
                "shade_ratio": round(float(row["shade_ratio"]), 2),
                "predicted_tcs_green": round(green, 3),
                "predicted_tcs_cool": round(cool_pred, 3),
                "improvement_pct": improvement_pct,
                "severity": "critical" if current < 0.45 else "hot" if current < 0.55 else "warm",
            }
        )

    resp = {
        "summary": {
            "total_segments": total,
            "hot_segments": hot_count,
            "warm_segments": warm_count,
            "cool_segments": cool_count,
            "hot_percentage": round(hot_count / total * 100, 1),
            "avg_city_tcs": round(avg_tcs, 3),
            "avg_apparent_temp": round(base_app_temp, 1),
            "max_apparent_temp": round(float(agg_row["max_apparent_temp"]), 1),
            "peak_heat_hour": peak_heat_hour,
            "simulation_source": agg_row["simulation_source"],
        },
        "hourly_trend": hourly_trend,
        "hot_zones": hot_zones,
    }
    ttl_cache_set("dashboard:heat_prediction", resp, ttl_sec=60.0)
    return resp
