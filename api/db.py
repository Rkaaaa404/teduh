"""Database connection pool & lightweight TTL cache for Teduh API.

Uses asyncpg directly (zero ORM overhead) with laptop-friendly pool sizing.
"""
from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from typing import Any

import asyncpg

DATABASE_URL = os.getenv(
    "ASYNC_DATABASE_URL",
    os.getenv("DATABASE_URL", "postgresql://cc_user:cc_dev_pass@localhost:5432/commute_cool"),
)

_asyncpg_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
# Pool tuning (env-overridable). On AWS Lambda + Supabase transaction pooler use:
#   DB_POOL_MIN=0, DB_POOL_MAX=3, DB_STATEMENT_CACHE_SIZE=0
DB_POOL_MIN = int(os.getenv("DB_POOL_MIN", "1"))
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "8"))
DB_STATEMENT_CACHE_SIZE = int(os.getenv("DB_STATEMENT_CACHE_SIZE", "100"))
_pool: asyncpg.Pool | None = None

# `severity` is free text, so sorting it directly would put "extreme" below "minor".
ALERT_SEVERITIES_MOST_FIRST = ("extreme", "severe", "moderate", "minor")
ALERT_SEVERITY_RANK_SQL = (
    "CASE LOWER(severity) "
    + " ".join(
        f"WHEN '{name}' THEN {position}"
        for position, name in enumerate(ALERT_SEVERITIES_MOST_FIRST)
    )
    + f" ELSE {len(ALERT_SEVERITIES_MOST_FIRST)} END"
)

# Lightweight in-memory TTL cache for city-wide analytics endpoints
_ttl_store: dict[str, tuple[float, Any]] = {}


def ttl_cache_get(key: str) -> Any | None:
    entry = _ttl_store.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() > expires_at:
        _ttl_store.pop(key, None)
        return None
    return value


def ttl_cache_set(key: str, value: Any, ttl_sec: float = 60.0) -> None:
    _ttl_store[key] = (time.monotonic() + ttl_sec, value)


def ttl_cache_clear() -> None:
    _ttl_store.clear()


async def get_pool() -> asyncpg.Pool:
    """Get or create asyncpg connection pool."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            _asyncpg_url,
            min_size=DB_POOL_MIN,
            max_size=DB_POOL_MAX,
            command_timeout=30,
            statement_cache_size=DB_STATEMENT_CACHE_SIZE,
            max_inactive_connection_lifetime=120.0,
        )
    return _pool


async def close_pool():
    """Close connection pool on shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def get_conn():
    """Acquire a pooled connection."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn
