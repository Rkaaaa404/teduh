"""Database connection pool & lightweight TTL cache for COMMUTE-COOL API.

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
_pool: asyncpg.Pool | None = None

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
            min_size=1,
            max_size=8,
            max_inactive_connection_lifetime=120.0,
            command_timeout=30,
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
