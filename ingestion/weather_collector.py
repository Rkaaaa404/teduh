"""Weather Collector - Fetch weather data from Open-Meteo for Surabaya.

Collects: temperature_2m, relative_humidity_2m, wind_speed_10m,
direct_radiation, apparent_temperature.

No API key needed for Open-Meteo (free, open-source).
"""
from __future__ import annotations

import json
import os
from datetime import datetime

import requests

from ingestion.config import (
    OPEN_METEO_BASE_URL,
    SURABAYA_LAT,
    SURABAYA_LNG,
    WEATHER_DIR,
)


def fetch_current_weather() -> dict:
    """Fetch current weather conditions for Surabaya from Open-Meteo."""
    print("[Weather] Fetching current weather from Open-Meteo...")

    params = {
        "latitude": SURABAYA_LAT,
        "longitude": SURABAYA_LNG,
        "current": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "wind_speed_10m",
            "wind_direction_10m",
            "direct_radiation",
            "diffuse_radiation",
            "cloud_cover",
        ]),
        "hourly": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "wind_speed_10m",
            "direct_radiation",
            "cloud_cover",
        ]),
        "timezone": "Asia/Jakarta",
        "forecast_days": 1,
    }

    response = requests.get(OPEN_METEO_BASE_URL, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    print(f"  Temperature: {data['current']['temperature_2m']}C")
    print(f"  Apparent: {data['current']['apparent_temperature']}C")
    print(f"  Humidity: {data['current']['relative_humidity_2m']}%")
    print(f"  Radiation: {data['current']['direct_radiation']} W/m2")

    # Save to raw storage
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"weather_{timestamp}.json"
    
    # Try writing directly to HDFS (Bronze Layer)
    from ingestion.hdfs_client import write_to_hdfs
    data_str = json.dumps(data, indent=2)
    hdfs_path = f"/lakehouse/bronze/weather/{filename}"
    hdfs_success = write_to_hdfs(hdfs_path, data_str)
    
    # Save locally as cache/fallback
    os.makedirs(WEATHER_DIR, exist_ok=True)
    output_path = os.path.join(WEATHER_DIR, filename)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(data_str)
    
    if hdfs_success:
        print(f"  Ingested directly to HDFS at: {hdfs_path}")
    else:
        print(f"  [HDFS Fallback] Saved locally to: {output_path}")
        
    return data


def get_latest_weather() -> dict | None:
    """Read the most recent weather file from raw storage."""
    if not os.path.exists(WEATHER_DIR):
        return None

    files = sorted(
        [f for f in os.listdir(WEATHER_DIR) if f.startswith("weather_")],
        reverse=True,
    )
    if not files:
        return None

    with open(os.path.join(WEATHER_DIR, files[0]), "r", encoding="utf-8") as f:
        return json.load(f)


def parse_hourly_forecast(weather_doc: dict | None) -> list[tuple]:
    """Turn Open-Meteo's `hourly` block into `weather_hourly_forecast` rows.

    Returns (forecast_date, hour_of_day, temperature_2m, apparent_temp,
    direct_radiation, cloud_cover). Hours without an apparent temperature are
    dropped rather than filled in.
    """
    hourly = (weather_doc or {}).get("hourly") or {}
    times = hourly.get("time") or []

    def column(name: str) -> list:
        return hourly.get(name) or [None] * len(times)

    rows = []
    for stamp, temp, apparent, radiation, cloud in zip(
        times,
        column("temperature_2m"),
        column("apparent_temperature"),
        column("direct_radiation"),
        column("cloud_cover"),
    ):
        if apparent is None:
            continue
        moment = datetime.fromisoformat(stamp)
        rows.append((moment.date(), moment.hour, temp, apparent, radiation, cloud))
    return rows


def store_hourly_forecast(cur, weather_doc: dict | None) -> int:
    """Upsert the forecast using an open cursor and keep three days of history."""
    rows = parse_hourly_forecast(weather_doc)
    if not rows:
        return 0

    cur.executemany(
        """
        INSERT INTO weather_hourly_forecast (
            forecast_date, hour_of_day, temperature_2m, apparent_temp,
            direct_radiation, cloud_cover, fetched_at
        ) VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (forecast_date, hour_of_day) DO UPDATE SET
            temperature_2m   = EXCLUDED.temperature_2m,
            apparent_temp    = EXCLUDED.apparent_temp,
            direct_radiation = EXCLUDED.direct_radiation,
            cloud_cover      = EXCLUDED.cloud_cover,
            fetched_at       = NOW();
        """,
        rows,
    )
    newest = max(row[0] for row in rows)
    cur.execute(
        "DELETE FROM weather_hourly_forecast WHERE forecast_date < %s::date - 3;",
        (newest,),
    )
    return len(rows)


if __name__ == "__main__":
    fetch_current_weather()
