# Deployment (free tier)

```
 Browser ──HTTPS──► Vercel (Next.js, frontend/)
    │                  └─ /cctv-hls/* rewrite ──► Dishub HLS (http)
    └──HTTPS──► AWS Lambda Function URL (FastAPI via Mangum, api/)
                       └──► Supabase Postgres (PostGIS + pgRouting)
                                 ▲
  Local docker compose (Spark + HDFS pipeline) ── scripts/sync_to_supabase.sh
```

| Layer | Service | Free allowance | Notes |
|---|---|---|---|
| Frontend | Vercel Hobby | 100 GB bandwidth/mo | Root directory `frontend` |
| API | AWS Lambda + Function URL (SAM) | 1M requests + 400k GB-s/mo (always free) | `ap-southeast-1`, 512 MB, ~1–2 s cold start |
| DB | Supabase Free | 500 MB DB | Pauses after 7 days without activity; resume from the dashboard |
| Pipeline | Local Docker Compose | n/a | Spark/HDFS need far more resources than any free tier gives |

The production DB is a **snapshot**: run the pipeline locally, then copy the serving tables to Supabase.

---

## One-time setup

### 0. Prerequisites
- Docker Desktop (running)
- AWS CLI v2, configured. **Use an IAM user or SSO profile, not root-account access keys.**
- AWS SAM CLI: `winget install Amazon.SAM-CLI` (Windows) / `brew install aws-sam-cli` (macOS)
- A GitHub repo connected to Vercel

### 1. Supabase project
1. Create a project at https://supabase.com/dashboard, region **Southeast Asia (Singapore)**. Save the DB password.
2. **Don't** enable PostGIS from the dashboard (it would install into the `extensions` schema). The sync script installs it into `public`.
3. Open **Connect** in the dashboard and copy two URLs:
   - **Session pooler** (port `5432`): used by the sync script → `SUPABASE_DB_URL`
   - **Transaction pooler** (port `6543`): used by the Lambda → `DatabaseUrl`

### 2. Populate the local DB (skip if `pgdata` already has data)
```bash
cp .env.example .env            # optionally add TOMTOM_API_KEY / WAQI_API_TOKEN
docker compose up -d --build    # first run: ~10–15 min for the spark-pipeline container
docker logs -f teduh_spark   # wait for "Pipeline complete" / exited (0)
```

### 3. Snapshot → Supabase
```bash
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
./scripts/sync_to_supabase.sh
```
The script prints the size estimate, aborts if it's over 450 MB (`MAX_MB` to override), copies:
`segments`, `segments_noded`, `segments_noded_vertices_pgr`, `segment_raster_scores`, `tcs_simulations`, `transit_stops`, `cctv_cameras`, `weather_alerts`, `weather_hourly_forecast`, `segment_live_comfort`, `segment_spatial_context`, and the **latest** `thermal_comfort_scores` row per segment. It then prints row counts. Re-running it is safe: user-generated tables (`incident_reports`, `map_alerts`, `alert_validations`, `user_feedback`) are created if missing and their production rows are never replaced.

### 4. API → AWS Lambda
```bash
sam build                       # builds in a Linux container (use_container = true in samconfig.toml)
sam deploy --parameter-overrides \
  DatabaseUrl='postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres' \
  CorsOrigins='*' \
  AdminToken='<random-string>'
```
The `ApiUrl` output is the public API base, e.g. `https://abc123.lambda-url.ap-southeast-1.on.aws/`.

Smoke test:
```bash
curl "$API_URL/health"
curl -X POST "$API_URL/api/route" -H "Content-Type: application/json" \
  -d '{"origin":{"lat":-7.27,"lng":112.75},"destination":{"lat":-7.26,"lng":112.74}}'
curl -H "X-Admin-Token: <random-string>" "$API_URL/api/debug/topology-status"
```

### 5. Frontend → Vercel
1. Vercel → **Add New Project** → import the repo → **Root Directory: `frontend`** (framework auto-detected as Next.js).
2. Environment variable: `NEXT_PUBLIC_API_URL` = `<ApiUrl>api` (e.g. `https://abc123.lambda-url.ap-southeast-1.on.aws/api`).
3. Deploy, and note the domain (e.g. `https://teduh-app.vercel.app`).

Production-build check: `npm run build --prefix frontend`.
Plus Jakarta Sans (400–800) and JetBrains Mono (500–700) are bundled as Latin variable WOFF2 fonts in `frontend/app/fonts/`, with their SIL Open Font Licenses. `next/font/local` serves them without fetching Google Fonts during builds, avoiding the Next.js Google-font URL parsing failure (`next/font/google queries have exactly one entry`). Preserve the font files and licenses when deploying.
`outputFileTracingRoot` and `turbopack.root` both point to the repository root in `frontend/next.config.ts`, matching Vercel's monorepo build root.

### 6. Lock CORS to the Vercel domain
```bash
sam deploy --parameter-overrides \
  DatabaseUrl='...6543/postgres' \
  CorsOrigins='https://teduh-app.vercel.app,http://localhost:3000' \
  AdminToken='<random-string>'
```

---

## Day-2 operations

| Task | Command |
|---|---|
| Refresh data | `docker compose up spark-pipeline` (or `docker compose run --rm spark-pipeline -m spark_jobs.run_pipeline --skip-ingest`), then `./scripts/sync_to_supabase.sh` |
| Upgrade to a release with schema changes | Run `./scripts/sync_to_supabase.sh` first, then redeploy the API (the new API queries the new columns) |
| Redeploy API after code changes | `sam build && sam deploy --parameter-overrides ...` (same values as before) |
| Redeploy frontend | `git push` (Vercel auto-deploys) |
| API logs | `sam logs --stack-name teduh-api --tail` |
| Tear down API | `sam delete --stack-name teduh-api` |

## Environment variables (API)

| Var | Local default | Lambda value | Purpose |
|---|---|---|---|
| `DATABASE_URL` / `ASYNC_DATABASE_URL` | local compose DB | Supabase transaction pooler | Postgres connection |
| `CORS_ORIGINS` | `*` | Vercel domain(s) | Comma-separated allowed origins |
| `ADMIN_TOKEN` | empty (disabled) | random string | Enables `/api/debug/*`, `/api/admin/*` via `X-Admin-Token` |
| `DB_POOL_MIN` / `DB_POOL_MAX` | `2` / `10` | `0` / `3` | asyncpg pool size |
| `DB_STATEMENT_CACHE_SIZE` | `100` | `0` | Must be `0` behind the Supabase transaction pooler |

## Known limitations / troubleshooting
- **Production data is a snapshot.** Supabase holds whatever the last sync copied; nothing refreshes it automatically. The dashboard and route panel show the snapshot time ("Data per ...").
- **Moderation endpoints are open.** Approving or rejecting reports and deleting map alerts (`/api/v1/report/*`, `DELETE /api/v1/alerts/*`) have no authentication, and the officer ID is generated in the browser. This is accepted for the demo; anyone with the API URL can use them. Add real auth before public launch.
- **`POST /api/admin/fast-refresh` returns 501 on Lambda**: the bundle contains only `api/`. Refresh locally and re-sync.
- **First request is slow** (~1–2 s Lambda cold start and the DB connection). Later requests are fast.
- **Supabase paused** after 7 days without activity: resume it from the dashboard. Data is kept.
- **CCTV**: Dishub streams are HTTP-only, so they're proxied through Vercel (`/cctv-hls/*` in `frontend/next.config.ts`). If Dishub blocks Vercel's IPs, the video won't load; the rest of the app is unaffected.
- **`POST /api/admin/rebuild-topology` isn't supported on Supabase**: the snapshot doesn't include the `build_routing_topology()` function or the pipeline tables. Rebuild locally and re-sync instead.
- **Function URL returns 403 `Forbidden`**: check that the function's resource policy allows `lambda:InvokeFunctionUrl` (and, on newer accounts, `lambda:InvokeFunction`) for principal `*`. SAM normally adds this for `AuthType: NONE`.
