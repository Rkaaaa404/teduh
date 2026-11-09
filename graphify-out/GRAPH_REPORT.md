# Graph Report - innovboyo  (2026-11-09)

## Corpus Check
- 97 files · ~59,462 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 15 file(s) not represented in the graph (top: (none) 5, .example 1, .api 1)

## Summary
- 1245 nodes · 2483 edges · 86 communities (66 shown, 20 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b3037d73`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- math
- solar_position.py
- incident-alert-system.md
- test_normalization.py
- AWS SAM Infrastructure Template
- frontend/package.json
- os
- Asyncpg Database Pool & Caching
- Next.js App Shell & Fonts
- TeduhAppShell.tsx
- APScheduler Background Estimation Tasks
- navigation.py
- api.ts
- End-to-End Testing & Async HTTP
- GovernmentDashboard.tsx
- Dishub Surabaya CCTV Registry
- OpenStreetMap Overpass Fetcher
- run_pipeline.py
- Database Pool & Analytics Routes
- Incident Reporting & Moderation API
- FastAPI Pydantic Schemas
- TypeScript Compiler Configuration
- test_core_outputs.py
- Incident Alert Detail Popover
- 🎓 PENCERDASAN DEMO Teduh
- summarize_route_rows
- _is_surabaya_relevant
- Thermal Comfort Score (TCS) Equation
- _fetch_live_environmental_inputs
- index.ts
- PostgreSQL Container Configuration
- geoMath.ts
- Environment Variable Configuration
- fast_refresh.py
- HDFS Datanode Container Service
- HDFS Namenode Container Service
- datetime
- LiveDataUnavailable
- Docker Compose Service Dependencies
- Root Workspace Scripts
- Docker Healthcheck Specifications
- Sedona & Solar Shadow Pipeline
- Docker Compose Volume Storage
- FastAPI Container Resource Limits
- Spark Pipeline Container Profile
- conditions.py
- dependencies
- normalize_shade
- Docker Multi-Stage Build Configurations
- Supabase Database Synchronization
- normalize_temperature
- normalize_aqi
- TEDUH Brand Identity & Assets
- layout.tsx
- Mobile Deployment & QR Gateway
- HTTP Client & Scheduling Libraries
- test_data_integrity.py
- PostCSS Styling Configuration
- cctv.py
- Pytest Test Suite Dependencies
- validate_shade_geometry.py
- eslint.config.mjs
- run
- scripts
- RSS Alert Parser Dependency
- Cartographic Projection Dependency
- run
- normalize_traffic
- next.config.ts
- validate_thermal.py
- _parse_traffic
- parse_hourly_forecast
- Pandas 2.0.3 Data Structuring
- validate_shadow_length
- _parse_aqi
- test_hdfs_write_retries_while_the_datanode_registers
- compute_iou

## God Nodes (most connected - your core abstractions)
1. `get_conn()` - 33 edges
2. `TeduhAppShell()` - 31 edges
3. `main()` - 20 edges
4. `GovernmentDashboard()` - 19 edges
5. `react` - 19 edges
6. `Coordinate` - 18 edges
7. `get_or_create_spark()` - 18 edges
8. `parseErrorDetail()` - 18 edges
9. `compilerOptions` - 16 edges
10. `lucide-react` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Rule: no fabricated data` --references--> `LiveDataUnavailable`  [INFERRED]
  AGENTS.md → ingestion/config.py
- `Good to know` --references--> `shade_ratio_sql()`  [INFERRED]
  AGENTS.md → spark_jobs/utils/normalization.py
- `What each metric is` --references--> `shade_ratio()`  [INFERRED]
  AGENTS.md → spark_jobs/utils/normalization.py
- `test_departure_hour_uses_wib()` --calls--> `wib_hour()`  [EXTRACTED]
  tests/test_data_integrity.py → api/conditions.py
- `trigger_fast_refresh()` --indirect_call--> `run_fast_refresh()`  [INFERRED]
  api/routes/navigation.py → ingestion/fast_refresh.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **TEDUH Mobile Onboarding Flow** — docs_assets_qr_teduh_svg_qrcode, docs_assets_qr_teduh_svg_live_deployment, docs_assets_qr_teduh_svg_mobile_access [INFERRED 0.85]
- **TEDUH Brand System Cohesion** — frontend_public_logo_teduh_brand_logo, frontend_public_logo_teduh_branding_concept, frontend_public_logo_teduh_hud_navbar_integration, frontend_public_logo_teduh_design_attributes [INFERRED 0.85]

## Communities (86 total, 20 thin omitted)

### Community 0 - "math"
Cohesion: 0.14
Nodes (6): compute_segment_shade_ratio(), compute_shadow_direction(), compute_shadow_length(), _direction_to_dx_dy(), project_building_shadow(), project_tree_shadow()

### Community 1 - "solar_position.py"
Cohesion: 0.12
Nodes (11): get_solar_position(), get_surabaya_solar_position(), _pvlib_solar_position(), _simplified_solar_position(), SolarPosition, test_azimuth_range(), test_early_morning_low_elevation(), test_midday_elevation_tropical() (+3 more)

### Community 2 - "incident-alert-system.md"
Cohesion: 0.05
Nodes (42): 1.1 Alur Pelaporan, 1.2 Yang Terjadi Setelah User Kirim, 2.1 Mengapa Validasi Manual Pemerintah, 2.2 Tampilan Panel Moderasi di Dashboard Pemerintah, 2.3 Detail Laporan (Modal saat "Lihat Detail & Foto" diklik), 2.4 Alur Backend saat Pemerintah Menekan "Setujui", 2.5 Alur Backend saat Pemerintah Menekan "Tolak", 3.1 Jenis Icon Alert per Kategori (+34 more)

### Community 3 - "test_normalization.py"
Cohesion: 0.14
Nodes (8): compute_tcs(), normalize_surface(), test_compute_tcs_all_perfect(), test_compute_tcs_all_worst(), test_compute_tcs_bounds(), test_compute_tcs_weights_sum_to_one(), test_normalize_surface_asphalt_good(), test_normalize_surface_unpaved_bad()

### Community 4 - "AWS SAM Infrastructure Template"
Cohesion: 0.04
Nodes (48): Default, Description, NoEcho, Type, Metadata, Properties, Type, Properties (+40 more)

### Community 5 - "frontend/package.json"
Cohesion: 0.12
Nodes (22): devDependencies, postcss@^8.5.15, tailwindcss@^4.1.0, @tailwindcss/postcss@^4.1.0, @types/geojson@^7946.0.16, @types/node@^20, @types/react@^19, @types/react-dom@^19 (+14 more)

### Community 6 - "os"
Cohesion: 0.10
Nodes (11): fetch_aqi(), fetch_aqi_by_coordinates(), get_latest_aqi(), _classify_severity(), fetch_bmkg_alerts(), get_active_alerts(), write_to_hdfs(), fetch_all_traffic() (+3 more)

### Community 7 - "Asyncpg Database Pool & Caching"
Cohesion: 0.11
Nodes (6): close_pool(), get_pool(), _ensure_serving_layer_ready(), health_check(), lifespan(), root()

### Community 8 - "Next.js App Shell & Fonts"
Cohesion: 0.15
Nodes (28): CCTVModalProps, applySurabaya3DUrbanStyle(), configure3DBuildings(), configureAtmosphereAndSky(), F4MAP_PALETTE, findBuildingExtrusionLayerId(), findFirstSymbolLayerId(), initializeFactualDataLayers() (+20 more)

### Community 9 - "TeduhAppShell.tsx"
Cohesion: 0.10
Nodes (33): NavigasiPage(), HomePage(), IncidentReportModal(), CameraCompassControl(), CameraCompassControlProps, renderWeatherIcon(), getPeriodLabel(), PRESETS (+25 more)

### Community 10 - "APScheduler Background Estimation Tasks"
Cohesion: 0.10
Nodes (12): load_alerts_to_db(), run(), create_scheduler(), main(), run_aqi_collect(), run_bmkg_monitor(), run_cctv_registry(), run_osm_fetch() (+4 more)

### Community 11 - "navigation.py"
Cohesion: 0.10
Nodes (15): wib_hour(), ttl_cache_clear(), RouteResponse, _alert_edge_costs(), calculate_route(), _empty_response(), _empty_route(), _find_nearest_node() (+7 more)

### Community 12 - "api.ts"
Cohesion: 0.09
Nodes (33): MapPickTarget, SearchPanel(), SearchPanelProps, TOLERANCE_OPTIONS, API_BASE, API_V1_BASE, BACKEND_ORIGIN, fetchNearbyCCTVs() (+25 more)

### Community 13 - "End-to-End Testing & Async HTTP"
Cohesion: 0.17
Nodes (8): test_cctv_nearby(), test_dashboard_corridors(), test_dashboard_uhi(), test_health_check(), test_route_endpoint_validation(), test_route_outside_surabaya_rejected(), test_thermal_segments_endpoint(), test_weather_collector_import()

### Community 14 - "GovernmentDashboard.tsx"
Cohesion: 0.22
Nodes (21): DashboardTabId, GovernmentDashboard(), HeatPredictionTab(), HeatPredictionTabProps, approveIncidentReport(), deleteMapAlertManual(), fetchActiveMapAlerts(), fetchAllReports() (+13 more)

### Community 15 - "Dishub Surabaya CCTV Registry"
Cohesion: 0.12
Nodes (9): build_stream_url(), fetch_cctv_list(), get_nearby_cctvs(), load_to_postgis(), _classify_stop(), fetch_osm_transit_stops(), load_all(), load_from_seed_sql() (+1 more)

### Community 16 - "OpenStreetMap Overpass Fetcher"
Cohesion: 0.13
Nodes (10): _build_overpass_query(), fetch_buildings(), fetch_footways(), extract_props(), fetch_trees(), _overpass_to_geojson_points(), _overpass_to_geojson_polygons(), _overpass_to_geojson_ways() (+2 more)

### Community 17 - "run_pipeline.py"
Cohesion: 0.07
Nodes (23): fetch_all(), _approx_linestring_length_m(), ensure_spatial_context(), _get_connection(), get_osm_population_stats(), is_osm_already_populated(), load_all(), load_buildings() (+15 more)

### Community 18 - "Database Pool & Analytics Routes"
Cohesion: 0.18
Nodes (11): ttl_cache_get(), ttl_cache_set(), get_active_alerts(), get_heat_prediction(), get_priority_corridors(), get_tcs_simulations(), get_temperature_heatmap(), get_uhi_hotspots() (+3 more)

### Community 19 - "Incident Reporting & Moderation API"
Cohesion: 0.09
Nodes (12): get_conn(), delete_alert_manual(), get_active_alerts(), get_alert_validation_stats(), validate_alert(), approve_report(), get_all_reports(), get_pending_reports() (+4 more)

### Community 20 - "FastAPI Pydantic Schemas"
Cohesion: 0.16
Nodes (20): AlertValidationCreate, ApproveReportRequest, Coordinate, HeatBudgetInfo, IncidentReportCreate, IncidentReportResponse, MapAlertResponse, PriorityCorridor (+12 more)

### Community 21 - "TypeScript Compiler Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 22 - "test_core_outputs.py"
Cohesion: 0.16
Nodes (10): api(), db(), route(), scalar(), test_comfortable_route_is_cooler_at_the_hottest_hour(), test_departure_hour_changes_the_answer(), test_heat_prediction_matches_the_stored_forecast(), test_route_detours_around_a_reported_closure() (+2 more)

### Community 23 - "Incident Alert Detail Popover"
Cohesion: 0.16
Nodes (20): RFC-4122, AlertDetailContent(), AlertDetailPopover(), AlertDetailPopoverProps, CATEGORY_LABELS, PostJourneyFeedbackModal(), PostJourneyFeedbackModalProps, StarRatingRow() (+12 more)

### Community 24 - "🎓 PENCERDASAN DEMO Teduh"
Cohesion: 0.09
Nodes (22): 1. Konsep & Latar Belakang Masalah, 1. Shade Score (Naungan - Bobot 35%), 2. Struktur Tech Stack & Alur Data Lakehouse (Medallion), 2. Temperature Score (Suhu Terasa & Permukaan - Bobot 30%), 3. AQI Score (Kualitas Udara - Bobot 15%), 3. Landasan Ilmiah & Rumus Matematika Proyek, 4. Logika Routing (pgRouting) & Personal Heat Budget, 4. Traffic Score (Kepadatan Lalu Lintas - Bobot 10%) (+14 more)

### Community 25 - "summarize_route_rows"
Cohesion: 0.22
Nodes (10): _append_coordinates(), _sample_evenly(), summarize_route_rows(), _row(), test_heat_budget_verdict_uses_exposure(), test_no_sun_exposure_at_night(), test_route_averages_are_weighted_by_length(), test_route_with_no_real_scores_has_no_summary() (+2 more)

### Community 26 - "_is_surabaya_relevant"
Cohesion: 0.20
Nodes (7): parse_published_utc(), _is_surabaya_relevant(), test_alert_relevance_needs_more_than_the_province(), test_fast_refresh_case_matches_normalization(), test_published_date_is_converted_to_utc(), test_shade_sql_and_python_agree(), test_unparsable_published_date_is_rejected()

### Community 27 - "Thermal Comfort Score (TCS) Equation"
Cohesion: 0.05
Nodes (41): Asyncpg PostgreSQL Connection Pool Driver, FastAPI Backend Framework, Mangum Serverless ASGI Lambda Adapter, Pydantic Schema Validation, Uvicorn ASGI Web Server, AWS Lambda FastAPI Deployment (SAM), Teduh Free-Tier Deployment Architecture, Supabase Hosted PostGIS Database (+33 more)

### Community 28 - "_fetch_live_environmental_inputs"
Cohesion: 0.19
Nodes (11): _fetch_live_environmental_inputs(), LiveInputs, _parse_weather(), _resolve_input(), _patch_sources(), _raise(), test_falls_back_to_last_real_reading(), test_live_readings_are_preferred() (+3 more)

### Community 29 - "index.ts"
Cohesion: 0.20
Nodes (12): GovernmentDashboardProps, CATEGORIES, IncidentReportModalProps, SEVERITIES, MapViewHandle, NavigationOverlayProps, submitManualReport(), Coordinate (+4 more)

### Community 30 - "PostgreSQL Container Configuration"
Cohesion: 0.15
Nodes (13): POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, command, container_name, cpus, environment, mem_limit (+5 more)

### Community 31 - "geoMath.ts"
Cohesion: 0.33
Nodes (8): formatMeters(), RoutePanel(), computeBearingDegrees(), formatDataAsOf(), SURABAYA_BOUNDS, toDeg(), toRad(), UNSCORED_SEGMENT_COLOR

### Community 32 - "Environment Variable Configuration"
Cohesion: 0.21
Nodes (12): environment, ASYNC_DATABASE_URL, DATABASE_URL, HDFS_NAMENODE, PYSPARK_PYTHON, RAW_DATA_DIR, SPARK_DRIVER_MEMORY, SPARK_LOCAL_DIRS (+4 more)

### Community 33 - "fast_refresh.py"
Cohesion: 0.16
Nodes (8): Good to know, _case_sql(), run_fast_refresh(), _shade_sql(), _surabaya_solar_elevation_deg(), _tan_elevation(), store_hourly_forecast(), shade_ratio_sql()

### Community 34 - "HDFS Datanode Container Service"
Cohesion: 0.20
Nodes (10): container_name, cpus, env_file, environment, image, mem_limit, ports, profiles (+2 more)

### Community 35 - "HDFS Namenode Container Service"
Cohesion: 0.20
Nodes (10): container_name, cpus, env_file, environment, image, mem_limit, ports, profiles (+2 more)

### Community 36 - "datetime"
Cohesion: 0.09
Nodes (7): compute_raster_proxies(), run(), load_dataset(), train_and_simulate(), get_or_create_spark(), _register_sedona(), lookup_expr()

### Community 37 - "LiveDataUnavailable"
Cohesion: 0.09
Nodes (17): Changing the TCS model, Commands, Data flow, Not used at serving time, Rule: no fabricated data, Teduh, Where to look, LiveDataUnavailable (+9 more)

### Community 38 - "Docker Compose Service Dependencies"
Cohesion: 0.22
Nodes (9): depends_on, condition, depends_on, datanode, namenode, postgres, condition, condition (+1 more)

### Community 39 - "Root Workspace Scripts"
Cohesion: 0.22
Nodes (8): description, name, scripts, dev, docker:down, docker:up, frontend, version

### Community 40 - "Docker Healthcheck Specifications"
Cohesion: 0.50
Nodes (8): healthcheck, interval, retries, start_period, test, timeout, healthcheck, healthcheck

### Community 41 - "Sedona & Solar Shadow Pipeline"
Cohesion: 0.40
Nodes (5): GeoPandas 0.14.4 Geospatial DataFrames, Apache Sedona 1.6.0 Spatial SQL & RDD, Psycopg2-binary 2.9.9 PostgreSQL JDBC Driver, PySpark 3.5.1 Lakehouse Compute Engine, Shapely 2.0.4 Planar Geometry

### Community 42 - "Docker Compose Volume Storage"
Cohesion: 0.29
Nodes (6): services, volumes, hadoop_datanode, hadoop_namenode, pgdata, spark_data

### Community 43 - "FastAPI Container Resource Limits"
Cohesion: 0.29
Nodes (7): container_name, cpus, mem_limit, ports, restart, volumes, api

### Community 44 - "Spark Pipeline Container Profile"
Cohesion: 0.29
Nodes (7): spark-pipeline, command, container_name, cpus, mem_limit, profiles, volumes

### Community 45 - "conditions.py"
Cohesion: 0.19
Nodes (13): apparent_at_hour_sql(), build_hourly_trend(), _clamp(), HourConditions, is_daylight(), _only_if_scored(), shade_at_hour_sql(), shade_slot() (+5 more)

### Community 46 - "dependencies"
Cohesion: 0.18
Nodes (11): dependencies, hls.js@^1.6.16, lucide-react@^0.511.0, react@19.2.4, react-dom@19.2.4, recharts@^3.9.0, suncalc@^1.9.0, hls.js (+3 more)

### Community 47 - "normalize_shade"
Cohesion: 0.25
Nodes (4): normalize_shade(), test_normalize_shade_bounds(), test_normalize_shade_full(), test_normalize_shade_none()

### Community 48 - "Docker Multi-Stage Build Configurations"
Cohesion: 0.60
Nodes (5): build, context, dockerfile, build, build

### Community 49 - "Supabase Database Synchronization"
Cohesion: 0.60
Nodes (4): local_psql(), MSYS_NO_PATHCONV, remote_psql(), sync_to_supabase.sh script

### Community 50 - "normalize_temperature"
Cohesion: 0.25
Nodes (4): normalize_temperature(), test_normalize_temperature_comfortable(), test_normalize_temperature_extreme(), test_normalize_temperature_typical_surabaya()

### Community 51 - "normalize_aqi"
Cohesion: 0.29
Nodes (4): normalize_aqi(), test_served_score_is_the_published_formula(), test_normalize_aqi_good(), test_normalize_aqi_unhealthy()

### Community 52 - "TEDUH Brand Identity & Assets"
Cohesion: 0.83
Nodes (4): TEDUH Brand Logo, TEDUH Thermal Comfort Navigation Identity, Circular HUD Avatar Design Specification, HUD Navbar Brand Identity Element

### Community 53 - "layout.tsx"
Cohesion: 0.33
Nodes (3): jakartaSans, jetbrainsMono, metadata

### Community 54 - "Mobile Deployment & QR Gateway"
Cohesion: 1.00
Nodes (3): TEDUH Live Web Application Deployment, Mobile Access via Quick Response Code, TEDUH QR Code Asset

### Community 55 - "HTTP Client & Scheduling Libraries"
Cohesion: 0.67
Nodes (3): APScheduler 3.10.4 Task Scheduling, HTTPX 0.27.0 Async HTTP Ingestion, Requests 2.32.3 REST Ingestion Client

### Community 56 - "test_data_integrity.py"
Cohesion: 0.09
Nodes (16): require_admin(), _with_alert_costs(), test_admin_routes_accept_the_right_token(), test_admin_routes_are_disabled_without_a_token(), test_admin_routes_reject_a_wrong_token(), test_closure_outweighs_other_incidents_on_the_same_edge_cost(), test_departure_hour_uses_wib(), test_failed_route_is_not_within_budget() (+8 more)

### Community 59 - "cctv.py"
Cohesion: 0.24
Nodes (3): CCTVCamera, get_cctv_info(), get_nearby_cctvs()

### Community 62 - "validate_shade_geometry.py"
Cohesion: 0.27
Nodes (7): What each metric is, shade_ratio(), test_shade_does_not_saturate_with_a_high_sun(), error(), main(), measure(), previous_formula()

### Community 64 - "eslint.config.mjs"
Cohesion: 0.33
Nodes (5): eslintConfig, eslint@^9, eslint-config-next@16.2.9, eslint, eslint-config-next

### Community 65 - "run"
Cohesion: 0.53
Nodes (3): compute_edge_weights(), _load_latest_tcs(), run()

### Community 66 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, lint, start, start:prod

### Community 72 - "normalize_traffic"
Cohesion: 0.33
Nodes (3): normalize_traffic(), test_normalize_traffic_free_flow(), test_normalize_traffic_gridlock()

### Community 73 - "next.config.ts"
Cohesion: 0.29
Nodes (4): currentDir, nextConfig, next@16.2.9, next

### Community 75 - "_parse_traffic"
Cohesion: 0.40
Nodes (4): _parse_traffic(), test_free_flow_traffic_is_kept_as_zero(), test_speed_above_free_flow_counts_as_no_congestion(), test_traffic_without_a_measurement_is_dropped()

### Community 76 - "parse_hourly_forecast"
Cohesion: 0.40
Nodes (3): parse_hourly_forecast(), test_hourly_forecast_handles_missing_block(), test_hourly_forecast_is_parsed_from_open_meteo()

## Knowledge Gaps
- **33 isolated node(s):** `MSYS_NO_PATHCONV`, `RFC-4122`, `Asyncpg PostgreSQL Connection Pool Driver`, `Pydantic Schema Validation`, `Uvicorn ASGI Web Server` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 536 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `get_conn()` connect `Incident Reporting & Moderation API` to `navigation.py`, `Database Pool & Analytics Routes`, `cctv.py`, `Asyncpg Database Pool & Caching`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `MSYS_NO_PATHCONV`, `RFC-4122`, `Asyncpg PostgreSQL Connection Pool Driver` to the rest of the system?**
  _33 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `math` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._
- **Why does `get_or_create_spark()` connect `datetime` to `run`, `run_pipeline.py`, `run`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Should `solar_position.py` be split into smaller, more focused modules?**
  _Cohesion score 0.11822660098522167 - nodes in this community are weakly interconnected._
- **Why does `fetch_footways()` connect `OpenStreetMap Overpass Fetcher` to `run_pipeline.py`, `os`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Should `incident-alert-system.md` be split into smaller, more focused modules?**
  _Cohesion score 0.046511627906976744 - nodes in this community are weakly interconnected._