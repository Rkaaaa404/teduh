"""AQI Collector - Fetch air quality data from WAQI API for Surabaya.

Requires: WAQI_API_TOKEN (free registration at https://aqicn.org/data-platform/token/)
"""
from __future__ import annotations

import json
import os
from datetime import datetime

import requests

from ingestion.config import WAQI_API_TOKEN, WAQI_BASE_URL, AQI_DIR, SURABAYA_LAT, SURABAYA_LNG


# Known WAQI station IDs/names near Surabaya
SURABAYA_STATIONS = [
    "surabaya",
    "@8691",  # US Consulate Surabaya
]


def fetch_aqi(station: str = "surabaya") -> dict | None:
    """Fetch AQI data for a specific station."""
    if not WAQI_API_TOKEN:
        print("[AQI] WARNING: WAQI_API_TOKEN not set. Skipping AQI fetch.")
        print("  Register at: https://aqicn.org/data-platform/token/")
        return None

    print(f"[AQI] Fetching AQI for station: {station}...")

    url = f"{WAQI_BASE_URL}/{station}/"
    params = {"token": WAQI_API_TOKEN}

    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    if data.get("status") != "ok":
        print(f"  Station '{station}' unavailable ({data.get('data')}), falling back to Surabaya geo-feed...")
        geo_data = fetch_aqi_by_coordinates()
        if not geo_data:
            return None
        aqi_data = geo_data
    else:
        aqi_data = data["data"]
    print(f"  AQI: {aqi_data.get('aqi', 'N/A')}")
    print(f"  Dominant pollutant: {aqi_data.get('dominentpol', 'N/A')}")

    # Save to raw storage
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"aqi_{station}_{timestamp}.json"
    
    # Try writing directly to HDFS (Bronze Layer)
    from ingestion.hdfs_client import write_to_hdfs
    data_str = json.dumps(aqi_data, indent=2)
    hdfs_path = f"/lakehouse/bronze/aqi/{filename}"
    hdfs_success = write_to_hdfs(hdfs_path, data_str)
    
    # Save locally as cache/fallback
    os.makedirs(AQI_DIR, exist_ok=True)
    output_path = os.path.join(AQI_DIR, filename)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(data_str)
        
    if hdfs_success:
        print(f"  Ingested directly to HDFS at: {hdfs_path}")
    else:
        print(f"  [HDFS Fallback] Saved locally to: {output_path}")
        
    return aqi_data


def fetch_aqi_by_coordinates() -> dict | None:
    """Fetch AQI using geo coordinates (alternative to station name)."""
    if not WAQI_API_TOKEN:
        print("[AQI] WARNING: WAQI_API_TOKEN not set.")
        return None

    url = f"https://api.waqi.info/feed/geo:{SURABAYA_LAT};{SURABAYA_LNG}/"
    params = {"token": WAQI_API_TOKEN}

    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    if data.get("status") != "ok":
        return None

    return data["data"]


def get_latest_aqi() -> dict | None:
    """Read the most recent AQI file from raw storage."""
    if not os.path.exists(AQI_DIR):
        return None

    files = sorted(
        [f for f in os.listdir(AQI_DIR) if f.startswith("aqi_")],
        reverse=True,
    )
    if not files:
        return None

    with open(os.path.join(AQI_DIR, files[0]), "r", encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    fetch_aqi()
