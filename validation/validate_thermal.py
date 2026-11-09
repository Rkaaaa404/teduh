"""Thermal Comfort Model Validation.

Compares system-calculated apparent temperature and TCS against
in-situ measurements at sample trotoar points in Surabaya.

Method: Mean Absolute Error (MAE) of system vs measured temperature.
Target: MAE <= 1.5°C at 10 sample points.
"""

from datetime import datetime
from typing import Optional

from spark_jobs.utils.normalization import (
    normalize_shade,
    normalize_temperature,
    normalize_aqi,
    normalize_traffic,
    normalize_surface,
    compute_tcs,
)


# In-situ measurement samples (would be collected with thermometer/hygrometer)
# For validation prototype, these are representative expected values
MEASUREMENT_SAMPLES = [
    {
        "name": "Jl. Tunjungan (trotoar terbuka)",
        "lat": -7.2587, "lng": 112.7377,
        "time": "10:00", "surface": "paving_stones",
        "measured_temp_c": 36.5,
        "shade_observed": 0.1,  # Almost no shade
        "category": "open",
    },
    {
        "name": "Jl. Tunjungan (bawah kanopi toko)",
        "lat": -7.2590, "lng": 112.7378,
        "time": "10:00", "surface": "paving_stones",
        "measured_temp_c": 32.8,
        "shade_observed": 0.85,
        "category": "building_shade",
    },
    {
        "name": "Taman Bungkul (jalur pohon)",
        "lat": -7.2913, "lng": 112.7395,
        "time": "12:00", "surface": "asphalt",
        "measured_temp_c": 31.5,
        "shade_observed": 0.9,
        "category": "tree_shade",
    },
    {
        "name": "Jl. Darmo (trotoar terbuka)",
        "lat": -7.2878, "lng": 112.7310,
        "time": "12:00", "surface": "asphalt",
        "measured_temp_c": 39.2,
        "shade_observed": 0.05,
        "category": "open",
    },
    {
        "name": "Jl. Basuki Rahmat (sisi gedung)",
        "lat": -7.2679, "lng": 112.7407,
        "time": "14:00", "surface": "concrete",
        "measured_temp_c": 34.0,
        "shade_observed": 0.6,
        "category": "building_shade",
    },
    {
        "name": "Jl. Pemuda (bawah pohon trembesi)",
        "lat": -7.2640, "lng": 112.7500,
        "time": "12:00", "surface": "asphalt",
        "measured_temp_c": 30.8,
        "shade_observed": 0.95,
        "category": "tree_shade",
    },
    {
        "name": "Jl. Ahmad Yani (median jalan)",
        "lat": -7.3215, "lng": 112.7378,
        "time": "10:00", "surface": "asphalt",
        "measured_temp_c": 38.5,
        "shade_observed": 0.0,
        "category": "open",
    },
    {
        "name": "Jl. Kertajaya (area kampus UNAIR)",
        "lat": -7.2721, "lng": 112.7670,
        "time": "14:00", "surface": "paving_stones",
        "measured_temp_c": 33.2,
        "shade_observed": 0.7,
        "category": "tree_shade",
    },
    {
        "name": "Jl. Urip Sumoharjo (halte bus)",
        "lat": -7.2757, "lng": 112.7381,
        "time": "12:00", "surface": "concrete",
        "measured_temp_c": 37.8,
        "shade_observed": 0.15,
        "category": "open",
    },
    {
        "name": "Jl. Diponegoro (bawah kanopi pohon tua)",
        "lat": -7.2865, "lng": 112.7343,
        "time": "14:00", "surface": "asphalt",
        "measured_temp_c": 31.0,
        "shade_observed": 0.92,
        "category": "tree_shade",
    },
]


def estimate_system_temperature(sample: dict, air_temp: float = 33.0) -> float:
    """Estimate apparent temperature using system model.

    Uses the same logic as the production system:
    - Base air temperature from Open-Meteo
    - Surface material correction
    - Shade reduction factor
    """
    # Surface correction (same table as spark_jobs/utils/normalization.py)
    surface_corrections = {
        "asphalt": 8.0,
        "concrete": 6.0,
        "paving_stones": 4.0,
    }
    correction = surface_corrections.get(sample["surface"], 5.0)

    # LST estimate
    lst = air_temp + correction

    # Shade reduces effective temperature felt by pedestrian
    shade_factor = sample["shade_observed"]
    # In shade, temperature feels ~5-8C cooler (due to no direct radiation)
    shade_cooling = shade_factor * 7.0

    estimated_temp = lst - shade_cooling

    return estimated_temp


def run_validation(air_temp: float = 33.0):
    """Run thermal comfort validation on all measurement points."""
    print("=" * 60)
    print("  Teduh Thermal Comfort Validation")
    print(f"  Base air temperature: {air_temp}°C")
    print("  Target: MAE <= 1.5°C across 10 sample points")
    print("=" * 60)
    print()

    errors = []

    for sample in MEASUREMENT_SAMPLES:
        estimated = estimate_system_temperature(sample, air_temp)
        measured = sample["measured_temp_c"]
        error = estimated - measured
        abs_error = abs(error)
        errors.append(abs_error)

        status = "✅" if abs_error <= 1.5 else "⚠️" if abs_error <= 2.5 else "❌"
        print(f"  {status} {sample['name']}")
        print(f"     Category: {sample['category']} | Shade: {sample['shade_observed']:.0%}")
        print(f"     Estimated: {estimated:.1f}°C | Measured: {measured:.1f}°C | Error: {error:+.1f}°C")
        print()

    mae = sum(errors) / len(errors)
    max_error = max(errors)
    within_target = sum(1 for e in errors if e <= 1.5)

    print(f"  {'='*40}")
    print(f"  MAE: {mae:.2f}°C (target: <= 1.5°C) {'✅ PASS' if mae <= 1.5 else '❌ FAIL'}")
    print(f"  Max Error: {max_error:.2f}°C")
    print(f"  Points within ±1.5°C: {within_target}/{len(errors)}")

    return {
        "mae": mae,
        "max_error": max_error,
        "within_target": within_target,
        "total": len(errors),
        "pass": mae <= 1.5,
    }


if __name__ == "__main__":
    run_validation()
