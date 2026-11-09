"""Traffic Collector - Fetch traffic flow data from TomTom API.

Requires: TOMTOM_API_KEY (free tier: https://developer.tomtom.com/)
Free tier provides 2,500 requests/day.
"""
from __future__ import annotations

import json
import os
from datetime import datetime

import requests

from ingestion.config import TOMTOM_API_KEY, TOMTOM_BASE_URL, TRAFFIC_DIR, SURABAYA_BBOX


# Sample points along major pedestrian-adjacent roads in Surabaya
SAMPLE_POINTS = [
    {"name": "Jl. Basuki Rahmat", "lat": -7.2679, "lng": 112.7407},
    {"name": "Jl. Tunjungan", "lat": -7.2611, "lng": 112.7381},
    {"name": "Jl. Darmo", "lat": -7.2878, "lng": 112.7310},
    {"name": "Jl. Ahmad Yani", "lat": -7.3215, "lng": 112.7378},
    {"name": "Jl. Pemuda", "lat": -7.2640, "lng": 112.7500},
    {"name": "Jl. Urip Sumoharjo", "lat": -7.2757, "lng": 112.7381},
    {"name": "Jl. Raya Darmo Permai", "lat": -7.2920, "lng": 112.7180},
    {"name": "Jl. Kertajaya", "lat": -7.2805, "lng": 112.7630},
]


def fetch_traffic_flow(lat: float, lng: float) -> dict | None:
    """Fetch traffic flow for a single point from TomTom."""
    if not TOMTOM_API_KEY:
        print("[Traffic] WARNING: TOMTOM_API_KEY not set. Skipping.")
        print("  Register at: https://developer.tomtom.com/")
        return None

    params = {
        "key": TOMTOM_API_KEY,
        "point": f"{lat},{lng}",
        "unit": "KMPH",
    }

    response = requests.get(TOMTOM_BASE_URL, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    flow = data.get("flowSegmentData", {})
    return {
        "current_speed": flow.get("currentSpeed"),
        "free_flow_speed": flow.get("freeFlowSpeed"),
        "current_travel_time": flow.get("currentTravelTime"),
        "free_flow_travel_time": flow.get("freeFlowTravelTime"),
        "confidence": flow.get("confidence"),
        "congestion_ratio": (
            1.0 - (flow.get("currentSpeed", 1) / max(flow.get("freeFlowSpeed", 1), 1))
            if flow.get("freeFlowSpeed")
            else None
        ),
    }


def fetch_all_traffic() -> list[dict]:
    """Fetch traffic data for all sample points."""
    if not TOMTOM_API_KEY:
        print("[Traffic] WARNING: TOMTOM_API_KEY not set.")
        print("  Register at: https://developer.tomtom.com/")
        return []

    print("[Traffic] Fetching traffic flow data...")
    results = []

    for point in SAMPLE_POINTS:
        try:
            flow = fetch_traffic_flow(point["lat"], point["lng"])
            if flow:
                flow["name"] = point["name"]
                flow["lat"] = point["lat"]
                flow["lng"] = point["lng"]
                flow["timestamp"] = datetime.now().isoformat()
                results.append(flow)
                print(f"  {point['name']}: congestion={flow.get('congestion_ratio', 'N/A'):.2f}")
        except Exception as e:
            print(f"  Error for {point['name']}: {e}")

    # Save to raw storage
    if results:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        filename = f"traffic_{timestamp}.json"
        
        # Try writing directly to HDFS (Bronze Layer)
        from ingestion.hdfs_client import write_to_hdfs
        data_str = json.dumps(results, indent=2)
        hdfs_path = f"/lakehouse/bronze/traffic/{filename}"
        hdfs_success = write_to_hdfs(hdfs_path, data_str)
        
        # Save locally as cache/fallback
        os.makedirs(TRAFFIC_DIR, exist_ok=True)
        output_path = os.path.join(TRAFFIC_DIR, filename)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(data_str)
            
        if hdfs_success:
            print(f"  Ingested directly to HDFS at: {hdfs_path}")
        else:
            print(f"  [HDFS Fallback] Saved locally to: {output_path}")
            
    return results


def get_latest_traffic() -> list[dict] | None:
    """Read the most recent traffic file from raw storage."""
    if not os.path.exists(TRAFFIC_DIR):
        return None

    files = sorted(
        [f for f in os.listdir(TRAFFIC_DIR) if f.startswith("traffic_")],
        reverse=True,
    )
    if not files:
        return None

    with open(os.path.join(TRAFFIC_DIR, files[0]), "r", encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    fetch_all_traffic()
