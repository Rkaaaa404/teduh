"""Pydantic schemas for API request/response validation."""

from typing import Optional
from datetime import datetime

from pydantic import BaseModel, Field


# --- Route Request/Response ---

class Coordinate(BaseModel):
    lat: float = Field(..., ge=-90, le=90, description="Latitude")
    lng: float = Field(..., ge=-180, le=180, description="Longitude")


class UserProfileInput(BaseModel):
    heat_tolerance: str = Field(
        default="medium",
        description="Heat tolerance level: low, medium, high"
    )
    prefer_shade: bool = Field(default=True)


class RouteRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    user_profile: Optional[UserProfileInput] = None
    departure_time: Optional[datetime] = None


class SegmentDetail(BaseModel):
    segment_id: int
    tcs_value: float
    shade_ratio: float
    apparent_temp: Optional[float] = None
    surface: Optional[str] = None
    length_m: float


class RouteResult(BaseModel):
    type: str  # "shortest" or "most_comfortable"
    distance_m: float
    duration_min: float
    sun_exposure_min: float
    avg_tcs: float
    within_heat_budget: bool
    geometry: dict  # GeoJSON LineString
    segments: list[SegmentDetail]


class HeatBudgetInfo(BaseModel):
    budget_limit_min: float
    recommended_route: str


class RouteResponse(BaseModel):
    routes: list[RouteResult]
    weather_alert: Optional[str] = None
    heat_budget: HeatBudgetInfo


# --- Dashboard Responses ---

class UHIHotspot(BaseModel):
    segment_id: int
    geometry: dict
    avg_lst: float
    avg_tcs: float
    street_name: Optional[str] = None
    shade_ratio: float


class UHISummary(BaseModel):
    total_segments: int
    critical_segments: int
    avg_city_tcs: float


class UHIResponse(BaseModel):
    hotspots: list[UHIHotspot]
    summary: UHISummary


class PriorityCorridor(BaseModel):
    corridor_name: str
    segments: list[int]
    avg_tcs: float
    pedestrian_volume: str
    nearest_transit: Optional[str] = None
    recommendation: str
    priority_score: float


class PriorityCorridorsResponse(BaseModel):
    corridors: list[PriorityCorridor]


class WalkabilityStats(BaseModel):
    total_transit_stops: int
    reachable_within_10min: int
    reachable_percentage: float
    avg_tcs_city: float
    worst_kecamatan: Optional[str] = None
    best_kecamatan: Optional[str] = None


# --- Thermal Heatmap ---

class ThermalSegment(BaseModel):
    segment_id: int
    tcs_value: float
    geometry: dict  # GeoJSON


# --- TEDUH: Incident Reports & Map Alerts ---

class IncidentReportCreate(BaseModel):
    lat: float = Field(..., ge=-90, le=90, description="Latitude")
    lon: float = Field(..., ge=-180, le=180, description="Longitude")
    category: str = Field(..., description="Incident category, e.g. construction, accident, road_closed, damaged, flood, heat")
    description: str = Field(..., description="Report description details")
    severity: Optional[str] = Field(default="MEDIUM", description="Severity level: LOW, MEDIUM, HIGH, CRITICAL")
    image_url: Optional[str] = Field(default=None, description="Optional image URL stored in MinIO")

class IncidentReportResponse(BaseModel):
    id: str
    user_id: Optional[str] = None
    lat: float
    lon: float
    segment_id: Optional[int] = None
    category: str
    description: str
    severity: Optional[str] = None
    image_url: Optional[str] = None
    ai_suggested: bool
    ai_confidence: Optional[float] = None
    status: str
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    final_description: Optional[str] = None
    rejected_by: Optional[str] = None
    rejected_reason: Optional[str] = None
    created_at: datetime

class ApproveReportRequest(BaseModel):
    approved_by: str = Field(..., description="UUID of the approving gov officer")
    final_description: str = Field(..., description="Approved/edited final description for map visualization")

class RejectReportRequest(BaseModel):
    rejected_by: str = Field(..., description="UUID of the rejecting gov officer")
    reason: str = Field(..., description="Reason for rejection")

class MapAlertResponse(BaseModel):
    id: str
    report_id: Optional[str] = None
    lat: float
    lon: float
    category: str
    icon_type: str
    description: str
    image_url: Optional[str] = None
    severity: Optional[str] = None
    status: str
    auto_remove_threshold: float
    created_at: datetime
    removed_at: Optional[datetime] = None
    removed_reason: Optional[str] = None

class AlertValidationCreate(BaseModel):
    response: str = Field(..., description="Community validation response: still_active or no_longer_active")
    user_id: str = Field(..., description="UUID of user submitting validation response")

class UserFeedbackCreate(BaseModel):
    user_id: Optional[str] = Field(default=None, description="Optional UUID of the user")
    route_id: Optional[str] = Field(default=None, description="Optional UUID of the route taken")
    tcs_predicted: Optional[float] = Field(default=None, description="TCS predicted value for route")
    rating_thermal: int = Field(..., ge=1, le=5, description="Thermal comfort rating (1-5)")
    rating_shade: int = Field(..., ge=1, le=5, description="Shade rating (1-5)")
    rating_walkway: int = Field(..., ge=1, le=5, description="Walkway smooth/condition rating (1-5)")
    has_unreported: bool = Field(default=False, description="Flag if there were unreported incidents on the route")
    notes: Optional[str] = Field(default=None, description="Optional textual feedback notes")

