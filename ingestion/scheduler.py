"""Job Scheduler - Orchestrate all ingestion and Spark job execution.

Uses APScheduler to run data collection and processing jobs
on their defined schedules.

Schedule (from design.md Section 8.2):
- OSM Fetch: Daily at 03:00
- Weather Collector: Every 15 minutes
- Traffic Collector: Every 15 minutes
- AQI Collector: Every 30 minutes
- BMKG RSS Monitor: Every 5 minutes
- CCTV Registry: Daily at 03:30
"""

import os
import sys
import subprocess
from datetime import datetime

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger


def run_osm_fetch():
    """Daily OSM data fetch."""
    print(f"[Scheduler] {datetime.now()} - Running OSM Fetch")
    try:
        from ingestion.osm_fetcher import fetch_all
        fetch_all()
    except Exception as e:
        print(f"[Scheduler] OSM Fetch failed: {e}")


def run_osm_load():
    """Load fetched OSM data into PostGIS."""
    print(f"[Scheduler] {datetime.now()} - Running OSM Load")
    try:
        from ingestion.osm_loader import load_all
        load_all()
    except Exception as e:
        print(f"[Scheduler] OSM Load failed: {e}")


def run_weather_collect():
    """Fetch current weather data."""
    print(f"[Scheduler] {datetime.now()} - Running Weather Collector")
    try:
        from ingestion.weather_collector import fetch_current_weather
        fetch_current_weather()
    except Exception as e:
        print(f"[Scheduler] Weather Collector failed: {e}")


def run_traffic_collect():
    """Fetch traffic flow data."""
    print(f"[Scheduler] {datetime.now()} - Running Traffic Collector")
    try:
        from ingestion.traffic_collector import fetch_all_traffic
        fetch_all_traffic()
    except Exception as e:
        print(f"[Scheduler] Traffic Collector failed: {e}")


def run_aqi_collect():
    """Fetch air quality data."""
    print(f"[Scheduler] {datetime.now()} - Running AQI Collector")
    try:
        from ingestion.aqi_collector import fetch_aqi
        fetch_aqi()
    except Exception as e:
        print(f"[Scheduler] AQI Collector failed: {e}")


def run_bmkg_monitor():
    """Check BMKG weather alerts and load them into database."""
    print(f"[Scheduler] {datetime.now()} - Running BMKG Monitor")
    try:
        from ingestion.bmkg_rss_monitor import fetch_bmkg_alerts
        from ingestion.alerts_loader import load_alerts_to_db
        fetch_bmkg_alerts()
        load_alerts_to_db()
    except Exception as e:
        print(f"[Scheduler] BMKG Monitor failed: {e}")


def run_cctv_registry():
    """Update CCTV camera registry."""
    print(f"[Scheduler] {datetime.now()} - Running CCTV Registry Update")
    try:
        from ingestion.cctv_registry import run
        run()
    except Exception as e:
        print(f"[Scheduler] CCTV Registry failed: {e}")


def run_spark_jobs():
    """Trigger Spark processing jobs (submit to Spark cluster)."""
    print(f"[Scheduler] {datetime.now()} - Triggering Spark Jobs")
    spark_master = os.getenv("SPARK_MASTER_URL", "spark://localhost:7077")

    jobs = [
        "spark_jobs/job_raster_segment.py",
        "spark_jobs/job_shadow_model.py",
        "spark_jobs/job_traffic_aqi.py",
        "spark_jobs/job_thermal_comfort.py",
        "spark_jobs/job_graph_weight.py",
        "spark_jobs/job_tcs_predictor.py",
    ]

    for job in jobs:
        print(f"  Submitting: {job}")
        try:
            subprocess.run(
                ["spark-submit", "--master", spark_master, job],
                timeout=300,
                check=False,
            )
        except FileNotFoundError:
            print(f"  [Warning] spark-submit not found. Run manually or via Docker.")
            break
        except Exception as e:
            print(f"  [Error] {job}: {e}")


def create_scheduler() -> BlockingScheduler:
    """Create and configure the job scheduler."""
    scheduler = BlockingScheduler()

    # --- Frequent jobs (real-time data) ---
    scheduler.add_job(run_weather_collect, IntervalTrigger(minutes=15), id="weather")
    scheduler.add_job(run_traffic_collect, IntervalTrigger(minutes=15), id="traffic")
    scheduler.add_job(run_aqi_collect, IntervalTrigger(minutes=30), id="aqi")
    scheduler.add_job(run_bmkg_monitor, IntervalTrigger(minutes=5), id="bmkg")

    # --- Daily jobs (batch data) ---
    scheduler.add_job(run_osm_fetch, CronTrigger(hour=3, minute=0), id="osm_fetch")
    scheduler.add_job(run_osm_load, CronTrigger(hour=3, minute=30), id="osm_load")
    scheduler.add_job(run_cctv_registry, CronTrigger(hour=3, minute=45), id="cctv")

    # --- Spark processing (after daily data refresh) ---
    scheduler.add_job(run_spark_jobs, CronTrigger(hour=4, minute=30), id="spark")

    return scheduler


def main():
    """Start the scheduler."""
    print("=" * 60)
    print("  Teduh Job Scheduler")
    print("  Starting all scheduled jobs...")
    print("=" * 60)
    print()
    print("  Schedule:")
    print("    Weather:    every 15 min")
    print("    Traffic:    every 15 min")
    print("    AQI:        every 30 min")
    print("    BMKG:       every 5 min")
    print("    OSM Fetch:  daily 03:00")
    print("    OSM Load:   daily 03:30")
    print("    CCTV:       daily 03:45")
    print("    Spark Jobs: daily 04:30")
    print()
    print("  Press Ctrl+C to stop.")
    print()

    scheduler = create_scheduler()

    # Run initial collection on startup
    print("[Scheduler] Running initial data collection...")
    run_weather_collect()
    run_bmkg_monitor()

    try:
        scheduler.start()
    except KeyboardInterrupt:
        print("\n[Scheduler] Shutting down...")
        scheduler.shutdown()


if __name__ == "__main__":
    main()
