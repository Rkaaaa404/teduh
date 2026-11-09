"""Map alerts API routes — active alerts display, user validation, and gov deletion."""

from datetime import datetime, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from api.db import get_conn
from api.models.schemas import MapAlertResponse, AlertValidationCreate

router = APIRouter()

@router.get("/alerts/active", response_model=List[MapAlertResponse])
async def get_active_alerts():
    """Retrieve all active incident alerts to render as icons on the map."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM map_alerts 
            WHERE status = 'ACTIVE'
            ORDER BY created_at DESC
            """
        )
        results = []
        for r in rows:
            item = dict(r)
            item["id"] = str(item["id"])
            if item["report_id"]:
                item["report_id"] = str(item["report_id"])
            results.append(item)
        return results


@router.post("/alerts/{alert_id}/validate")
async def validate_alert(alert_id: str, validation: AlertValidationCreate):
    """Submit a community validation response (still_active / no_longer_active).
    
    If at least 5 responses are received within the last 2 hours, and 70% or more state 
    the incident is no longer active, the alert is automatically retired (AUTO_REMOVED).
    """
    try:
        alert_uuid = UUID(alert_id)
        user_uuid = UUID(validation.user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    if validation.response not in ("still_active", "no_longer_active"):
        raise HTTPException(status_code=400, detail="Response must be 'still_active' or 'no_longer_active'")

    async with get_conn() as conn:
        # Check if alert exists and is active
        alert = await conn.fetchrow("SELECT * FROM map_alerts WHERE id = $1", alert_uuid)
        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")
        if alert["status"] != "ACTIVE":
            raise HTTPException(status_code=400, detail=f"Cannot validate non-active alert (status: {alert['status']})")

        # Insert or update community validation response
        await conn.execute(
            """
            INSERT INTO alert_validations (alert_id, user_id, response, validated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (alert_id, user_id) 
            DO UPDATE SET response = EXCLUDED.response, validated_at = NOW()
            """,
            alert_uuid, user_uuid, validation.response
        )

        # Calculate statistics from validations in the last 2 hours
        stats = await conn.fetchrow(
            """
            SELECT 
                COUNT(*) FILTER (WHERE response = 'no_longer_active') AS no_count,
                COUNT(*) FILTER (WHERE response = 'still_active') AS yes_count,
                COUNT(*) AS total_count
            FROM alert_validations
            WHERE alert_id = $1 AND validated_at > NOW() - INTERVAL '2 hours'
            """,
            alert_uuid
        )

        no_count = stats["no_count"] or 0
        yes_count = stats["yes_count"] or 0
        total_count = stats["total_count"] or 0
        auto_removed = False

        pct_no = no_count / total_count if total_count > 0 else 0.0
        threshold = float(alert["auto_remove_threshold"] or 0.70)

        # Trigger auto-removal: minimum 5 responses, >= threshold (70%) state no_longer_active
        if total_count >= 5 and pct_no >= threshold:
            await conn.execute(
                """
                UPDATE map_alerts
                SET status = 'AUTO_REMOVED',
                    removed_at = NOW(),
                    removed_reason = 'community_validation'
                WHERE id = $1
                """,
                alert_uuid
            )
            auto_removed = True

        return {
            "status": "success",
            "validation_summary": {
                "total_validations_2h": total_count,
                "still_active_count": yes_count,
                "no_longer_active_count": no_count,
                "no_longer_active_pct": pct_no,
                "auto_removed": auto_removed
            }
        }


@router.delete("/alerts/{alert_id}")
async def delete_alert_manual(alert_id: str, deleted_by: str = Query(..., description="UUID of the gov operator deleting this alert")):
    """Gov manual deletion of an active alert."""
    try:
        alert_uuid = UUID(alert_id)
        operator_uuid = UUID(deleted_by)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    async with get_conn() as conn:
        alert = await conn.fetchrow("SELECT * FROM map_alerts WHERE id = $1", alert_uuid)
        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")
        if alert["status"] != "ACTIVE":
            raise HTTPException(status_code=400, detail="Alert is already non-active")

        await conn.execute(
            """
            UPDATE map_alerts
            SET status = 'MANUALLY_REMOVED',
                removed_at = NOW(),
                removed_reason = $1
            WHERE id = $2
            """,
            f"Manually removed by Gov Operator: {operator_uuid}", alert_uuid
        )
        return {"status": "success", "message": "Alert manually retired by Gov"}


@router.get("/alerts/{alert_id}/validations")
async def get_alert_validation_stats(alert_id: str):
    """Retrieve community validation stats for a single alert to show on the map popup."""
    try:
        alert_uuid = UUID(alert_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    async with get_conn() as conn:
        stats = await conn.fetchrow(
            """
            SELECT 
                COUNT(*) FILTER (WHERE response = 'still_active') AS yes_count,
                COUNT(*) FILTER (WHERE response = 'no_longer_active') AS no_count,
                COUNT(*) AS total_count
            FROM alert_validations
            WHERE alert_id = $1
            """,
            alert_uuid
        )
        
        yes_count = stats["yes_count"] or 0
        no_count = stats["no_count"] or 0
        total_count = stats["total_count"] or 0
        
        still_active_pct = (yes_count / total_count) if total_count > 0 else None

        return {
            "alert_id": alert_id,
            "still_active_count": yes_count,
            "no_longer_active_count": no_count,
            "total_validations": total_count,
            "still_active_pct": still_active_pct
        }
