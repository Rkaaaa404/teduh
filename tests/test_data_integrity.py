"""The served data must be real, correctly attributed and correctly aggregated.

Unit tests only: no database or network. Run with `pytest tests/test_data_integrity.py`.
"""
import math
from datetime import datetime

import pytest
from fastapi import HTTPException

from api import conditions
from api.db import ALERT_SEVERITIES_MOST_FIRST, ALERT_SEVERITY_RANK_SQL
from api.routes import navigation
from ingestion import (
    aqi_collector,
    bmkg_rss_monitor,
    fast_refresh,
    hdfs_client,
    traffic_collector,
    weather_collector,
)
from ingestion.alerts_loader import parse_published_utc
from ingestion.config import LiveDataUnavailable
from ingestion.weather_collector import parse_hourly_forecast
from spark_jobs.utils import normalization


REAL_WEATHER = {"current": {"temperature_2m": 30.1, "apparent_temperature": 35.2}}
REAL_AQI = {"aqi": 88}
REAL_TRAFFIC = [{"lat": -7.26, "lng": 112.74, "congestion_ratio": 0.0}]


def _raise(*_args, **_kwargs):
    raise ConnectionError("network down")


def _patch_sources(monkeypatch, *, live=None, cached=None):
    """Point each collector at the given live and cached documents."""
    live = live or {}
    cached = cached or {}
    for module, fetch, latest, key in (
        (weather_collector, "fetch_current_weather", "get_latest_weather", "weather"),
        (aqi_collector, "fetch_aqi", "get_latest_aqi", "aqi"),
        (traffic_collector, "fetch_all_traffic", "get_latest_traffic", "traffic"),
    ):
        monkeypatch.setattr(module, fetch, (lambda k=key: live[k]) if key in live else _raise)
        monkeypatch.setattr(module, latest, lambda k=key: cached.get(k))


# --- Live inputs: real or nothing ------------------------------------------------


def test_live_readings_are_preferred(monkeypatch):
    _patch_sources(
        monkeypatch,
        live={"weather": REAL_WEATHER, "aqi": REAL_AQI, "traffic": REAL_TRAFFIC},
    )
    inputs = fast_refresh._fetch_live_environmental_inputs()
    assert (inputs.air_temp, inputs.apparent_temp, inputs.aqi_value) == (30.1, 35.2, 88.0)
    assert set(inputs.sources.values()) == {"live"}


def test_falls_back_to_last_real_reading(monkeypatch):
    _patch_sources(
        monkeypatch,
        cached={"weather": REAL_WEATHER, "aqi": REAL_AQI, "traffic": REAL_TRAFFIC},
    )
    inputs = fast_refresh._fetch_live_environmental_inputs()
    assert inputs.air_temp == 30.1
    assert set(inputs.sources.values()) == {"cached"}


def test_skip_external_http_never_calls_the_apis(monkeypatch):
    _patch_sources(
        monkeypatch,
        live={"weather": {}, "aqi": {}, "traffic": []},
        cached={"weather": REAL_WEATHER, "aqi": REAL_AQI, "traffic": REAL_TRAFFIC},
    )
    monkeypatch.setattr(weather_collector, "fetch_current_weather", _raise)
    inputs = fast_refresh._fetch_live_environmental_inputs(skip_external_http=True)
    assert inputs.sources["weather"] == "cached"


def test_missing_input_raises_instead_of_inventing_a_value(monkeypatch):
    _patch_sources(monkeypatch, cached={"weather": REAL_WEATHER, "traffic": REAL_TRAFFIC})
    with pytest.raises(LiveDataUnavailable, match="AQI"):
        fast_refresh._fetch_live_environmental_inputs()


def test_refresh_skips_without_touching_the_database(monkeypatch):
    _patch_sources(monkeypatch)
    monkeypatch.setattr(fast_refresh.psycopg2, "connect", _raise)
    result = fast_refresh.run_fast_refresh()
    assert result["status"] == "skipped"
    assert "weather" in result["reason"]


def test_waqi_missing_reading_is_unavailable():
    assert fast_refresh._parse_aqi({"aqi": "-"}) is None
    assert fast_refresh._parse_aqi(None) is None
    assert fast_refresh._parse_aqi({"aqi": 0}) == 0.0


def test_free_flow_traffic_is_kept_as_zero():
    assert fast_refresh._parse_traffic(REAL_TRAFFIC) == [(-7.26, 112.74, 0.0)]


def test_traffic_without_a_measurement_is_dropped():
    assert fast_refresh._parse_traffic([{"lat": 1, "lng": 2, "congestion_ratio": None}]) is None


def test_speed_above_free_flow_counts_as_no_congestion():
    points = [{"lat": 1, "lng": 2, "congestion_ratio": -0.2}]
    assert fast_refresh._parse_traffic(points)[0][2] == 0.0


# --- SQL and Spark share one set of lookup tables --------------------------------


@pytest.mark.parametrize(
    ("sql", "table", "default"),
    [
        (fast_refresh.SURFACE_SCORE_SQL, normalization.SURFACE_SCORES, normalization.DEFAULT_SURFACE_SCORE),
        (fast_refresh.SMOOTHNESS_SCORE_SQL, normalization.SMOOTHNESS_SCORES, normalization.DEFAULT_SMOOTHNESS_SCORE),
        (fast_refresh.SURFACE_TEMP_SQL, normalization.SURFACE_TEMP_CORRECTION, normalization.DEFAULT_SURFACE_TEMP_CORRECTION),
    ],
)
def test_fast_refresh_case_matches_normalization(sql, table, default):
    for key, value in table.items():
        assert f"WHEN '{key}' THEN {value}" in sql
    assert sql.endswith(f"ELSE {default} END")


# --- Alerts ----------------------------------------------------------------------


def test_published_date_is_converted_to_utc():
    assert parse_published_utc("Mon, 09 Nov 2026 18:10:00 +0700") == datetime(2026, 11, 9, 11, 10)


@pytest.mark.parametrize("value", ["", "not a date", None])
def test_unparsable_published_date_is_rejected(value):
    assert parse_published_utc(value) is None


@pytest.mark.parametrize(
    "description, relevant",
    [
        ("Hujan lebat di sebagian wilayah Jawa Timur, khususnya di BANGSALSARI, SILO", False),
        ("Hujan lebat di sebagian wilayah Jawa Timur, khususnya di GUBENG, RUNGKUT", True),
        ("Hujan lebat di Kota Surabaya", True),
        ("Hujan lebat di Jawa Tengah, khususnya di SUKOLILO", False),
    ],
)
def test_alert_relevance_needs_more_than_the_province(description, relevant):
    assert (
        bmkg_rss_monitor._is_surabaya_relevant({"title": "Hujan Lebat", "description": description})
        is relevant
    )


@pytest.mark.parametrize(
    "buildings, height, trees, length, tan_elevation",
    [(46, 10.0, 0, 68.0, 8.0), (167, 25.0, 3, 12.0, 0.3), (0, 10.0, 0, 200.0, 1.0)],
)
def test_shade_sql_and_python_agree(buildings, height, trees, length, tan_elevation):
    sql = normalization.shade_ratio_sql(
        str(buildings), str(height), str(trees), str(length), str(tan_elevation)
    )
    evaluated = eval(sql.replace("LEAST", "min").replace("EXP", "math.exp"), {"min": min, "math": math})
    assert evaluated == pytest.approx(
        normalization.shade_ratio(buildings, height, trees, length, tan_elevation)
    )


def test_shade_does_not_saturate_with_a_high_sun():
    # A typical segment: 46 buildings nearby, 68 m long, 10 m tall, sun nearly overhead.
    noon = normalization.shade_ratio(46, 10.0, 0, 68.0, tan_elevation=8.0)
    early = normalization.shade_ratio(46, 10.0, 0, 68.0, tan_elevation=0.3)
    assert noon < 0.3 < early <= 1.0


def test_route_cost_is_unchanged_without_alerts():
    assert navigation._with_alert_costs("base_cost", {}) == "base_cost"


def test_closure_outweighs_other_incidents_on_the_same_edge_cost():
    sql = navigation._with_alert_costs("base_cost", {7: 50.0, 9: 4.0, 11: 50.0})
    assert sql.index("ARRAY[7,11]") < sql.index("ARRAY[9]")
    assert sql.startswith("(base_cost * CASE") and sql.endswith("ELSE 1.0 END)")


def test_hdfs_write_retries_while_the_datanode_registers(monkeypatch):
    statuses = iter([403, 403, 201])

    class Reply:
        def __init__(self, status_code):
            self.status_code = status_code
            self.headers = {"Location": "http://datanode/x"}
            self.text = ""

    def fake_put(url, **_kwargs):
        return Reply(307) if "datanode" not in url else Reply(next(statuses))

    monkeypatch.setenv("HDFS_NAMENODE", "hdfs://namenode:9000")
    monkeypatch.setattr(hdfs_client.requests, "put", fake_put)
    monkeypatch.setattr(hdfs_client.time, "sleep", lambda _seconds: None)
    assert hdfs_client.write_to_hdfs("/lakehouse/bronze/x", "{}") is True


def test_extreme_alerts_rank_first():
    assert ALERT_SEVERITIES_MOST_FIRST[0] == "extreme"
    assert ALERT_SEVERITY_RANK_SQL.index("'extreme'") < ALERT_SEVERITY_RANK_SQL.index("'minor'")
    assert "WHEN 'extreme' THEN 0" in ALERT_SEVERITY_RANK_SQL


# --- Route statistics ------------------------------------------------------------


def _row(length, tcs, shade, segment_id=1):
    return {
        "segment_id": segment_id,
        "length_m": length,
        "tcs_value": tcs,
        "shade_ratio": shade,
        "apparent_temp": 34.0,
        "surface_type": "asphalt",
        "geom_json": '{"coordinates": [[112.70, -7.20], [112.71, -7.21]]}',
    }


def test_route_averages_are_weighted_by_length():
    rows = [_row(900.0, 0.8, 0.5), _row(100.0, 0.2, 0.1)]
    route = navigation.summarize_route_rows(rows, "shortest", 15.0, daylight=True)
    assert route["avg_tcs"] == pytest.approx(0.74)
    # 1000 m at 75 m/min with a weighted shade of 0.46
    assert route["sun_exposure_min"] == pytest.approx(13.33 * 0.54, abs=0.05)


def test_no_sun_exposure_at_night():
    route = navigation.summarize_route_rows([_row(1500.0, 0.8, 0.85)], "shortest", 15.0, daylight=False)
    assert route["sun_exposure_min"] == 0.0
    assert route["within_heat_budget"] is True


def test_heat_budget_verdict_uses_exposure():
    route = navigation.summarize_route_rows([_row(3000.0, 0.3, 0.0)], "shortest", 15.0, daylight=True)
    assert route["sun_exposure_min"] == 40.0
    assert route["within_heat_budget"] is False


def test_unscored_segments_are_excluded_from_averages():
    rows = [_row(100.0, 0.6, 0.5), _row(900.0, None, None)]
    route = navigation.summarize_route_rows(rows, "shortest", 15.0, daylight=True)
    assert route["avg_tcs"] == 0.6
    assert route["distance_m"] == 1000.0
    assert route["segments"][1]["tcs_value"] is None


def test_route_with_no_real_scores_has_no_summary():
    assert navigation.summarize_route_rows([_row(100.0, None, None)], "shortest", 15.0, daylight=True) is None


def test_segment_details_span_the_whole_route():
    rows = [_row(10.0, 0.5, 0.5, segment_id=i) for i in range(100)]
    details = navigation.summarize_route_rows(rows, "shortest", 15.0, daylight=True)["segments"]
    assert len(details) == 15
    assert details[0]["segment_id"] == 0
    assert details[-1]["segment_id"] == 99


def test_failed_route_is_not_within_budget():
    assert navigation._empty_route("shortest")["within_heat_budget"] is False


# --- Hour-aware conditions -------------------------------------------------------


def test_shade_slot_maps_daylight_hours():
    assert conditions.shade_slot(6) == 1
    assert conditions.shade_slot(17) == 12
    assert conditions.shade_slot(18) is None
    assert conditions.shade_slot(5) is None


def test_departure_hour_uses_wib():
    assert conditions.wib_hour(datetime.fromisoformat("2026-11-09T06:30:00+00:00")) == 13
    assert conditions.wib_hour(datetime(2026, 11, 9, 13, 30)) == 13


def test_route_sql_reads_the_requested_hour():
    midday = conditions.HourConditions(hour=13, basis="forecast", apparent_temp=36.5)
    sql = conditions.tcs_at_hour_sql(midday)
    assert "lc.shade_by_hour[8]" in sql
    assert "36.500" in sql


def test_route_sql_uses_stored_values_without_a_forecast():
    current = conditions.HourConditions(hour=13, basis="current")
    assert conditions.tcs_at_hour_sql(current) == "lc.tcs_value"
    assert conditions.shade_at_hour_sql(current) == "lc.shade_ratio"


def test_route_sql_guards_unscored_segments():
    night = conditions.HourConditions(hour=21, basis="forecast", apparent_temp=29.0)
    assert conditions.shade_at_hour_sql(night).startswith("CASE WHEN lc.segment_id IS NULL")
    assert conditions.tcs_at_hour_sql(night).startswith("CASE WHEN lc.segment_id IS NULL")


def _trend(**overrides):
    params = {
        "avg_tcs": 0.5,
        "avg_green": 0.6,
        "avg_cool": 0.55,
        "avg_shade_now": 0.4,
        "avg_apparent_now": 34.0,
        "shade_by_slot": {7: 0.6},  # slot 7 is 12:00
        "forecast": [(12, 34.0)],
    }
    return conditions.build_hourly_trend(**{**params, **overrides})


def test_trend_follows_shade_and_forecast():
    point = _trend()[0]
    assert point["tcs_current"] == pytest.approx(0.5 + conditions.TCS_PER_SHADE * 0.2, abs=0.001)
    hotter = _trend(forecast=[(12, 38.0)])[0]
    assert hotter["tcs_current"] < point["tcs_current"]
    assert hotter["apparent_temp"] == 38.0


def test_trend_keeps_scenario_gain():
    point = _trend()[0]
    assert point["tcs_green_scenario"] == pytest.approx(point["tcs_current"] + 0.1, abs=0.001)


def test_trend_omits_hours_without_real_shade():
    assert _trend(shade_by_slot={}) == []


def test_trend_is_empty_without_a_forecast():
    assert _trend(forecast=[]) == []


def test_trend_scenarios_stay_null_without_simulations():
    point = _trend(avg_green=None, avg_cool=None)[0]
    assert point["tcs_green_scenario"] is None
    assert point["tcs_cool_scenario"] is None


def test_hourly_forecast_is_parsed_from_open_meteo():
    doc = {
        "hourly": {
            "time": ["2026-11-09T12:00", "2026-11-09T13:00"],
            "temperature_2m": [31.0, 32.0],
            "apparent_temperature": [36.0, None],
            "direct_radiation": [700.0, 650.0],
            "cloud_cover": [20, 30],
        }
    }
    rows = parse_hourly_forecast(doc)
    assert len(rows) == 1
    assert rows[0][1:] == (12, 31.0, 36.0, 700.0, 20)


def test_hourly_forecast_handles_missing_block():
    assert parse_hourly_forecast({"current": {}}) == []
    assert parse_hourly_forecast(None) == []


# --- Admin guard -----------------------------------------------------------------


def test_admin_routes_are_disabled_without_a_token(monkeypatch):
    monkeypatch.setattr(navigation, "ADMIN_TOKEN", "")
    with pytest.raises(HTTPException) as caught:
        navigation.require_admin(x_admin_token=None)
    assert caught.value.status_code == 404


def test_admin_routes_reject_a_wrong_token(monkeypatch):
    monkeypatch.setattr(navigation, "ADMIN_TOKEN", "secret")
    with pytest.raises(HTTPException):
        navigation.require_admin(x_admin_token="wrong")


def test_admin_routes_accept_the_right_token(monkeypatch):
    monkeypatch.setattr(navigation, "ADMIN_TOKEN", "secret")
    assert navigation.require_admin(x_admin_token="secret") is None
