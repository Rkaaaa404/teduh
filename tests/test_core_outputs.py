"""The outputs users act on, checked against the running stack and its real data.

Each test guards one number or decision a user sees. Needs the API and database:
`docker compose up -d postgres api`, after the pipeline has run.
"""
import os
from datetime import datetime, timedelta, timezone

import httpx
import psycopg2
import pytest

from spark_jobs.utils.normalization import (
    compute_tcs,
    normalize_aqi,
    normalize_shade,
    normalize_surface,
    normalize_temperature,
    normalize_traffic,
)

API_BASE = os.getenv("API_BASE", "http://localhost:8000")
DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql://cc_user:cc_dev_pass@localhost:5432/commute_cool"
)
WIB = timezone(timedelta(hours=7))

# Trips of a few hundred metres to about 2 km through central Surabaya.
TRIPS = [
    ((-7.2756, 112.7426), (-7.2650, 112.7508)),
    ((-7.2587, 112.7377), (-7.2679, 112.7407)),
    ((-7.2878, 112.7310), (-7.2756, 112.7426)),
]


@pytest.fixture(scope="module")
def db():
    try:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
    except psycopg2.OperationalError:
        pytest.skip("database is not running")
    conn.autocommit = True
    yield conn.cursor()
    conn.close()


@pytest.fixture(scope="module")
def api():
    try:
        with httpx.Client(base_url=API_BASE, timeout=60.0) as client:
            client.get("/health").raise_for_status()
            yield client
    except httpx.TransportError:
        pytest.skip("API is not running")


def route(api, trip, hour):
    (origin_lat, origin_lng), (dest_lat, dest_lng) = trip
    departure = datetime.now(WIB).replace(hour=hour, minute=0, second=0, microsecond=0)
    response = api.post(
        "/api/route",
        json={
            "origin": {"lat": origin_lat, "lng": origin_lng},
            "destination": {"lat": dest_lat, "lng": dest_lng},
            "user_profile": {"heat_tolerance": "medium", "prefer_shade": True},
            "departure_time": departure.isoformat(),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def scalar(db, sql):
    db.execute(sql)
    return db.fetchone()[0]


def test_inputs_are_measured_not_constant(db):
    # A city-wide traffic value of exactly 0 is real at night, when every station is at free flow.
    db.execute(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE aqi_value = 50 AND traffic_level = 0.3),"
        " COUNT(*) FILTER (WHERE apparent_temp = 31.5) FROM segment_live_comfort"
    )
    total, old_defaults, old_weather_default = db.fetchone()
    assert total > 50000
    assert old_defaults == 0 and old_weather_default == 0, "rows carry the old fabricated defaults"


def test_served_score_is_the_published_formula(db):
    db.execute(
        """
        SELECT lc.tcs_value, lc.shade_ratio, lc.avg_ndvi, lc.apparent_temp, lc.avg_lst,
               lc.aqi_value, lc.traffic_level, s.surface_type, s.smoothness
        FROM segment_live_comfort lc JOIN segments s USING (segment_id)
        ORDER BY lc.segment_id LIMIT 500
        """
    )
    for served, shade, ndvi, apparent, lst, aqi, traffic, surface, smoothness in db.fetchall():
        expected = compute_tcs(
            normalize_shade(shade, ndvi),
            normalize_temperature(apparent, lst),
            normalize_aqi(aqi),
            normalize_traffic(traffic),
            normalize_surface(surface, smoothness),
        )
        assert served == pytest.approx(expected, abs=0.002)


def test_shade_follows_the_sun_and_is_not_saturated(db):
    morning = scalar(db, "SELECT AVG(shade_by_hour[2]) FROM segment_live_comfort")
    noon = scalar(db, "SELECT AVG(shade_by_hour[7]) FROM segment_live_comfort")
    afternoon = scalar(db, "SELECT AVG(shade_by_hour[11]) FROM segment_live_comfort")
    full_at_one = scalar(
        db,
        "SELECT 100.0 * COUNT(*) FILTER (WHERE shade_by_hour[8] >= 0.99) / COUNT(*) FROM segment_live_comfort",
    )
    assert noon < morning and noon < afternoon, "shade must be lowest around noon"
    assert noon < 0.35
    assert full_at_one < 20, f"{full_at_one:.0f}% of segments in full shade at 13:00"


def test_comfortable_route_is_cooler_at_the_hottest_hour(api):
    for trip in TRIPS:
        shortest, comfortable = route(api, trip, 13)["routes"]
        assert shortest["distance_m"] > 0
        assert comfortable["distance_m"] >= shortest["distance_m"] - 1.0
        assert comfortable["avg_tcs"] >= shortest["avg_tcs"] - 0.005
        assert comfortable["sun_exposure_min"] > 0
        assert shortest["sun_exposure_min"] >= shortest["duration_min"] * 0.4, (
            "at midday most of an unshaded trip should be in the sun"
        )


def test_departure_hour_changes_the_answer(api):
    midday = route(api, TRIPS[0], 13)
    night = route(api, TRIPS[0], 21)
    assert (midday["conditions_hour"], night["conditions_hour"]) == (13, 21)
    assert midday["time_basis"] == night["time_basis"] == "forecast"
    assert midday["routes"][0]["sun_exposure_min"] > 0
    assert night["routes"][0]["sun_exposure_min"] == 0
    assert night["routes"][0]["avg_tcs"] > midday["routes"][0]["avg_tcs"]


def test_route_detours_around_a_reported_closure(api, db):
    before = route(api, TRIPS[0], 13)["routes"][0]
    closed = max(before["segments"][1:-1], key=lambda segment: segment["length_m"])
    db.execute(
        """
        INSERT INTO map_alerts (lat, lon, geom, category, icon_type, description)
        SELECT ST_Y(p), ST_X(p), p, 'road_closed', 'road_closed', 'test_core_outputs'
        FROM (SELECT ST_LineInterpolatePoint(ST_LineMerge(geom), 0.5) AS p
              FROM segments WHERE segment_id = %s) mid
        RETURNING id
        """,
        (closed["segment_id"],),
    )
    alert_id = db.fetchone()[0]
    try:
        after = route(api, TRIPS[0], 13)["routes"][0]
    finally:
        db.execute("DELETE FROM map_alerts WHERE id = %s", (alert_id,))

    assert closed["segment_id"] not in {s["segment_id"] for s in after["segments"]}
    assert after["distance_m"] > before["distance_m"], "a closure should force a longer way round"


def test_city_scenarios_never_report_a_worsening(db):
    db.execute(
        "SELECT MIN(tcs_improvement_green), MIN(tcs_improvement_cool), AVG(tcs_improvement_green),"
        " AVG(tcs_improvement_cool), MAX(predicted_tcs_green), MIN(source) FROM tcs_simulations"
    )
    min_green, min_cool, avg_green, avg_cool, max_predicted, source = db.fetchone()
    assert min_green >= 0 and min_cool >= 0
    assert max_predicted <= 1.0
    # The TCS formula gives about +0.10 for greening and +0.025 for 3.5 C cooler pavement.
    assert 0.05 < avg_green < 0.15, f"greening gain {avg_green:.3f}"
    assert 0.012 < avg_cool < 0.04, f"cool pavement gain {avg_cool:.3f}"
    assert source in ("mllib", "formula")


def test_planning_lists_do_not_depend_on_refresh_hour(api, db):
    db.execute(
        """
        SELECT hour_of_day FROM weather_hourly_forecast
        WHERE hour_of_day BETWEEN 6 AND 17
          AND forecast_date = (SELECT MAX(forecast_date) FROM weather_hourly_forecast)
        ORDER BY apparent_temp DESC, hour_of_day LIMIT 1
        """
    )
    peak_hour = db.fetchone()[0]
    uhi = api.get("/api/dashboard/uhi").json()
    corridors = api.get("/api/dashboard/priority-corridors").json()["corridors"]
    assert uhi["summary"]["conditions_hour"] == peak_hour
    assert uhi["hotspots"], "no heat hotspots at the hottest hour"
    assert corridors, "no priority corridors at the hottest hour"
    scores = [spot["avg_tcs"] for spot in uhi["hotspots"]]
    assert scores == sorted(scores), "worst hotspot must come first"
    assert api.get("/api/dashboard/walkability").json()["conditions_hour"] == peak_hour


def test_heat_prediction_matches_the_stored_forecast(api, db):
    body = api.get("/api/dashboard/heat-prediction").json()
    db.execute(
        """
        SELECT hour_of_day, apparent_temp FROM weather_hourly_forecast
        WHERE forecast_date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
        """
    )
    forecast = dict(db.fetchall())
    assert forecast, "no forecast stored for today"
    assert body["summary"]["peak_heat_hour"] == max(forecast, key=lambda h: (forecast[h], -h))
    for point in body["hourly_trend"]:
        assert point["apparent_temp"] == pytest.approx(forecast[point["hour"]], abs=0.05)
