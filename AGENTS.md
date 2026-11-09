# Teduh

Thermal-comfort pedestrian navigation for Surabaya, plus a city government dashboard. Each street segment gets a Thermal Comfort Score (TCS, 0 to 1), and routing trades distance against heat.

## Data flow

```
Open-Meteo, WAQI, TomTom, BMKG, OSM, Dishub
  -> ingestion/            collectors write data/raw/<category>/*.json and HDFS Bronze
  -> spark_jobs/           Jobs 1-6, orchestrated by run_pipeline.py
     or ingestion/fast_refresh.py    the same model in SQL, no Spark needed
  -> PostGIS               segment_live_comfort is the serving table
  -> api/                  FastAPI (uvicorn locally, Lambda + Supabase in production)
  -> frontend/             Next.js; every backend call is in services/api.ts
```

## Where to look

| Task | File |
|---|---|
| Routing cost, route stats | `api/routes/navigation.py` |
| Conditions at another hour | `api/conditions.py` |
| Dashboard metrics | `api/routes/dashboard.py` |
| Incident reports, map alerts | `api/routes/reports.py`, `api/routes/alerts.py` |
| Request/response shapes | `api/models/schemas.py`, mirrored in `frontend/types/index.ts` |
| TCS weights and lookup tables | `spark_jobs/utils/normalization.py` |
| Refresh without Spark | `ingestion/fast_refresh.py` |
| Newest real input for Spark jobs | `spark_jobs/live_inputs.py` |
| Pipeline order | `spark_jobs/run_pipeline.py` |
| Serving schema and upgrades | `database/optimize_serving.sql` |
| Base schema and routing topology | `database/init.sql` |
| Copy to production | `scripts/sync_to_supabase.sh` |
| Feature spec for incidents | `docs/specs/incident-alert-system.md` |
| Deployment, demo script | `docs/DEPLOYMENT.md`, `docs/DEMO_GUIDE.md` |

## Rule: no fabricated data

An input comes from the live API, or from the last real cached reading. If neither exists, raise `LiveDataUnavailable` and leave served rows alone. Never substitute a constant, including through `COALESCE`, `na.fill`, column defaults or `value or 0.3` (that last form also destroys a real `0`).

Allowed: a neutral cost for an unscored segment during path-finding only, never shown to users, and physical model parameters such as the 10 m default building height.

## What each metric is

| Field | Source | Real or proxy |
|---|---|---|
| `apparent_temp` | Open-Meteo | Measured, one city value |
| `aqi_value` | WAQI | Measured, one city value |
| `traffic_level` | TomTom, 8 stations | Measured, nearest station per segment |
| `weather_hourly_forecast` | Open-Meteo hourly | Forecast |
| `avg_ndvi` | OSM tree density | **Proxy**, not satellite |
| `avg_lst` | Air temperature + surface material | **Proxy**, not satellite |
| `shade_ratio`, `shade_by_hour` | Solar geometry + OSM buildings and trees | Modelled. Night uses the 0.85 relief value |
| `tcs_simulations` | Spark MLlib or the TCS formula | Modelled, see the `source` column |
| `transit_access` | Transit stops near the corridor | Not pedestrian counts |

## Changing the TCS model

The formula exists in three places: `normalization.py` (reference, and the lookup tables), `job_thermal_comfort.py` (Spark) and `fast_refresh.py` (SQL). Lookup tables are shared automatically. A weight change must be made in all three and in the sensitivities in `api/conditions.py`, which can't import the others because Lambda ships only `api/`.

## Not used at serving time

- `edge_weights` and Spark Job 5: an offline Gold artifact. Routing computes its own cost per request.
- `thermal_comfort_scores`: the source for `sync_segment_live_comfort`. The API reads `segment_live_comfort`.
- `segment_shadows`: rolled up into `shade_by_hour` and not copied to Supabase.
- `ingestion/scheduler.py`: optional, compose does not start it. `ingestion/transit_loader.py` is run by hand.

## Commands

```bash
docker compose up -d --build postgres api          # database and API on :8000
docker compose --profile pipeline up spark-pipeline  # full pipeline, including HDFS
docker compose exec api python -m ingestion.fast_refresh
npm run dev --prefix frontend

pytest tests/test_normalization.py tests/test_solar_position.py tests/test_data_integrity.py
pytest tests/test_e2e.py tests/test_core_outputs.py  # need the running stack and pipeline data
npm run lint --prefix frontend && npm run build --prefix frontend
```

Rebuild routing topology: `SELECT build_routing_topology();` (local database only).

## Good to know

- The database is named `commute_cool` and its user `cc_user`, from the project's earlier name. Renaming them would break existing volumes and the production path, so they stay.
- Production is a manual snapshot: Lambda reads Supabase, and only `scripts/sync_to_supabase.sh` updates it. After a schema change, sync before deploying the API.
- The Spark image runs Python 3.8. Anything it imports from `ingestion/` or `spark_jobs/` needs `from __future__ import annotations` to use `X | None` or `list[dict]` in signatures.
- `weather_alerts` timestamps are naive UTC.
- `/dashboard/uhi`, `/priority-corridors` and `/walkability` score the hottest forecast hour (`conditions_hour`), so they don't depend on when the data was refreshed. `/dashboard/heat-prediction` summaries are current conditions.
- Approved `map_alerts` raise edge costs in routing (`_ALERT_COST_MULT` in `navigation.py`); heat reports don't, because TCS already prices heat.
- Moderation endpoints are unauthenticated on purpose for the demo; see `docs/DEPLOYMENT.md`.
- Shade is a count-based estimate (`shade_ratio_sql` in `normalization.py`, shared by Spark and fast refresh), calibrated by `validation/validate_shade_geometry.py` against shadows cast from real OSM footprints. It tracks the city average well; per segment it is off by about 0.23. OSM limits it: 98.7% of buildings have the 10 m default height and only 277 trees are mapped.
