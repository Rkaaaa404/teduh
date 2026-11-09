"""Configuration for Teduh ingestion layer."""

import os
from dotenv import load_dotenv

load_dotenv()

# --- Surabaya Bounding Box (EPSG:4326) ---
SURABAYA_BBOX = {
    "south": -7.35,
    "west": 112.60,
    "north": -7.20,
    "east": 112.85,
}

# --- Data Lake Paths ---
RAW_DATA_DIR = os.getenv("RAW_DATA_DIR", "./data/raw")
RASTER_DIR = f"{RAW_DATA_DIR}/raster"
OSM_DIR = f"{RAW_DATA_DIR}/osm"
WEATHER_DIR = f"{RAW_DATA_DIR}/weather"
TRAFFIC_DIR = f"{RAW_DATA_DIR}/traffic"
AQI_DIR = f"{RAW_DATA_DIR}/aqi"
ALERTS_DIR = f"{RAW_DATA_DIR}/alerts"
TRANSIT_DIR = f"{RAW_DATA_DIR}/transit"

# --- API Keys & Endpoints ---
OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast"
BMKG_RSS_URL = "https://www.bmkg.go.id/alerts/nowcast/id"
WAQI_API_TOKEN = os.getenv("WAQI_API_TOKEN", "")
WAQI_BASE_URL = "https://api.waqi.info/feed"
TOMTOM_API_KEY = os.getenv("TOMTOM_API_KEY", "")
TOMTOM_BASE_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"

# --- Overpass API ---
# Public Overpass mirrors are often overloaded (504/429), so several are tried in
# order. Override with a comma-separated OVERPASS_API_URLS env var.
OVERPASS_API_URLS = [
    u.strip()
    for u in os.getenv(
        "OVERPASS_API_URLS",
        "https://z.overpass-api.de/api/interpreter,"
        "https://lz4.overpass-api.de/api/interpreter,"
        "https://overpass-api.de/api/interpreter,"
        "https://overpass.kumi.systems/api/interpreter,"
        "https://overpass.private.coffee/api/interpreter,"
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ).split(",")
    if u.strip()
]

class LiveDataUnavailable(RuntimeError):
    """No real reading exists for a required input.

    Raised instead of substituting a constant: a refresh that cannot get real
    data must leave the previously served values alone.
    """


# --- Database ---
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://cc_user:cc_dev_pass@localhost:5432/commute_cool"
)

# --- Surabaya Center Coordinates (for weather queries) ---
SURABAYA_LAT = -7.2575
SURABAYA_LNG = 112.7521
