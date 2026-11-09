"""Navigation API routes - Corridor-pruned pgRouting with O(1) TCS Serving Layer."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from typing import Optional

from api.models.schemas import RouteRequest, RouteResponse
from api.conditions import (
    HourConditions,
    apparent_at_hour_sql,
    is_daylight,
    shade_at_hour_sql,
    tcs_at_hour_sql,
    wib_hour,
)
from api.db import ALERT_SEVERITY_RANK_SQL, get_conn, ttl_cache_clear

router = APIRouter()

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")


def require_admin(x_admin_token: Optional[str] = Header(default=None)) -> None:
    """Guard for debug/admin endpoints.

    They answer only to a matching ``X-Admin-Token``. With no ADMIN_TOKEN configured
    they stay disabled and return 404.
    """
    if not ADMIN_TOKEN or not x_admin_token or not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(status_code=404, detail="Not Found")


# Penalty multiplier per heat tolerance level
# Applies only to the "most_comfortable" route cost calculation.
# Uses a SQUARED penalty formula: cost * (1 + mult * (1-tcs)^2 * 5)
# This creates a non-linear, aggressive penalty on hot segments (TCS < 0.5)
# and a near-zero penalty on comfortable segments (TCS > 0.7).
# The 5x amplifier is needed because real-world TCS spread is narrow (~0.05 stddev),
# so without amplification Dijkstra always finds the same shortest-distance path.
#   Low tolerance  → mult=5.0  → hot segment penalty up to ~10-15x base cost
#   Medium tolerance → mult=3.0 → hot segment penalty up to ~5-8x base cost
#   High tolerance  → mult=0.8  → minimal penalty, prefers shortest distance
_PENALTY_MULT = {"low": 5.0, "medium": 3.0, "high": 0.8}

# ~2.8 km corridor buffer around (origin, destination) bounding box
_CORRIDOR_BUFFER_DEG = 0.025

_MAX_SEGMENT_DETAILS = 15
_NEUTRAL_TCS_FOR_COST = 0.5  # path-finding only, never reported to users

# Approved map alerts, as a cost multiplier on edges nearby. A large cost rather than
# removing the edge, so a closure can never make a destination unreachable. Heat
# reports are absent because TCS already prices heat.
_ALERT_COST_MULT = {
    "road_closed": 50.0,
    "flood": 50.0,
    "construction": 4.0,
    "accident": 4.0,
    "damaged": 4.0,
}
_ALERT_RADIUS_M = 25.0


async def _resolve_conditions(conn, departure: datetime | None) -> HourConditions:
    """Use the stored forecast for the departure hour, else the latest served data."""
    hour = wib_hour(departure)
    if departure is None:
        return HourConditions(hour=hour, basis="current")

    apparent = await conn.fetchval(
        """
        SELECT apparent_temp FROM weather_hourly_forecast
        WHERE hour_of_day = $1
        ORDER BY forecast_date DESC
        LIMIT 1
        """,
        hour,
    )
    if apparent is None:
        return HourConditions(hour=hour, basis="current")
    return HourConditions(hour=hour, basis="forecast", apparent_temp=float(apparent))


@router.post("/route", response_model=RouteResponse)
async def calculate_route(request: RouteRequest):
    """Calculate shortest and most comfortable routes using corridor-pruned pgRouting."""
    for point, label in [(request.origin, "origin"), (request.destination, "destination")]:
        if not (-7.35 <= point.lat <= -7.20 and 112.60 <= point.lng <= 112.85):
            raise HTTPException(status_code=400, detail=f"{label} di luar area Surabaya")

    heat_tolerance = "medium"
    budget_limit = 15.0
    if request.user_profile:
        heat_tolerance = request.user_profile.heat_tolerance
        budget_limit = {"low": 8.0, "medium": 15.0, "high": 25.0}.get(heat_tolerance, 15.0)

    origin = request.origin
    dest = request.destination

    bbox = (
        min(origin.lng, dest.lng) - _CORRIDOR_BUFFER_DEG,
        min(origin.lat, dest.lat) - _CORRIDOR_BUFFER_DEG,
        max(origin.lng, dest.lng) + _CORRIDOR_BUFFER_DEG,
        max(origin.lat, dest.lat) + _CORRIDOR_BUFFER_DEG,
    )

    async with get_conn() as conn:
        source_node = await _find_nearest_node(conn, origin.lng, origin.lat)
        target_node = await _find_nearest_node(conn, dest.lng, dest.lat)

        if not source_node or not target_node or source_node == target_node:
            return _empty_response(budget_limit)


        # Alerts are advisory: BMKG feeds name a region, not a corridor to route around.
        alert_row = await conn.fetchrow(
            f"""
            SELECT title, severity, description
            FROM weather_alerts
            WHERE is_active = TRUE
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY {ALERT_SEVERITY_RANK_SQL}, issued_at DESC
            LIMIT 1
            """
        )
        weather_alert_str = None
        if alert_row:
            sev = (alert_row["severity"] or "").upper()
            weather_alert_str = f"[{sev}] {alert_row['title']}: {alert_row['description']}"

        conditions = await _resolve_conditions(conn, request.departure_time)
        alert_costs = await _alert_edge_costs(conn)
        data_as_of = await conn.fetchval("SELECT MAX(updated_at) FROM segment_live_comfort")

        shortest = await _run_pgr_route(
            conn,
            source_node,
            target_node,
            "shortest",
            budget_limit,
            heat_tolerance,
            conditions=conditions,
            alert_costs=alert_costs,
            bbox=bbox,
        )
        comfortable = await _run_pgr_route(
            conn,
            source_node,
            target_node,
            "most_comfortable",
            budget_limit,
            heat_tolerance,
            conditions=conditions,
            alert_costs=alert_costs,
            bbox=bbox,
        )

    return RouteResponse(
        routes=[shortest, comfortable],
        weather_alert=weather_alert_str,
        heat_budget={"budget_limit_min": budget_limit, "recommended_route": "most_comfortable"},
        conditions_hour=conditions.hour if conditions.basis == "forecast" else None,
        time_basis=conditions.basis,
        data_as_of=data_as_of,
    )


async def _find_nearest_node(conn, lng: float, lat: float) -> int | None:
    """Find the nearest connected pgRouting node to a coordinate using GiST KNN."""
    row = await conn.fetchrow(
        """
        SELECT id FROM segments_noded_vertices_pgr
        WHERE component_size IS NULL OR component_size > 10
        ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
        LIMIT 1
        """,
        lng,
        lat,
    )
    return row["id"] if row else None


async def _alert_edge_costs(conn) -> dict[int, float]:
    """Cost multiplier per routing edge near an active approved map alert."""
    rows = await conn.fetch(
        """
        SELECT sn.id, MAX(mult.value) AS multiplier
        FROM map_alerts a
        JOIN unnest($1::text[], $2::float8[]) AS mult(category, value) ON mult.category = a.category
        JOIN segments_noded sn
          ON sn.geom && ST_Expand(a.geom, 0.0005)
         AND ST_DWithin(sn.geom::geography, a.geom::geography, $3)
        WHERE a.status = 'ACTIVE'
        GROUP BY sn.id
        """,
        list(_ALERT_COST_MULT),
        list(_ALERT_COST_MULT.values()),
        _ALERT_RADIUS_M,
    )
    return {row["id"]: row["multiplier"] for row in rows}


def _with_alert_costs(cost_sql: str, alert_costs: dict[int, float]) -> str:
    """Multiply an edge cost expression by the alert multipliers, if there are any."""
    if not alert_costs:
        return cost_sql
    edges_by_multiplier: dict[float, list[str]] = {}
    for edge_id, multiplier in alert_costs.items():
        edges_by_multiplier.setdefault(multiplier, []).append(str(int(edge_id)))
    branches = " ".join(
        f"WHEN sn.id = ANY(ARRAY[{','.join(edges)}]) THEN {multiplier}"
        for multiplier, edges in sorted(edges_by_multiplier.items(), reverse=True)
    )
    return f"({cost_sql} * CASE {branches} ELSE 1.0 END)"


async def _execute_dijkstra_sql(
    conn,
    source: int,
    target: int,
    cost_sql: str,
    joins_sql: str,
    conditions: HourConditions,
    bbox: tuple[float, float, float, float] | None,
):
    bbox_filter = ""
    if bbox is not None:
        w, s, e, n = bbox
        bbox_filter = (
            f" AND sn.geom && ST_MakeEnvelope({w:.6f}, {s:.6f}, {e:.6f}, {n:.6f}, 4326)"
        )

    inner_edges_sql = (
        f"SELECT sn.id, sn.source::integer, sn.target::integer, "
        f"{cost_sql} AS cost, "
        f"{cost_sql} AS reverse_cost "
        f"FROM segments_noded sn {joins_sql} "
        f"WHERE sn.source IS NOT NULL AND sn.target IS NOT NULL{bbox_filter}"
    )

    return await conn.fetch(
        f"""
        SELECT
            r.seq,
            sn.old_id AS segment_id,
            sn.length_m AS length_m,
            s.surface_type,
            ({tcs_at_hour_sql(conditions)})::double precision AS tcs_value,
            ({shade_at_hour_sql(conditions)})::double precision AS shade_ratio,
            ({apparent_at_hour_sql(conditions)})::double precision AS apparent_temp,
            ST_AsGeoJSON(sn.geom, 6) AS geom_json
        FROM pgr_dijkstra(
            '{inner_edges_sql}',
            $1::bigint, $2::bigint, directed := false
        ) r
        JOIN segments_noded sn ON r.edge = sn.id
        JOIN segments s ON sn.old_id = s.segment_id
        LEFT JOIN segment_live_comfort lc ON lc.segment_id = s.segment_id
        WHERE r.edge > 0
        ORDER BY r.seq
        """,
        source,
        target,
    )


async def _run_pgr_route(
    conn,
    source: int,
    target: int,
    route_type: str,
    budget_limit: float,
    heat_tolerance: str,
    conditions: HourConditions,
    alert_costs: dict[int, float],
    bbox: tuple[float, float, float, float] | None = None,
) -> dict:
    """Run corridor-pruned pgr_dijkstra with automatic full-graph fallback."""
    penalty_mult = _PENALTY_MULT.get(heat_tolerance, 3.0)

    if route_type == "shortest":
        cost_sql = "(COALESCE(sn.length_m, 50) / 1.33)"
        joins_sql = ""
    else:
        cost_sql = (
            f"((COALESCE(sn.length_m, 50) / 1.33) * "
            f"(1.0 + {penalty_mult} * POWER(1.0 - COALESCE({tcs_at_hour_sql(conditions)}, {_NEUTRAL_TCS_FOR_COST}), 2) * 5.0))"
        )
        joins_sql = "LEFT JOIN segment_live_comfort lc ON lc.segment_id = sn.old_id"

    cost_sql = _with_alert_costs(cost_sql, alert_costs)

    try:
        # 1st attempt: fast corridor-pruned subgraph (~2k-5k edges instead of 58k)
        rows = await _execute_dijkstra_sql(
            conn, source, target, cost_sql, joins_sql, conditions, bbox
        )
        # Fallback to full-city graph if corridor was disconnected
        if not rows and bbox is not None:
            rows = await _execute_dijkstra_sql(
                conn, source, target, cost_sql, joins_sql, conditions, None
            )
    except Exception as e:
        print(f"[Route] pgr_dijkstra failed: {e}")
        raise HTTPException(status_code=503, detail="Mesin rute sedang tidak tersedia") from e

    if not rows:
        return _empty_route(route_type)

    summary = summarize_route_rows(rows, route_type, budget_limit, is_daylight(conditions.hour))
    if summary is None:
        raise HTTPException(
            status_code=503,
            detail="Data kenyamanan termal belum tersedia untuk rute ini. Jalankan pipeline terlebih dahulu.",
        )
    return summary


def _sample_evenly(items: list, limit: int) -> list:
    """Pick `limit` items spread along the list, always keeping both ends."""
    if len(items) <= limit:
        return items
    last = len(items) - 1
    return [items[round(i * last / (limit - 1))] for i in range(limit)]


def _append_coordinates(line: list, coords: list) -> None:
    """Extend a route line, flipping segments so they join end to end."""
    if line:
        last = line[-1]
        d_fwd = (last[0] - coords[0][0]) ** 2 + (last[1] - coords[0][1]) ** 2
        d_rev = (last[0] - coords[-1][0]) ** 2 + (last[1] - coords[-1][1]) ** 2
        if d_rev < d_fwd:
            coords = list(reversed(coords))
        if ((last[0] - coords[0][0]) ** 2 + (last[1] - coords[0][1]) ** 2) < 1e-10:
            coords = coords[1:]
    line.extend(coords)


def summarize_route_rows(
    rows: list,
    route_type: str,
    budget_limit: float,
    daylight: bool,
) -> dict | None:
    """Build a route result from pgRouting rows, averaging by walked length.

    Segments without a real score are excluded from the averages. Returns None
    when no segment on the route has one.
    """
    all_coords: list = []
    segments: list[dict] = []
    total_distance = 0.0
    scored_length = 0.0
    weighted_tcs = 0.0
    weighted_shade = 0.0

    for row in rows:
        geom = json.loads(row["geom_json"]) if isinstance(row["geom_json"], str) else row["geom_json"]
        length = row["length_m"] or 0.0
        tcs = row["tcs_value"]
        shade = row["shade_ratio"]
        total_distance += length

        if tcs is not None and shade is not None:
            scored_length += length
            weighted_tcs += tcs * length
            weighted_shade += shade * length

        if geom and geom.get("coordinates"):
            _append_coordinates(all_coords, geom["coordinates"])

        segments.append(
            {
                "segment_id": row["segment_id"],
                "tcs_value": round(tcs, 3) if tcs is not None else None,
                "shade_ratio": round(shade, 3) if shade is not None else None,
                "apparent_temp": round(row["apparent_temp"], 1) if row["apparent_temp"] is not None else None,
                "surface": row["surface_type"],
                "length_m": round(length, 1),
            }
        )

    if scored_length <= 0:
        return None

    avg_tcs = weighted_tcs / scored_length
    avg_shade = weighted_shade / scored_length
    duration_min = total_distance / 75.0  # 4.5 km/h
    sun_exposure = duration_min * (1.0 - avg_shade) if daylight else 0.0

    return {
        "type": route_type,
        "distance_m": round(total_distance, 1),
        "duration_min": round(duration_min, 1),
        "sun_exposure_min": round(sun_exposure, 1),
        "avg_tcs": round(avg_tcs, 3),
        "within_heat_budget": sun_exposure <= budget_limit,
        "geometry": {"type": "LineString", "coordinates": all_coords},
        "segments": _sample_evenly(segments, _MAX_SEGMENT_DETAILS),
    }


def _empty_route(route_type: str) -> dict:
    return {
        "type": route_type,
        "distance_m": 0,
        "duration_min": 0,
        "sun_exposure_min": 0,
        "avg_tcs": 0,
        "within_heat_budget": False,
        "geometry": {"type": "LineString", "coordinates": []},
        "segments": [],
    }


def _empty_response(budget_limit: float) -> RouteResponse:
    return RouteResponse(
        routes=[_empty_route("shortest"), _empty_route("most_comfortable")],
        weather_alert=None,
        heat_budget={"budget_limit_min": budget_limit, "recommended_route": "most_comfortable"},
    )


@router.get("/segments/tcs")
async def get_tcs_segments(
    west: Optional[float] = Query(None, description="Bbox west longitude"),
    south: Optional[float] = Query(None, description="Bbox south latitude"),
    east: Optional[float] = Query(None, description="Bbox east longitude"),
    north: Optional[float] = Query(None, description="Bbox north latitude"),
    zoom: float = Query(14.5, ge=8.0, le=22.0, description="Current viewport zoom level"),
    limit: Optional[int] = Query(None, ge=100, le=3000, description="Optional cap for Eco Mode"),
):
    """Get TCS segments with O(1) serving join, zoom-aware road filtering, and geometry simplification."""
    async with get_conn() as conn:
        if all(isinstance(v, (int, float)) for v in [west, south, east, north]):
            if zoom < 13.5:
                max_rows = min(limit or 1200, 1200)
                rows = await conn.fetch(
                    """
                    SELECT
                        s.segment_id,
                        lc.tcs_value,
                        ST_AsGeoJSON(ST_SimplifyPreserveTopology(s.geom, 0.00008), 5) AS geometry
                    FROM segments s
                    JOIN segment_live_comfort lc ON lc.segment_id = s.segment_id
                    WHERE s.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                      AND s.highway_type IN ('primary', 'secondary', 'tertiary', 'pedestrian', 'footway', 'living_street')
                      AND COALESCE(s.length_m, 0) >= 25
                    LIMIT $5
                    """,
                    west,
                    south,
                    east,
                    north,
                    max_rows,
                )
            elif zoom < 15.2:
                max_rows = min(limit or 1800, 2000)
                rows = await conn.fetch(
                    """
                    SELECT
                        s.segment_id,
                        lc.tcs_value,
                        ST_AsGeoJSON(ST_SimplifyPreserveTopology(s.geom, 0.00003), 5) AS geometry
                    FROM segments s
                    JOIN segment_live_comfort lc ON lc.segment_id = s.segment_id
                    WHERE s.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                      AND COALESCE(s.length_m, 0) >= 12
                    LIMIT $5
                    """,
                    west,
                    south,
                    east,
                    north,
                    max_rows,
                )
            else:
                max_rows = min(limit or 2400, 3000)
                rows = await conn.fetch(
                    """
                    SELECT
                        s.segment_id,
                        lc.tcs_value,
                        ST_AsGeoJSON(s.geom, 5) AS geometry
                    FROM segments s
                    JOIN segment_live_comfort lc ON lc.segment_id = s.segment_id
                    WHERE s.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                    LIMIT $5
                    """,
                    west,
                    south,
                    east,
                    north,
                    max_rows,
                )
        else:
            max_rows = min(limit or 1500, 2000)
            rows = await conn.fetch(
                """
                SELECT
                    s.segment_id,
                    lc.tcs_value,
                    ST_AsGeoJSON(ST_SimplifyPreserveTopology(s.geom, 0.00005), 5) AS geometry
                FROM segments s
                JOIN segment_live_comfort lc ON lc.segment_id = s.segment_id
                WHERE COALESCE(s.length_m, 0) >= 20
                LIMIT $1
                """,
                max_rows,
            )

    return [
        {
            "segment_id": row["segment_id"],
            "tcs_value": round(row["tcs_value"], 3),
            "geometry": json.loads(row["geometry"]) if isinstance(row["geometry"], str) else row["geometry"],
        }
        for row in rows
    ]


@router.get("/segments/thermal")
async def get_thermal_segments():
    """Alias for /segments/tcs — backward compatibility."""
    return await get_tcs_segments(None, None, None, None, 14.0, 1500)


@router.post("/admin/fast-refresh", dependencies=[Depends(require_admin)])
async def trigger_fast_refresh():
    """Trigger a pure-SQL environmental and TCS refresh without needing Spark or HDFS."""
    try:
        from ingestion.fast_refresh import run_fast_refresh
    except ImportError as exc:
        raise HTTPException(
            status_code=501,
            detail="Fast refresh is unavailable in this deployment. Refresh locally and re-sync.",
        ) from exc

    summary = await asyncio.to_thread(run_fast_refresh, False)
    ttl_cache_clear()
    return summary


@router.get("/debug/topology-status", dependencies=[Depends(require_admin)])
async def topology_status():
    """Diagnostik status topologi pgRouting & tabel saji cepat."""
    async with get_conn() as conn:
        noded_exists = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='segments_noded')"
        )
        vertices_exists = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='segments_noded_vertices_pgr')"
        )
        live_comfort_count = await conn.fetchval("SELECT COUNT(*) FROM segment_live_comfort")

        if not noded_exists:
            return {"status": "error", "message": "Tabel segments_noded tidak ditemukan. Jalankan rebuild topology."}

        edge_count = await conn.fetchval("SELECT COUNT(*) FROM segments_noded")
        vertex_count = await conn.fetchval("SELECT COUNT(*) FROM segments_noded_vertices_pgr") if vertices_exists else 0
        null_source = await conn.fetchval("SELECT COUNT(*) FROM segments_noded WHERE source IS NULL OR target IS NULL")
        segments_count = await conn.fetchval("SELECT COUNT(*) FROM segments")

        sample_node = (
            await conn.fetchval(
                "SELECT id FROM segments_noded_vertices_pgr ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(112.7521, -7.2575), 4326) LIMIT 1"
            )
            if vertices_exists
            else None
        )

        return {
            "status": "ok" if (null_source == 0 and edge_count > 0) else "warning",
            "segments_total": segments_count,
            "live_comfort_rows": live_comfort_count,
            "noded_edges": edge_count,
            "noded_vertices": vertex_count,
            "edges_with_null_topology": null_source,
            "sample_center_node_id": sample_node,
            "topology_ready": null_source == 0 and edge_count > 0 and vertex_count > 0,
        }


@router.post("/admin/rebuild-topology", dependencies=[Depends(require_admin)])
async def rebuild_topology():
    """Rebuild pgRouting topology dari tabel segments."""
    async with get_conn() as conn:
        try:
            await conn.execute("SELECT build_routing_topology()")
            edge_count = await conn.fetchval("SELECT COUNT(*) FROM segments_noded")
            vertex_count = await conn.fetchval("SELECT COUNT(*) FROM segments_noded_vertices_pgr")
            null_count = await conn.fetchval(
                "SELECT COUNT(*) FROM segments_noded WHERE source IS NULL OR target IS NULL"
            )
            return {
                "status": "success",
                "message": "Topology rebuilt successfully",
                "noded_edges": edge_count,
                "noded_vertices": vertex_count,
                "null_topology_edges": null_count,
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Topology rebuild failed: {str(e)}")
