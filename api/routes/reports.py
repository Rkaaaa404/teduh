"""Incident reports API routes — manual reporting and gov moderation."""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from api.db import get_conn
from api.models.schemas import (
    IncidentReportCreate,
    IncidentReportResponse,
    ApproveReportRequest,
    RejectReportRequest,
    UserFeedbackCreate
)

router = APIRouter()

@router.post("/report/submit-manual", response_model=IncidentReportResponse, status_code=status.HTTP_201_CREATED)
async def submit_manual_report(report: IncidentReportCreate):
    """Submit a manual incident report (without image/AI).
    
    Status defaults to 'PENDING_REVIEW' and the coordinate is snapped to the nearest road segment.
    """
    async with get_conn() as conn:
        # Snap the coordinates to the nearest segment
        segment_row = await conn.fetchrow(
            """
            SELECT segment_id 
            FROM segments 
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326) 
            LIMIT 1
            """,
            report.lon, report.lat
        )
        segment_id = segment_row["segment_id"] if segment_row else None

        # Insert report
        row = await conn.fetchrow(
            """
            INSERT INTO incident_reports (
                lat, lon, segment_id, category, description, severity, image_url, ai_suggested, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'PENDING_REVIEW')
            RETURNING *
            """,
            report.lat, report.lon, segment_id, report.category, report.description, report.severity, report.image_url
        )

        if not row:
            raise HTTPException(status_code=500, detail="Failed to save incident report")
        
        # Cast UUIDs to strings for Pydantic compatibility
        result = dict(row)
        result["id"] = str(result["id"])
        if result["user_id"]:
            result["user_id"] = str(result["user_id"])
        return result


@router.get("/report/pending", response_model=List[IncidentReportResponse])
async def get_pending_reports():
    """Retrieve all reports that are pending gov moderation."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM incident_reports 
            WHERE status = 'PENDING_REVIEW'
            ORDER BY created_at DESC
            """
        )
        results = []
        for r in rows:
            item = dict(r)
            item["id"] = str(item["id"])
            if item["user_id"]:
                item["user_id"] = str(item["user_id"])
            if item["approved_by"]:
                item["approved_by"] = str(item["approved_by"])
            if item["rejected_by"]:
                item["rejected_by"] = str(item["rejected_by"])
            results.append(item)
        return results


@router.get("/report/all", response_model=List[IncidentReportResponse])
async def get_all_reports(
    category: Optional[str] = Query(None, description="Filter by category"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status")
):
    """Retrieve all incident reports (pending, active, rejected, expired)."""
    async with get_conn() as conn:
        query = "SELECT * FROM incident_reports WHERE 1=1"
        params = []
        
        if category:
            params.append(category)
            query += f" AND category = ${len(params)}"
        if status_filter:
            params.append(status_filter)
            query += f" AND status = ${len(params)}"
            
        query += " ORDER BY created_at DESC"
        
        rows = await conn.fetch(query, *params)
        results = []
        for r in rows:
            item = dict(r)
            item["id"] = str(item["id"])
            if item["user_id"]:
                item["user_id"] = str(item["user_id"])
            if item["approved_by"]:
                item["approved_by"] = str(item["approved_by"])
            if item["rejected_by"]:
                item["rejected_by"] = str(item["rejected_by"])
            results.append(item)
        return results


@router.get("/report/{report_id}", response_model=IncidentReportResponse)
async def get_report_detail(report_id: str):
    """Retrieve detailed information of a single report."""
    try:
        uuid_val = UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")
        
    async with get_conn() as conn:
        row = await conn.fetchrow("SELECT * FROM incident_reports WHERE id = $1", uuid_val)
        if not row:
            raise HTTPException(status_code=404, detail="Report not found")
        
        item = dict(row)
        item["id"] = str(item["id"])
        if item["user_id"]:
            item["user_id"] = str(item["user_id"])
        if item["approved_by"]:
            item["approved_by"] = str(item["approved_by"])
        if item["rejected_by"]:
            item["rejected_by"] = str(item["rejected_by"])
        return item


@router.post("/report/{report_id}/approve", response_model=IncidentReportResponse)
async def approve_report(report_id: str, request: ApproveReportRequest):
    """Approve a pending report.
    
    This sets the status of the report to 'ACTIVE' and inserts it into `map_alerts` so it appears on user maps.
    """
    try:
        uuid_val = UUID(report_id)
        approved_by_uuid = UUID(request.approved_by)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    async with get_conn() as conn:
        # Check if report exists and is pending
        report_row = await conn.fetchrow("SELECT * FROM incident_reports WHERE id = $1", uuid_val)
        if not report_row:
            raise HTTPException(status_code=404, detail="Report not found")
        if report_row["status"] != "PENDING_REVIEW":
            raise HTTPException(status_code=400, detail=f"Cannot approve report with status: {report_row['status']}")

        # Start transaction to keep both tables in sync
        async with conn.transaction():
            # Update incident_reports
            row = await conn.fetchrow(
                """
                UPDATE incident_reports
                SET status = 'ACTIVE',
                    approved_by = $1,
                    approved_at = NOW(),
                    final_description = $2
                WHERE id = $3
                RETURNING *
                """,
                approved_by_uuid, request.final_description, uuid_val
            )

            # Insert into map_alerts
            icon_type = report_row["category"]  # Use category as icon_type base (e.g. 'construction')
            await conn.execute(
                """
                INSERT INTO map_alerts (
                    report_id, lat, lon, geom, category, icon_type, description, image_url, severity, status
                ) VALUES (
                    $1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, $5, $6, $7, $8, 'ACTIVE'
                )
                """,
                uuid_val, report_row["lat"], report_row["lon"], report_row["category"], icon_type,
                request.final_description, report_row["image_url"], report_row["severity"]
            )

        item = dict(row)
        item["id"] = str(item["id"])
        if item["user_id"]:
            item["user_id"] = str(item["user_id"])
        item["approved_by"] = str(item["approved_by"])
        return item


@router.post("/report/{report_id}/reject", response_model=IncidentReportResponse)
async def reject_report(report_id: str, request: RejectReportRequest):
    """Reject a pending report."""
    try:
        uuid_val = UUID(report_id)
        rejected_by_uuid = UUID(request.rejected_by)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    async with get_conn() as conn:
        report_row = await conn.fetchrow("SELECT * FROM incident_reports WHERE id = $1", uuid_val)
        if not report_row:
            raise HTTPException(status_code=404, detail="Report not found")
        if report_row["status"] != "PENDING_REVIEW":
            raise HTTPException(status_code=400, detail=f"Cannot reject report with status: {report_row['status']}")

        row = await conn.fetchrow(
            """
            UPDATE incident_reports
            SET status = 'REJECTED',
                rejected_by = $1,
                rejected_reason = $2
            WHERE id = $3
            RETURNING *
            """,
            rejected_by_uuid, request.reason, uuid_val
        )

        item = dict(row)
        item["id"] = str(item["id"])
        if item["user_id"]:
            item["user_id"] = str(item["user_id"])
        item["rejected_by"] = str(item["rejected_by"])
        return item


@router.post("/feedback", status_code=status.HTTP_201_CREATED)
async def submit_journey_feedback(feedback: UserFeedbackCreate):
    """Submit post-journey walking comfort feedback."""
    user_uuid = UUID(feedback.user_id) if feedback.user_id else None
    route_uuid = UUID(feedback.route_id) if feedback.route_id else None

    async with get_conn() as conn:
        await conn.execute(
            """
            INSERT INTO user_feedback (
                user_id, route_id, tcs_predicted, rating_thermal, rating_shade, rating_walkway, has_unreported, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            user_uuid, route_uuid, feedback.tcs_predicted, feedback.rating_thermal, feedback.rating_shade,
            feedback.rating_walkway, feedback.has_unreported, feedback.notes
        )
        return {"status": "success", "message": "Feedback submitted successfully"}
