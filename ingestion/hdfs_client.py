"""HDFS WebHDFS Client - Write ingestion data directly to HDFS Bronze layer.

Skips gracefully with zero timeout delay when HDFS_NAMENODE is unset
(e.g., in Lightweight Daily Mode without the `pipeline` Docker profile).
"""
from __future__ import annotations

import os
import time

import requests

WRITE_ATTEMPTS = 20
RETRY_WAIT_S = 3.0  # after a restart the namenode refuses writes with a 403 until it leaves safe mode


def write_to_hdfs(hdfs_path: str, data_str: str) -> bool:
    """Write string content directly to HDFS via WebHDFS if HDFS is configured."""
    hdfs_namenode = os.getenv("HDFS_NAMENODE", "").strip()
    if not hdfs_namenode:
        return False

    namenode_host = hdfs_namenode.replace("hdfs://", "").split(":")[0]
    webhdfs_url = (
        f"http://{namenode_host}:9870/webhdfs/v1{hdfs_path}"
        "?op=CREATE&overwrite=true&user.name=root"
    )

    try:
        for attempt in range(1, WRITE_ATTEMPTS + 1):
            response = requests.put(webhdfs_url, allow_redirects=False, timeout=(2.5, 8.0))
            if response.status_code != 307:
                print(f"  [HDFS] ✗ Namenode handshake failed: {response.status_code}")
                return False
            datanode_url = response.headers.get("Location")
            if not datanode_url:
                return False

            upload = requests.put(
                datanode_url,
                data=data_str.encode("utf-8"),
                headers={"Content-Type": "application/octet-stream"},
                timeout=(3.0, 15.0),
            )
            if upload.status_code == 201:
                print(f"  [HDFS] ✓ Uploaded to HDFS: {hdfs_path}")
                return True
            if upload.status_code != 403 or attempt == WRITE_ATTEMPTS:
                print(f"  [HDFS] ✗ Datanode write failed: {upload.status_code} {upload.text[:200]}")
                return False
            time.sleep(RETRY_WAIT_S)
        return False
    except Exception as e:
        print(f"  [HDFS] Skipped WebHDFS ({e.__class__.__name__})")
        return False
