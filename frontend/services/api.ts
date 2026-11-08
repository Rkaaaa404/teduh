/**
 * TEDUH Factual API Client (Zero Dummy / Mock Data)
 *
 * Seluruh endpoint terhubung langsung ke layanan FastAPI (PostGIS + pgRouting + Spark MLlib),
 * Nominatim OpenStreetMap (khusus area Surabaya), dan Dishub Surabaya HLS.
 */

import type {
  AlertValidationResult,
  AlertValidationStats,
  CCTVCamera,
  Coordinate,
  HeatPredictionResponse,
  HeatTolerance,
  IncidentReport,
  IncidentReportCreatePayload,
  MapAlert,
  NominatimSearchResult,
  PriorityCorridorsResponse,
  RouteResponse,
  SimulationItem,
  ThermalSegment,
  UHIResponse,
  UserFeedbackPayload,
  ViewportBBox,
  WalkabilityStats,
  WeatherWarningItem,
} from '@/types';
import { sampleRouteCorridorPoints, SURABAYA_BOUNDS } from '@/utils/geoMath';

const rawEnvUrl = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api'
).replace(/\/+$/, '');

export const BACKEND_ORIGIN = rawEnvUrl.endsWith('/api')
  ? rawEnvUrl.slice(0, -4)
  : rawEnvUrl;
export const API_BASE = `${BACKEND_ORIGIN}/api`;
export const API_V1_BASE = `${BACKEND_ORIGIN}/api/v1`;

async function parseErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') return body.detail;
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) {
      return body.detail[0].msg;
    }
  } catch {
    // ignore non-JSON error body
  }
  return `${fallback} (HTTP ${res.status})`;
}

// ── Health Check ─────────────────────────────────────────────────────────────

export async function checkBackendHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_ORIGIN}/health`, { signal });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.status === 'ok';
  } catch {
    return false;
  }
}

// ── Navigation & Spatial Layers (/api/*) ─────────────────────────────────────

export async function fetchRoute(
  origin: Coordinate,
  destination: Coordinate,
  tolerance: HeatTolerance = 'medium',
  departureIso?: string,
  signal?: AbortSignal
): Promise<RouteResponse> {
  const res = await fetch(`${API_BASE}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      user_profile: { heat_tolerance: tolerance, prefer_shade: true },
      departure_time: departureIso ?? new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal menghitung rute'));
  }
  return res.json();
}

export async function fetchThermalSegments(
  bbox?: ViewportBBox,
  signal?: AbortSignal
): Promise<ThermalSegment[]> {
  let url = `${API_BASE}/segments/tcs`;
  if (bbox) {
    const params = new URLSearchParams({
      west: bbox.west.toFixed(6),
      south: bbox.south.toFixed(6),
      east: bbox.east.toFixed(6),
      north: bbox.north.toFixed(6),
    });
    if (typeof bbox.zoom === 'number') {
      params.set('zoom', bbox.zoom.toFixed(1));
    }
    if (typeof bbox.limit === 'number') {
      params.set('limit', String(bbox.limit));
    }
    url += `?${params.toString()}`;
  }
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat segmen TCS'));
  }
  return res.json();
}

export async function fetchTemperatureHeatmap(
  signal?: AbortSignal
): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(`${API_BASE}/dashboard/temperature-heatmap`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat heatmap suhu'));
  }
  return res.json();
}

export async function fetchNearbyCCTVs(
  lat: number,
  lng: number,
  radius = 550,
  limit = 6,
  signal?: AbortSignal
): Promise<CCTVCamera[]> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius: String(radius),
    limit: String(limit),
  });
  const res = await fetch(`${API_BASE}/cctv/nearby?${params.toString()}`, {
    signal,
  });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchRouteCorridorCCTVs(
  geometry?: GeoJSON.LineString | null,
  signal?: AbortSignal
): Promise<CCTVCamera[]> {
  const samplePoints = sampleRouteCorridorPoints(geometry);
  if (samplePoints.length === 0) return [];

  const batches = await Promise.all(
    samplePoints.map((pt) => fetchNearbyCCTVs(pt.lat, pt.lng, 550, 5, signal))
  );

  const deduped = new Map<string, CCTVCamera>();
  for (const list of batches) {
    for (const cam of list) {
      const existing = deduped.get(cam.cctv_id);
      if (!existing || cam.distance_m < existing.distance_m) {
        deduped.set(cam.cctv_id, cam);
      }
    }
  }
  return Array.from(deduped.values()).sort((a, b) => a.distance_m - b.distance_m);
}

// ── Nominatim Geocoding (Surabaya Bounded) ───────────────────────────────────

export async function searchPlacesSurabaya(
  query: string,
  signal?: AbortSignal
): Promise<NominatimSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const viewbox = `${SURABAYA_BOUNDS.west},${SURABAYA_BOUNDS.north},${SURABAYA_BOUNDS.east},${SURABAYA_BOUNDS.south}`;
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: `${trimmed}, Surabaya`,
    viewbox,
    bounded: '1',
    limit: '6',
    'accept-language': 'id',
  });

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      signal,
      headers: { Accept: 'application/json' },
    }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function reverseGeocodeSurabaya(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<string> {
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: lat.toFixed(6),
      lon: lng.toFixed(6),
      zoom: '18',
      'accept-language': 'id',
    });
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
      {
        signal,
        headers: { Accept: 'application/json' },
      }
    );
    if (!res.ok) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const data = await res.json();
    const addr = data?.address;
    const primary =
      data?.name ||
      addr?.road ||
      addr?.pedestrian ||
      addr?.neighbourhood ||
      addr?.suburb;
    const secondary = addr?.suburb || addr?.city_district || '';
    if (primary) {
      return secondary && secondary !== primary
        ? `${primary}, ${secondary}`
        : primary;
    }
    if (typeof data?.display_name === 'string') {
      return data.display_name.split(',').slice(0, 2).join(',').trim();
    }
  } catch {
    // Fallback jujur ke koordinat GPS presisi
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// ── Dashboard Pemkot Surabaya (/api/dashboard/*) ─────────────────────────────

export async function fetchUHIHotspots(signal?: AbortSignal): Promise<UHIResponse> {
  const res = await fetch(`${API_BASE}/dashboard/uhi`, { signal });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat data UHI'));
  }
  return res.json();
}

export async function fetchPriorityCorridors(
  signal?: AbortSignal
): Promise<PriorityCorridorsResponse> {
  const res = await fetch(`${API_BASE}/dashboard/priority-corridors`, { signal });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat koridor prioritas'));
  }
  return res.json();
}

export async function fetchWalkabilityStats(
  signal?: AbortSignal
): Promise<WalkabilityStats> {
  const res = await fetch(`${API_BASE}/dashboard/walkability`, { signal });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat statistik walkability'));
  }
  return res.json();
}

export async function fetchWeatherWarnings(
  signal?: AbortSignal
): Promise<WeatherWarningItem[]> {
  const res = await fetch(`${API_BASE}/dashboard/active-alerts`, { signal });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchSimulations(
  signal?: AbortSignal
): Promise<SimulationItem[]> {
  const res = await fetch(`${API_BASE}/dashboard/simulations`, { signal });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat simulasi TCS'));
  }
  return res.json();
}

export async function fetchHeatPrediction(
  signal?: AbortSignal
): Promise<HeatPredictionResponse> {
  const res = await fetch(`${API_BASE}/dashboard/heat-prediction`, { signal });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat prediksi panas'));
  }
  return res.json();
}

// ── TEDUH-Eye Incident Reports & Map Alerts (/api/v1/*) ──────────────────────

export async function submitManualReport(
  payload: IncidentReportCreatePayload
): Promise<IncidentReport> {
  const res = await fetch(`${API_V1_BASE}/report/submit-manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal mengirim laporan insiden'));
  }
  return res.json();
}

export async function fetchPendingReports(
  signal?: AbortSignal
): Promise<IncidentReport[]> {
  const res = await fetch(`${API_V1_BASE}/report/pending`, { signal });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat antrean laporan'));
  }
  return res.json();
}

export async function fetchAllReports(
  filters?: { category?: string; status?: string },
  signal?: AbortSignal
): Promise<IncidentReport[]> {
  const params = new URLSearchParams();
  if (filters?.category) params.set('category', filters.category);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  const res = await fetch(
    `${API_V1_BASE}/report/all${qs ? `?${qs}` : ''}`,
    { signal }
  );
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat riwayat laporan'));
  }
  return res.json();
}

export async function approveIncidentReport(
  reportId: string,
  approvedByUuid: string,
  finalDescription: string
): Promise<IncidentReport> {
  const res = await fetch(`${API_V1_BASE}/report/${reportId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      approved_by: approvedByUuid,
      final_description: finalDescription,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal menyetujui laporan'));
  }
  return res.json();
}

export async function rejectIncidentReport(
  reportId: string,
  rejectedByUuid: string,
  reason: string
): Promise<IncidentReport> {
  const res = await fetch(`${API_V1_BASE}/report/${reportId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rejected_by: rejectedByUuid,
      reason,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal menolak laporan'));
  }
  return res.json();
}

export async function fetchActiveMapAlerts(
  signal?: AbortSignal
): Promise<MapAlert[]> {
  const res = await fetch(`${API_V1_BASE}/alerts/active`, { signal });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchAlertValidationStats(
  alertId: string,
  signal?: AbortSignal
): Promise<AlertValidationStats> {
  const res = await fetch(`${API_V1_BASE}/alerts/${alertId}/validations`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal memuat statistik validasi'));
  }
  return res.json();
}

export async function submitAlertValidation(
  alertId: string,
  response: 'still_active' | 'no_longer_active',
  userUuid: string
): Promise<AlertValidationResult> {
  const res = await fetch(`${API_V1_BASE}/alerts/${alertId}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response,
      user_id: userUuid,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal mengirim validasi komunitas'));
  }
  return res.json();
}

export async function deleteMapAlertManual(
  alertId: string,
  operatorUuid: string
): Promise<void> {
  const params = new URLSearchParams({ deleted_by: operatorUuid });
  const res = await fetch(
    `${API_V1_BASE}/alerts/${alertId}?${params.toString()}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal menonaktifkan alert peta'));
  }
}

export async function submitJourneyFeedback(
  payload: UserFeedbackPayload
): Promise<void> {
  const res = await fetch(`${API_V1_BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'Gagal menyimpan evaluasi perjalanan'));
  }
}
