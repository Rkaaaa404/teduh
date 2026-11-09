"""CCTV Registry - Fetch and store CCTV camera data from Dishub Surabaya.

Source: http://36.66.208.101:5000/cctvs (public JSON API)
HLS Stream pattern: http://36.66.208.101:5000/hls/{cctv_id}/stream311.ts

Stores CCTV locations in PostGIS for spatial queries (find nearest CCTV to route).
"""
from __future__ import annotations

import json
import os
from datetime import datetime

import requests
import psycopg2

from ingestion.config import DATABASE_URL


DISHUB_CCTV_API = "http://36.66.208.101:5000/cctvs"
DISHUB_HLS_BASE = "http://36.66.208.101:5000/hls"


def fetch_cctv_list() -> list[dict]:
    """Fetch full CCTV list from Dishub Surabaya API."""
    print("[CCTV] Fetching CCTV list from Dishub Surabaya...")

    try:
        response = requests.get(DISHUB_CCTV_API, timeout=30)
        response.raise_for_status()
        data = response.json()
        print(f"  Found {len(data)} CCTV cameras")
        return data
    except requests.RequestException as e:
        print(f"  Error fetching CCTV data: {e}")
        return []


def build_stream_url(cctv_id: str) -> str:
    """Build HLS stream URL for a given CCTV ID."""
    return f"{DISHUB_HLS_BASE}/{cctv_id}/stream311.ts"


def load_to_postgis(cameras: list[dict]) -> int:
    """Insert CCTV cameras into PostGIS database."""
    if not cameras:
        return 0

    print(f"[CCTV] Loading {len(cameras)} cameras to PostGIS...")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    inserted = 0
    for cam in cameras:
        cctv_id = cam.get("id", "")
        name = cam.get("name", "Unknown").strip()
        lat = cam.get("lat")
        lng = cam.get("lng")
        area = cam.get("area", "")

        if not lat or not lng or not cctv_id:
            continue

        stream_url = build_stream_url(cctv_id)
        wkt = f"SRID=4326;POINT({lng} {lat})"

        # The pipeline runs this repeatedly and the table has no unique key on dishub_id.
        cur.execute("""
            INSERT INTO cctv_cameras (dishub_id, name, geom, stream_url, is_active)
            SELECT %s, %s, ST_GeomFromEWKT(%s), %s, TRUE
            WHERE NOT EXISTS (SELECT 1 FROM cctv_cameras WHERE dishub_id = %s)
        """, (cctv_id, name, wkt, stream_url, cctv_id))
        inserted += cur.rowcount

    conn.commit()

    # Update nearest_segment for each CCTV (find closest pedestrian segment)
    print("  Linking CCTVs to nearest street segments...")
    cur.execute("""
        UPDATE cctv_cameras c
        SET nearest_segment = (
            SELECT s.segment_id
            FROM segments s
            ORDER BY c.geom <-> s.geom
            LIMIT 1
        )
        WHERE c.nearest_segment IS NULL
    """)
    conn.commit()

    cur.close()
    conn.close()
    print(f"  Inserted {inserted} CCTV cameras")
    return inserted


def get_nearby_cctvs(lat: float, lng: float, radius_m: float = 500, limit: int = 5) -> list[dict]:
    """Find CCTV cameras near a given coordinate.

    Args:
        lat, lng: Query point coordinates.
        radius_m: Search radius in meters.
        limit: Maximum number of results.

    Returns:
        List of CCTV dicts with id, name, stream_url, distance_m.
    """
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Convert radius to approximate degrees (at Surabaya latitude)
    radius_deg = radius_m / 111320.0

    cur.execute("""
        SELECT
            dishub_id,
            name,
            stream_url,
            ST_X(geom) as lng,
            ST_Y(geom) as lat,
            ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography) as distance_m
        FROM cctv_cameras
        WHERE is_active = TRUE
          AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)
        LIMIT %s
    """, (lng, lat, lng, lat, radius_deg, lng, lat, limit))

    results = []
    for row in cur.fetchall():
        results.append({
            "cctv_id": row[0],
            "name": row[1],
            "stream_url": row[2],
            "lng": row[3],
            "lat": row[4],
            "distance_m": round(row[5], 1),
        })

    cur.close()
    conn.close()
    return results


def run():
    """Main entry point: fetch and load all CCTVs."""
    print("=== CCTV Registry Update ===")
    cameras = fetch_cctv_list()
    count = load_to_postgis(cameras)
    print(f"=== Done ({count} cameras loaded) ===")


if __name__ == "__main__":
    run()
