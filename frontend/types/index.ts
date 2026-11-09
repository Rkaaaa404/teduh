/**
 * TEDUH Frontend Type Definitions
 * Diselaraskan 1-ke-1 dengan Pydantic schemas pada api/models/schemas.py
 * dan payload aktual dari api/routes/{navigation,dashboard,cctv,reports,alerts}.py.
 */

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface PlacePoint extends Coordinate {
  label: string;
}

export type HeatTolerance = 'low' | 'medium' | 'high';
export type RoutePreferenceType = 'most_comfortable' | 'shortest';
export type MapLayerMode = 'tcs' | 'uhi' | 'realistic';

// ── Routing & Navigation (/api/route, /api/segments/tcs) ─────────────────────

export interface SegmentDetail {
  segment_id: number;
  tcs_value: number;
  shade_ratio: number;
  apparent_temp: number | null;
  surface: string | null;
  length_m: number;
}

export interface RouteResult {
  type: RoutePreferenceType | string;
  distance_m: number;
  duration_min: number;
  sun_exposure_min: number;
  avg_tcs: number;
  within_heat_budget: boolean;
  geometry: GeoJSON.LineString;
  segments: SegmentDetail[];
}

export interface HeatBudgetInfo {
  budget_limit_min: number;
  recommended_route: string;
}

export interface RouteResponse {
  routes: RouteResult[];
  weather_alert: string | null;
  heat_budget: HeatBudgetInfo;
}

export interface ThermalSegment {
  segment_id: number;
  tcs_value: number;
  geometry: GeoJSON.Geometry;
}

export interface ViewportBBox {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom?: number;
  limit?: number;
}

// ── CCTV Dishub (/api/cctv/nearby) ───────────────────────────────────────────

export interface CCTVCamera {
  cctv_id: string;
  name: string;
  stream_url: string;
  lat: number;
  lng: number;
  distance_m: number;
}

// ── Geocoding (Nominatim Surabaya) ───────────────────────────────────────────

export interface NominatimSearchResult {
  place_id: number;
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
}

// ── Weather (Open-Meteo Surabaya Current + 24h Hourly) ───────────────────────

export interface WeatherSnapshot {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  uvIndex: number;
  weatherCode: number;
  isForecast: boolean;
  hourLabel: string;
}

// ── Dashboard Pemkot Surabaya (/api/dashboard/*) ─────────────────────────────

export interface UHIHotspot {
  segment_id: number;
  geometry: GeoJSON.Geometry;
  avg_lst: number;
  avg_tcs: number;
  street_name: string | null;
  shade_ratio: number;
}

export interface UHISummary {
  total_segments: number;
  critical_segments: number;
  avg_city_tcs: number;
}

export interface UHIResponse {
  hotspots: UHIHotspot[];
  summary: UHISummary;
}

export interface PriorityCorridor {
  corridor_name: string;
  segments: number[];
  avg_tcs: number;
  pedestrian_volume: 'high' | 'medium' | 'low' | string;
  nearest_transit: string | null;
  recommendation: string;
  priority_score: number;
}

export interface PriorityCorridorsResponse {
  corridors: PriorityCorridor[];
}

export interface WalkabilityStats {
  total_transit_stops: number;
  reachable_within_10min: number;
  reachable_percentage: number;
  avg_tcs_city: number;
  worst_kecamatan?: string | null;
  best_kecamatan?: string | null;
}

export interface WeatherWarningItem {
  title: string;
  severity: string;
  description: string;
  issued_at: string | null;
  expires_at: string | null;
}

export interface SimulationItem {
  segment_id: number;
  street_name: string;
  geometry: GeoJSON.Geometry;
  current_tcs: number;
  predicted_tcs_green: number;
  predicted_tcs_cool: number;
  tcs_improvement_green: number;
  tcs_improvement_cool: number;
}

export interface HourlyHeatPoint {
  hour: number;
  label: string;
  tcs_current: number;
  tcs_green_scenario: number;
  tcs_cool_scenario: number;
  apparent_temp: number;
}

export interface HotZoneSegment {
  segment_id: number;
  street_name: string;
  highway_type: string;
  has_shade_tree: boolean;
  current_tcs: number;
  apparent_temp: number;
  shade_ratio: number;
  predicted_tcs_green: number;
  predicted_tcs_cool: number;
  improvement_pct: number;
  severity: 'critical' | 'hot' | 'warm' | string;
}

export interface HeatPredictionSummary {
  total_segments: number;
  hot_segments: number;
  warm_segments: number;
  cool_segments: number;
  hot_percentage: number;
  avg_city_tcs: number;
  avg_apparent_temp: number;
  max_apparent_temp: number;
  peak_heat_hour: number;
}

export interface HeatPredictionResponse {
  summary: HeatPredictionSummary;
  hourly_trend: HourlyHeatPoint[];
  hot_zones: HotZoneSegment[];
}

// ── TEDUH-Eye Incident Reports & Map Alerts (/api/v1/*) ──────────────────────

export type IncidentCategory =
  | 'construction'
  | 'road_closed'
  | 'damaged'
  | 'flood'
  | 'heat'
  | 'accident';

export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface IncidentReportCreatePayload {
  lat: number;
  lon: number;
  category: IncidentCategory | string;
  description: string;
  severity?: IncidentSeverity;
  image_url?: string | null;
}

export interface IncidentReport {
  id: string;
  user_id?: string | null;
  lat: number;
  lon: number;
  segment_id?: number | null;
  category: string;
  description: string;
  severity?: string | null;
  image_url?: string | null;
  ai_suggested: boolean;
  ai_confidence?: number | null;
  status: 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'EXPIRED' | string;
  approved_by?: string | null;
  approved_at?: string | null;
  final_description?: string | null;
  rejected_by?: string | null;
  rejected_reason?: string | null;
  created_at: string;
}

export interface MapAlert {
  id: string;
  report_id?: string | null;
  lat: number;
  lon: number;
  category: string;
  icon_type: string;
  description: string;
  image_url?: string | null;
  severity?: string | null;
  status: 'ACTIVE' | 'AUTO_REMOVED' | 'MANUALLY_REMOVED' | string;
  auto_remove_threshold: number;
  created_at: string;
  removed_at?: string | null;
  removed_reason?: string | null;
}

export interface AlertValidationStats {
  alert_id: string;
  still_active_count: number;
  no_longer_active_count: number;
  total_validations: number;
  still_active_pct: number; // 0.0 - 1.0 ratio from backend
}

export interface AlertValidationResult {
  status: string;
  validation_summary: {
    total_validations_2h: number;
    still_active_count: number;
    no_longer_active_count: number;
    no_longer_active_pct: number;
    auto_removed: boolean;
  };
}

export interface UserFeedbackPayload {
  user_id?: string | null;
  route_id?: string | null;
  tcs_predicted?: number | null;
  rating_thermal: number;
  rating_shade: number;
  rating_walkway: number;
  has_unreported: boolean;
  notes?: string | null;
}
