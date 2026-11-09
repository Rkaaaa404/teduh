"""HDFS WebHDFS Client - Write ingestion data directly to HDFS Bronze layer.

Skips gracefully with zero timeout delay when HDFS_NAMENODE is unset
(e.g., in Lightweight Daily Mode without the `pipeline` Docker profile).
"""
from __future__ import annotations

import os
import requests


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
        response = requests.put(webhdfs_url, allow_redirects=False, timeout=(2.5, 8.0))
        if response.status_code == 307:
            datanode_url = response.headers.get("Location")
            if not datanode_url:
                return False
            headers = {"Content-Type": "application/octet-stream"}
            r_upload = requests.put(
                datanode_url,
                data=data_str.encode("utf-8"),
                headers=headers,
                timeout=(3.0, 15.0),
            )
            if r_upload.status_code == 201:
                print(f"  [HDFS] ✓ Uploaded to HDFS: {hdfs_path}")
                return True
            print(f"  [HDFS] ✗ Datanode write failed: {r_upload.status_code}")
            return False

        print(f"  [HDFS] ✗ Namenode handshake failed: {response.status_code}")
        return False
    except Exception as e:
        print(f"  [HDFS] Skipped WebHDFS ({e.__class__.__name__})")
        return False
