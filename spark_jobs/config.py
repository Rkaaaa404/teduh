"""Shared configuration for all Spark jobs.

Reads DATABASE_URL from environment and constructs high-throughput JDBC connection params
(`reWriteBatchedInserts=true`, `batchsize=5000`, `fetchsize=5000`).
"""

import os

# Parse DATABASE_URL (format: postgresql://user:pass@host:port/dbname)
_db_url = os.getenv("DATABASE_URL", "postgresql://cc_user:cc_dev_pass@localhost:5432/commute_cool")

_parts = _db_url.replace("postgresql://", "").split("@")
_user_pass = _parts[0].split(":")
_host_db = _parts[1].split("/")
_host_port = _host_db[0].split(":")

DB_USER = _user_pass[0]
DB_PASS = _user_pass[1] if len(_user_pass) > 1 else ""
DB_HOST = _host_port[0]
DB_PORT = _host_port[1] if len(_host_port) > 1 else "5432"
DB_NAME = _host_db[1] if len(_host_db) > 1 else "commute_cool"

JDBC_URL = f"jdbc:postgresql://{DB_HOST}:{DB_PORT}/{DB_NAME}?reWriteBatchedInserts=true"
JDBC_PROPS = {
    "user": DB_USER,
    "password": DB_PASS,
    "driver": "org.postgresql.Driver",
    "batchsize": "5000",
    "fetchsize": "5000",
}

RAW_DATA_DIR = os.getenv("RAW_DATA_DIR", "./data/raw")

# --- HDFS Medallion Directory Paths ---
HDFS_PREFIX = os.getenv("HDFS_NAMENODE", "").strip()
HDFS_ENABLED = bool(HDFS_PREFIX)
BRONZE_DIR = f"{HDFS_PREFIX}/lakehouse/bronze" if HDFS_ENABLED else f"{RAW_DATA_DIR}/lakehouse/bronze"
SILVER_DIR = f"{HDFS_PREFIX}/lakehouse/silver" if HDFS_ENABLED else f"{RAW_DATA_DIR}/lakehouse/silver"
GOLD_DIR = f"{HDFS_PREFIX}/lakehouse/gold" if HDFS_ENABLED else f"{RAW_DATA_DIR}/lakehouse/gold"
