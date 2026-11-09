"""BMKG RSS Monitor - Parse weather alert feed from BMKG.

Monitors: https://www.bmkg.go.id/alerts/nowcast/id
Detects extreme weather warnings for Surabaya region.
No API key needed (public RSS feed).
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime

import feedparser
import requests

from ingestion.config import BMKG_RSS_URL, ALERTS_DIR, SURABAYA_BBOX

SURABAYA_AREA_CITIES = ("surabaya", "gresik", "sidoarjo")

# Genteng, Sawahan and Tegalsari are left out: other East Java regencies have
# kecamatan with the same names, and a Surabaya storm lists several districts.
SURABAYA_DISTRICTS = re.compile(
    r"\b(asemrowo|benowo|bubutan|bulak|dukuh pakis|gayungan|gubeng|gunung anyar"
    r"|jambangan|karang pilang|kenjeran|krembangan|lakarsantri|mulyorejo"
    r"|pabean cantian|pakal|rungkut|sambikerep|semampir|simokerto|sukolilo"
    r"|sukomanunggal|tambaksari|tandes|tenggilis mejoyo|wiyung|wonocolo|wonokromo)\b"
)


def fetch_bmkg_alerts() -> list[dict]:
    """Fetch and parse BMKG weather alerts RSS feed."""
    print("[BMKG] Fetching weather alerts...")

    # BMKG nowcast page - try to get RSS/XML content
    # The nowcast endpoint returns weather warnings
    try:
        response = requests.get(BMKG_RSS_URL, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"  Error fetching BMKG RSS: {e}")
        return []

    # Parse as RSS feed
    feed = feedparser.parse(response.content)

    alerts = []
    for entry in feed.entries:
        alert = {
            "title": entry.get("title", ""),
            "description": entry.get("summary", entry.get("description", "")),
            "link": entry.get("link", ""),
            "published": entry.get("published", ""),
            "severity": _classify_severity(entry.get("title", "")),
            "timestamp": datetime.now().isoformat(),
        }

        # Check if alert is relevant to Surabaya area
        if _is_surabaya_relevant(alert):
            alert["relevant_to_surabaya"] = True
            alerts.append(alert)

    print(f"  Found {len(alerts)} Surabaya-relevant alerts")

    # Save to raw storage
    os.makedirs(ALERTS_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    output_path = os.path.join(ALERTS_DIR, f"alerts_{timestamp}.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(alerts, f, indent=2, ensure_ascii=False)

    return alerts


def _classify_severity(title: str) -> str:
    """Classify alert severity from title keywords."""
    title_lower = title.lower()
    if any(w in title_lower for w in ["extreme", "ekstrem", "bahaya"]):
        return "extreme"
    elif any(w in title_lower for w in ["severe", "parah", "berat"]):
        return "severe"
    elif any(w in title_lower for w in ["moderate", "sedang", "waspada"]):
        return "moderate"
    return "minor"


def _is_surabaya_relevant(alert: dict) -> bool:
    """True if the alert names Surabaya, a neighbouring city, or a Surabaya district.

    A province-wide match is not enough: BMKG titles say "Jawa Timur" for storms
    anywhere in the province, and the body lists kecamatan rather than cities.
    """
    text = f"{alert.get('title', '')} {alert.get('description', '')}".lower()
    if any(city in text for city in SURABAYA_AREA_CITIES):
        return True
    return "jawa timur" in text and SURABAYA_DISTRICTS.search(text) is not None


def get_active_alerts() -> list[dict]:
    """Read the most recent alerts file."""
    if not os.path.exists(ALERTS_DIR):
        return []

    files = sorted(
        [f for f in os.listdir(ALERTS_DIR) if f.startswith("alerts_")],
        reverse=True,
    )
    if not files:
        return []

    with open(os.path.join(ALERTS_DIR, files[0]), "r", encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    alerts = fetch_bmkg_alerts()
    for a in alerts:
        print(f"  [{a['severity'].upper()}] {a['title']}")
