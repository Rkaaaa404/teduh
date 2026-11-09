"""Hour-of-day thermal conditions shared by the routing and dashboard endpoints.

TCS is linear in shade and apparent temperature, so conditions at another hour
are the stored score plus the change in those two inputs. The sensitivities are
the TCS weights from `spark_jobs/utils/normalization.py`; this package cannot
import that module because the Lambda bundle ships only `api/`.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

WIB = timezone(timedelta(hours=7))

FIRST_DAYLIGHT_HOUR = 6
LAST_DAYLIGHT_HOUR = 17
NIGHT_SHADE_RATIO = 0.85  # TCS relief when there is no direct sun, set by the pipeline

# Shade weight 0.35 x shade share 0.7
TCS_PER_SHADE = 0.35 * 0.7
# Temperature weight 0.30 x apparent share 0.6 / comfort range 17 C
TCS_PER_APPARENT_DEGREE = 0.30 * 0.6 / 17.0


def is_daylight(hour: int) -> bool:
    return FIRST_DAYLIGHT_HOUR <= hour <= LAST_DAYLIGHT_HOUR


def shade_slot(hour: int) -> int | None:
    """1-based position of an hour in `shade_by_hour`, or None at night."""
    return hour - FIRST_DAYLIGHT_HOUR + 1 if is_daylight(hour) else None


def wib_hour(moment: datetime | None) -> int:
    """Hour of day in WIB. A naive datetime is taken to already be WIB."""
    if moment is None:
        return datetime.now(WIB).hour
    return (moment.astimezone(WIB) if moment.tzinfo else moment).hour


@dataclass(frozen=True)
class HourConditions:
    """Which hour's conditions a score describes."""

    hour: int
    basis: str  # "forecast" or "current"
    apparent_temp: float | None = None


def _only_if_scored(expression: str) -> str:
    """LEAST/GREATEST ignore NULLs in Postgres, so unscored segments need a guard."""
    return f"CASE WHEN lc.segment_id IS NULL THEN NULL ELSE {expression} END"


def apparent_at_hour_sql(conditions: HourConditions) -> str:
    return f"{conditions.apparent_temp:.3f}" if conditions.basis == "forecast" else "lc.apparent_temp"


def shade_at_hour_sql(conditions: HourConditions) -> str:
    if conditions.basis != "forecast":
        return "lc.shade_ratio"
    slot = shade_slot(conditions.hour)
    if slot is None:
        return _only_if_scored(str(NIGHT_SHADE_RATIO))
    return f"COALESCE(lc.shade_by_hour[{slot}], lc.shade_ratio)"


def tcs_at_hour_sql(conditions: HourConditions) -> str:
    """Stored TCS adjusted for the shade and apparent temperature of the chosen hour."""
    if conditions.basis != "forecast":
        return "lc.tcs_value"
    adjusted = (
        f"LEAST(1.0, GREATEST(0.0, lc.tcs_value"
        f" + {TCS_PER_SHADE:.6f} * ({shade_at_hour_sql(conditions)} - lc.shade_ratio)"
        f" + {TCS_PER_APPARENT_DEGREE:.6f} * (lc.apparent_temp - {conditions.apparent_temp:.3f})))"
    )
    return _only_if_scored(adjusted)


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def build_hourly_trend(
    *,
    avg_tcs: float,
    avg_green: float | None,
    avg_cool: float | None,
    avg_shade_now: float,
    avg_apparent_now: float,
    shade_by_slot: dict[int, float],
    forecast: list[tuple[int, float]],
) -> list[dict]:
    """City-wide TCS per forecast hour. Hours lacking real shade data are left out."""
    trend = []
    for hour, apparent in forecast:
        slot = shade_slot(hour)
        shade = NIGHT_SHADE_RATIO if slot is None else shade_by_slot.get(slot)
        if shade is None:
            continue

        tcs = _clamp(
            avg_tcs
            + TCS_PER_SHADE * (shade - avg_shade_now)
            + TCS_PER_APPARENT_DEGREE * (avg_apparent_now - apparent)
        )
        trend.append(
            {
                "hour": hour,
                "label": f"{hour:02d}:00",
                "tcs_current": round(tcs, 3),
                "tcs_green_scenario": (
                    round(_clamp(tcs + avg_green - avg_tcs), 3) if avg_green is not None else None
                ),
                "tcs_cool_scenario": (
                    round(_clamp(tcs + avg_cool - avg_tcs), 3) if avg_cool is not None else None
                ),
                "apparent_temp": round(apparent, 1),
            }
        )
    return trend
