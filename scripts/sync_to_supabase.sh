#!/usr/bin/env bash
# ============================================================
# Teduh: copy the serving tables from the local PostGIS
# (docker compose "postgres" service) to Supabase.
#
# Only the tables the API reads are copied, and thermal_comfort_scores
# is reduced to the latest row per segment, so the snapshot fits in the
# Supabase free tier (500 MB). pipeline-only tables (buildings, trees,
# segment_shadows, edge_weights) stay local.
#
# Usage (Git Bash / Linux / macOS):
#   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
#   ./scripts/sync_to_supabase.sh
#
# Use the Supabase *session* pooler URL (port 5432) for this script, not the
# transaction pooler (6543) that the API uses. Re-running is safe: target
# tables are dropped and recreated from the local schema.
#
# All Postgres client tools run inside the local DB container, so nothing
# needs to be installed on the host besides Docker.
# ============================================================
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-teduh_db}"
LOCAL_DB="${LOCAL_DB:-commute_cool}"
LOCAL_USER="${LOCAL_USER:-cc_user}"
MAX_MB="${MAX_MB:-450}"

# Full copies (schema + data) of everything the API reads.
FULL_TABLES=(
  segments
  segments_noded
  segments_noded_vertices_pgr
  segment_raster_scores
  thermal_comfort_scores # schema only here; latest rows copied separately below
  tcs_simulations
  transit_stops
  cctv_cameras
  weather_alerts
  incident_reports
  map_alerts
  alert_validations
  user_feedback
  segment_live_comfort
  segment_spatial_context
)

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: set SUPABASE_DB_URL (Supabase session pooler URL, port 5432)." >&2
  exit 1
fi

# MSYS (Git Bash) rewrites args that look like paths; disable that for docker exec.
export MSYS_NO_PATHCONV=1

local_psql() { docker exec -i "$DB_CONTAINER" psql -U "$LOCAL_USER" -d "$LOCAL_DB" -v ON_ERROR_STOP=1 "$@"; }
remote_psql() { docker exec -i "$DB_CONTAINER" psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"; }

echo "==> Checking local database ($DB_CONTAINER)"
if ! docker exec "$DB_CONTAINER" pg_isready -U "$LOCAL_USER" -d "$LOCAL_DB" >/dev/null; then
  echo "ERROR: local DB container '$DB_CONTAINER' is not running. Run: docker compose up -d postgres" >&2
  exit 1
fi

TABLE_LIST=$(printf "'%s'," "${FULL_TABLES[@]}"); TABLE_LIST="${TABLE_LIST%,}"
MISSING=$(local_psql -tAc "SELECT string_agg(t, ', ') FROM unnest(ARRAY[$TABLE_LIST]) t WHERE to_regclass('public.' || t) IS NULL")
if [[ -n "$MISSING" ]]; then
  echo "ERROR: missing local tables: $MISSING. Run the pipeline first (docker compose up spark-pipeline)." >&2
  exit 1
fi

echo "==> Estimated snapshot size"
local_psql -c "
  WITH t AS (
    SELECT name,
           CASE WHEN name = 'thermal_comfort_scores'
                -- only the latest row per segment is copied
                THEN pg_total_relation_size(name::regclass)
                     * (SELECT count(DISTINCT segment_id)::float / GREATEST(count(*), 1) FROM thermal_comfort_scores)
                ELSE pg_total_relation_size(name::regclass) END AS bytes
    FROM unnest(ARRAY[$TABLE_LIST]) AS name
  )
  SELECT name AS table, pg_size_pretty(bytes::bigint) AS size FROM t
  UNION ALL SELECT 'TOTAL', pg_size_pretty(sum(bytes)::bigint) FROM t;"

TOTAL_MB=$(local_psql -tAc "
  SELECT ceil((
    SELECT sum(pg_total_relation_size(n::regclass)) FROM unnest(ARRAY[$TABLE_LIST]) n WHERE n <> 'thermal_comfort_scores'
  ) / 1048576.0
  + pg_total_relation_size('thermal_comfort_scores') / 1048576.0
    * (SELECT count(DISTINCT segment_id)::float / GREATEST(count(*), 1) FROM thermal_comfort_scores))::int")
if (( TOTAL_MB > MAX_MB )); then
  echo "ERROR: snapshot ~${TOTAL_MB} MB exceeds MAX_MB=${MAX_MB} (Supabase free tier is 500 MB)." >&2
  exit 1
fi

echo "==> Preparing Supabase (extensions)"
remote_psql -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgrouting WITH SCHEMA public;
DO $$
BEGIN
  IF (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname = 'postgis') <> 'public' THEN
    RAISE EXCEPTION 'postgis is installed outside the public schema. Disable it in the Supabase dashboard and re-run this script.';
  END IF;
END $$;
SQL

echo "==> Copying tables (schema + data)"
DUMP_ARGS=(--no-owner --no-privileges --no-comments --clean --if-exists --exclude-table-data=thermal_comfort_scores)
for t in "${FULL_TABLES[@]}"; do DUMP_ARGS+=(-t "public.$t"); done
docker exec "$DB_CONTAINER" pg_dump -U "$LOCAL_USER" -d "$LOCAL_DB" "${DUMP_ARGS[@]}" | remote_psql -q -o /dev/null

echo "==> Copying latest thermal_comfort_scores per segment"
local_psql -c "\copy (SELECT DISTINCT ON (segment_id) * FROM thermal_comfort_scores ORDER BY segment_id, computed_at DESC) TO STDOUT" \
  | remote_psql -c "\copy thermal_comfort_scores FROM STDIN"

echo "==> ANALYZE + row counts"
remote_psql -q -c "ANALYZE $(IFS=,; echo "${FULL_TABLES[*]}");"
COUNT_SQL=$(for t in "${FULL_TABLES[@]}"; do printf "SELECT '%s' AS table, count(*) FROM %s UNION ALL " "$t" "$t"; done)
COUNT_SQL="${COUNT_SQL% UNION ALL }"
remote_psql -c "$COUNT_SQL;"
remote_psql -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS supabase_db_size;"

echo "==> Done."
