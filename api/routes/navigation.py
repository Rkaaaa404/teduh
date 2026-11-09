"""Navigation API routes - Corridor-pruned pgRouting with O(1) TCS Serving Layer."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from typing import Optional

from api.models.schemas import RouteRequest, RouteResponse
from api.db import get_conn, ttl_cache_clear

router = APIRouter()

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")


def require_admin(x_admin_token: Optional[str] = Header(default=None)) -> None:
    """Guard for debug/admin endpoints.

    When ADMIN_TOKEN is set, endpoints require a matching ``X-Admin-Token`` header.
    """
    if ADMIN_TOKEN:
        if not x_admin_token or not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
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

        alert_row = await conn.fetchrow(
            """
            SELECT title, severity, description
            FROM weather_alerts
            WHERE is_active = TRUE
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY severity DESC, issued_at DESC
            LIMIT 1
            """
        )
        weather_alert_str = None
        has_severe_alert = False
        if alert_row:
            sev = (alert_row["severity"] or "").lower()
            has_severe_alert = sev in ("severe", "extreme")
            weather_alert_str = f"[{sev.upper()}] {alert_row['title']}: {alert_row['description']}"

        shortest = await _run_pgr_route(
            conn,
            source_node,
            target_node,
            "shortest",
            budget_limit,
            heat_tolerance,
            bbox=bbox,
            has_severe_alert=has_severe_alert,
        )
        comfortable = await _run_pgr_route(
            conn,
            source_node,
            target_node,
            "most_comfortable",
            budget_limit,
            heat_tolerance,
            bbox=bbox,
            has_severe_alert=has_severe_alert,
        )

    return RouteResponse(
        routes=[shortest, comfortable],
        weather_alert=weather_alert_str,
        heat_budget={"budget_limit_min": budget_limit, "recommended_route": "most_comfortable"},
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


async def _execute_dijkstra_sql(
    conn,
    source: int,
    target: int,
    cost_sql: str,
    joins_sql: str,
    alert_penalty_sql: str,
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
        f"({cost_sql}) * {alert_penalty_sql} AS cost, "
        f"({cost_sql}) * {alert_penalty_sql} AS reverse_cost "
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
            COALESCE(lc.tcs_value, 0.5) AS tcs_value,
            COALESCE(lc.shade_ratio, 0.2) AS shade_ratio,
            COALESCE(lc.apparent_temp, 34.0) AS apparent_temp,
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
    heat_tolerance: str = "medium",
    bbox: tuple[float, float, float, float] | None = None,
    has_severe_alert: bool = False,
) -> dict:
    """Run corridor-pruned pgr_dijkstra with automatic full-graph fallback."""
    penalty_mult = _PENALTY_MULT.get(heat_tolerance, 3.0)

    if route_type == "shortest":
        cost_sql = "COALESCE(sn.length_m, 50) / 1.33"
        joins_sql = ""
    else:
        cost_sql = (
            f"(COALESCE(sn.length_m, 50) / 1.33) * "
            f"(1.0 + {penalty_mult} * POWER(1.0 - COALESCE(lc.tcs_value, 0.5), 2) * 5.0)"
        )
        joins_sql = "LEFT JOIN segment_live_comfort lc ON lc.segment_id = sn.old_id"

    if has_severe_alert:
        alert_penalty_sql = (
            "(CASE WHEN EXISTS ("
            "SELECT 1 FROM weather_alerts wa "
            "WHERE wa.is_active = TRUE "
            "AND (wa.expires_at IS NULL OR wa.expires_at > NOW()) "
            "AND wa.severity IN (''severe'', ''extreme'') "
            "AND ST_Intersects(sn.geom, wa.affected_area)"
            ") THEN 100.0 ELSE 1.0 END)"
        )
    else:
        alert_penalty_sql = "1.0"

    rows = []
    try:
        # 1st attempt: fast corridor-pruned subgraph (~2k-5k edges instead of 58k)
        rows = await _execute_dijkstra_sql(
            conn, source, target, cost_sql, joins_sql, alert_penalty_sql, bbox
        )
        # Fallback to full-city graph if corridor was disconnected
        if not rows and bbox is not None:
            rows = await _execute_dijkstra_sql(
                conn, source, target, cost_sql, joins_sql, alert_penalty_sql, None
            )
    except Exception as e:
        print(f"[Route] pgr_dijkstra failed: {e}")
        return _empty_route(route_type)

    if not rows:
        return _empty_route(route_type)

    all_coords = []
    total_distance = 0.0
    total_tcs = 0.0
    total_shade = 0.0
    segments = []

    for row in rows:
        geom = json.loads(row["geom_json"]) if isinstance(row["geom_json"], str) else row["geom_json"]
        length = row["length_m"] or 0.0
        total_distance += length
        total_tcs += row["tcs_value"]
        total_shade += row["shade_ratio"]

        if geom and "coordinates" in geom:
            coords = geom["coordinates"]
            if all_coords:
                last = all_coords[-1]
                d_fwd = (last[0] - coords[0][0]) ** 2 + (last[1] - coords[0][1]) ** 2
                d_rev = (last[0] - coords[-1][0]) ** 2 + (last[1] - coords[-1][1]) ** 2
                if d_rev < d_fwd:
                    coords = list(reversed(coords))
                if coords and ((last[0] - coords[0][0]) ** 2 + (last[1] - coords[0][1]) ** 2) < 1e-10:
                    coords = coords[1:]
            all_coords.extend(coords)

        segments.append(
            {
                "segment_id": row["segment_id"],
                "tcs_value": round(row["tcs_value"], 3),
                "shade_ratio": round(row["shade_ratio"], 3),
                "apparent_temp": round(row["apparent_temp"], 1),
                "surface": row["surface_type"],
                "length_m": round(length, 1),
            }
        )

    n = len(rows)
    avg_tcs = total_tcs / n if n > 0 else 0.5
    avg_shade = total_shade / n if n > 0 else 0.2
    duration_min = total_distance / 75.0  # 4.5 km/h
    sun_exposure = duration_min * (1.0 - avg_shade)

    return {
        "type": route_type,
        "distance_m": round(total_distance, 1),
        "duration_min": round(duration_min, 1),
        "sun_exposure_min": round(sun_exposure, 1),
        "avg_tcs": round(avg_tcs, 3),
        "within_heat_budget": sun_exposure <= budget_limit,
        "geometry": {"type": "LineString", "coordinates": all_coords},
        "segments": segments[:15],
    }


def _empty_route(route_type: str) -> dict:
    return {
        "type": route_type,
        "distance_m": 0,
        "duration_min": 0,
        "sun_exposure_min": 0,
        "avg_tcs": 0,
        "within_heat_budget": True,
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
    """Trigger sub-2s pure-SQL environmental & TCS refresh without needing Spark/HDFS."""
    from ingestion.fast_refresh import run_fast_refresh

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
