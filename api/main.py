"""Teduh FastAPI Application Entry Point."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.db import get_pool, close_pool, get_conn
from api.routes.navigation import router as navigation_router
from api.routes.dashboard import router as dashboard_router
from api.routes.cctv import router as cctv_router
from api.routes.reports import router as reports_router
from api.routes.alerts import router as alerts_router


async def _ensure_serving_layer_ready() -> None:
    """Ensure `incident_reports` and `segment_live_comfort` tables exist & are backfilled on startup."""
    try:
        async with get_conn() as conn:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            has_reports = await conn.fetchval(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'incident_reports')"
            )
            if not has_reports:
                migrate_path = os.path.join(base_dir, "database", "migrate_teduh.sql")
                if os.path.exists(migrate_path):
                    with open(migrate_path, "r", encoding="utf-8") as f:
                        await conn.execute(f.read())

            has_table = await conn.fetchval(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'segment_live_comfort')"
            )
            if not has_table:
                sql_path = os.path.join(base_dir, "database", "optimize_serving.sql")
                if os.path.exists(sql_path):
                    with open(sql_path, "r", encoding="utf-8") as f:
                        await conn.execute(f.read())

            seg_cnt = await conn.fetchval("SELECT COUNT(*) FROM segments")
            live_cnt = await conn.fetchval("SELECT COUNT(*) FROM segment_live_comfort")
            if (seg_cnt or 0) > 0 and (live_cnt or 0) == 0:
                await conn.execute("SELECT sync_segment_live_comfort()")
    except Exception as exc:
        print(f"[Startup] Serving layer check warning: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage connection pool lifecycle & serving layer warm-up."""
    await get_pool()
    await _ensure_serving_layer_ready()
    yield
    await close_pool()


app = FastAPI(
    title="Teduh API",
    description="High-efficiency thermal-comfort pedestrian navigation for Surabaya Smart City",
    version="0.3.0",
    lifespan=lifespan,
)

# CORS middleware for frontend access.
# CORS_ORIGINS: comma-separated list of allowed origins (default "*" for local dev).
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(navigation_router, prefix="/api", tags=["Navigation"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(cctv_router, prefix="/api", tags=["CCTV"])
app.include_router(reports_router, prefix="/api/v1", tags=["Reports"])
app.include_router(alerts_router, prefix="/api/v1", tags=["Alerts"])


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "teduh-api", "mode": "lightweight-serving"}


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "Teduh API",
        "version": "0.3.0",
        "docs": "/docs",
        "description": "Thermal comfort pedestrian navigation - Surabaya",
    }
