/**
 * Geodesic, Solar Astronomy (SunCalc), & Spatial Geometry Helpers
 * Seluruh kalkulasi berbasis posisi geografis & tanggal aktual Kota Surabaya.
 */

import SunCalc from 'suncalc';
import type { Coordinate } from '@/types';

export const SURABAYA_CENTER: Coordinate = {
  lat: -7.2575,
  lng: 112.7521,
};

export const SURABAYA_BOUNDS = {
  west: 112.6,
  south: -7.35,
  east: 112.85,
  north: -7.2,
};

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Menghitung jarak permukaan bumi (meter) menggunakan rumus Haversine.
 */
export function haversineDistanceMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Menghitung sudut kompas bearing (0-360 derajat, 0 = Utara) dari titik A ke B.
 */
export function computeBearingDegrees(from: Coordinate, to: Coordinate): number {
  const phi1 = toRad(from.lat);
  const phi2 = toRad(to.lat);
  const deltaLambda = toRad(to.lng - from.lng);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Memeriksa apakah titik berada di dalam area layanan routing Surabaya.
 */
export function isWithinSurabayaBounds(point: Coordinate): boolean {
  return (
    point.lat >= SURABAYA_BOUNDS.south &&
    point.lat <= SURABAYA_BOUNDS.north &&
    point.lng >= SURABAYA_BOUNDS.west &&
    point.lng <= SURABAYA_BOUNDS.east
  );
}

/**
 * Mengambil jam lokal WIB (Asia/Jakarta, UTC+7) saat ini dalam bentuk desimal (misal 13.5 = 13:30 WIB).
 */
export function getCurrentWibSolarHour(): number {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const wibDate = new Date(utcMs + 7 * 3_600_000);
  const rawHour = wibDate.getHours() + wibDate.getMinutes() / 60;
  return Math.max(5.0, Math.min(20.5, Math.round(rawHour * 4) / 4));
}

/**
 * Mengonversi jam desimal WIB pada hari ini menjadi Date objek absolut (UTC+7).
 */
export function buildTodayWibDate(hourFloat: number): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const wibNow = new Date(utcMs + 7 * 3_600_000);

  const year = wibNow.getFullYear();
  const month = wibNow.getMonth();
  const day = wibNow.getDate();
  const hours = Math.floor(hourFloat);
  const minutes = Math.round((hourFloat - hours) * 60);

  // Konversi kembali dari WIB (UTC+7) ke epoch UTC murni
  return new Date(Date.UTC(year, month, day, hours - 7, minutes, 0));
}

/**
 * Menghitung posisi matahari astronomis riil di atas Kota Surabaya menggunakan SunCalc.
 */
export function calculateSurabayaSolarPosition(hourFloat: number): {
  azimuthDeg: number;
  elevationDeg: number;
  zenithDeg: number;
  isNight: boolean;
  isGoldenHour: boolean;
} {
  const targetDate = buildTodayWibDate(hourFloat);
  const pos = SunCalc.getPosition(
    targetDate,
    SURABAYA_CENTER.lat,
    SURABAYA_CENTER.lng
  );

  // SunCalc azimuth diukur dari Selatan searah jarum jam (radian) -> konversi ke Utara = 0°
  const azimuthDeg = (toDeg(pos.azimuth) + 180 + 360) % 360;
  const elevationDeg = toDeg(pos.altitude);
  const zenithDeg = Math.max(0, Math.min(90, 90 - elevationDeg));
  const isNight = elevationDeg <= 0;
  const isGoldenHour = elevationDeg > 0 && elevationDeg <= 18;

  return {
    azimuthDeg,
    elevationDeg,
    zenithDeg,
    isNight,
    isGoldenHour,
  };
}

/**
 * Mengambil koordinat titik sampel sepanjang koridor LineString (25%, 50%, 75%)
 * untuk pencarian kamera CCTV Dishub yang benar-benar berada di jalur rute.
 */
export function sampleRouteCorridorPoints(
  geometry?: GeoJSON.LineString | null
): Coordinate[] {
  const coords = geometry?.coordinates;
  if (!coords || coords.length === 0) return [];
  if (coords.length < 3) {
    const mid = coords[Math.floor(coords.length / 2)];
    return [{ lng: mid[0], lat: mid[1] }];
  }
  const indices = [
    Math.floor(coords.length * 0.25),
    Math.floor(coords.length * 0.5),
    Math.floor(coords.length * 0.75),
  ];
  const uniqueIndices = Array.from(new Set(indices));
  return uniqueIndices.map((idx) => ({
    lng: coords[idx][0],
    lat: coords[idx][1],
  }));
}

/**
 * Mengekstrak koordinat tengah dari GeoJSON Geometry (Point / LineString / MultiLineString)
 * untuk fitur "Lihat di Peta 3D" dari tabel analitik Dashboard Pemkot.
 */
export function extractGeometryCenter(
  geometry?: GeoJSON.Geometry | null
): Coordinate | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates;
    return { lat, lng };
  }
  if (geometry.type === 'LineString' && geometry.coordinates.length > 0) {
    const mid = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
    return { lng: mid[0], lat: mid[1] };
  }
  if (geometry.type === 'MultiLineString' && geometry.coordinates.length > 0) {
    const firstLine = geometry.coordinates[0];
    if (firstLine && firstLine.length > 0) {
      const mid = firstLine[Math.floor(firstLine.length / 2)];
      return { lng: mid[0], lat: mid[1] };
    }
  }
  return null;
}

/**
 * Klasifikasi warna & label semantik 4 tingkat untuk Thermal Comfort Score (TCS).
 */
export function getTcsGrade(tcs: number): {
  color: string;
  bgSoft: string;
  textClass: string;
  label: string;
} {
  if (tcs >= 0.7) {
    return {
      color: '#1F8A5B',
      bgSoft: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      textClass: 'text-emerald-700',
      label: 'Teduh & Nyaman',
    };
  }
  if (tcs >= 0.5) {
    return {
      color: '#D9822B',
      bgSoft: 'bg-amber-50 border-amber-200 text-amber-800',
      textClass: 'text-amber-700',
      label: 'Cukup Hangat',
    };
  }
  if (tcs >= 0.35) {
    return {
      color: '#D9532F',
      bgSoft: 'bg-orange-50 border-orange-200 text-orange-800',
      textClass: 'text-orange-700',
      label: 'Panas Terik',
    };
  }
  return {
    color: '#B42318',
    bgSoft: 'bg-red-50 border-red-200 text-red-800',
    textClass: 'text-red-700',
    label: 'Panas Ekstrem',
  };
}

/**
 * Helper light-dismiss aman untuk elemen native <dialog closedby="any">
 * pada browser yang belum mendukung atribut closedby secara native (misal Safari).
 */
export function attachDialogLightDismiss(dialog: HTMLDialogElement | null): () => void {
  if (!dialog || typeof HTMLDialogElement === 'undefined') return () => {};
  if ('closedBy' in HTMLDialogElement.prototype) return () => {};

  let pressedOutside = false;
  const isOutside = (e: PointerEvent) => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!dialog.open) return;
    pressedOutside = isOutside(e);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dialog.open) return;
    if (pressedOutside && isOutside(e)) {
      dialog.close();
    }
    pressedOutside = false;
  };

  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('pointerup', onPointerUp);
  return () => {
    dialog.removeEventListener('pointerdown', onPointerDown);
    dialog.removeEventListener('pointerup', onPointerUp);
  };
}

/** Colour for a segment that has no real comfort score. */
export const UNSCORED_SEGMENT_COLOR = '#CBD5E1';

/** Format a backend timestamp as a short WIB label, or null if there is none. */
export function formatDataAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Memproyeksikan titik P ke segmen garis A-B pada bidang ekuirektangular lokal (meter)
 * dan mengembalikan jarak terdekat (meter) serta fraksi posisi t pada segmen [0, 1].
 */
function projectPointToSegmentMeters(
  p: Coordinate,
  a: Coordinate,
  b: Coordinate
): { distanceM: number; t: number; segLenM: number } {
  const cosLat = Math.cos(toRad((a.lat + b.lat) / 2));
  const dx = toRad(b.lng - a.lng) * cosLat * EARTH_RADIUS_M;
  const dy = toRad(b.lat - a.lat) * EARTH_RADIUS_M;
  const px = toRad(p.lng - a.lng) * cosLat * EARTH_RADIUS_M;
  const py = toRad(p.lat - a.lat) * EARTH_RADIUS_M;

  const segLenSq = dx * dx + dy * dy;
  const segLenM = Math.sqrt(segLenSq);
  if (segLenSq < 1e-6) {
    return {
      distanceM: Math.sqrt(px * px + py * py),
      t: 0,
      segLenM: 0,
    };
  }

  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / segLenSq));
  const projX = t * dx;
  const projY = t * dy;
  const distM = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  return { distanceM: distM, t, segLenM };
}

/**
 * Menghitung jarak terdekat (meter) dari koordinat ke garis rute LineString,
 * serta sisa jarak tempuh sepanjang polyline dari titik proyeksi hingga ujung tujuan.
 */
export function projectOnPolyline(
  point: Coordinate,
  geometry?: GeoJSON.LineString | null,
  fallbackTotalMeters = 0
): { distanceFromRouteMeters: number; remainingRouteMeters: number } {
  const coords = geometry?.coordinates;
  if (!coords || coords.length === 0) {
    return {
      distanceFromRouteMeters: Infinity,
      remainingRouteMeters: fallbackTotalMeters,
    };
  }
  if (coords.length === 1) {
    const only: Coordinate = { lng: coords[0][0], lat: coords[0][1] };
    const d = haversineDistanceMeters(point, only);
    return {
      distanceFromRouteMeters: d,
      remainingRouteMeters: fallbackTotalMeters,
    };
  }

  const segLengths: number[] = [];
  let minDistance = Infinity;
  let bestSegIdx = 0;
  let bestT = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const a: Coordinate = { lng: coords[i][0], lat: coords[i][1] };
    const b: Coordinate = { lng: coords[i + 1][0], lat: coords[i + 1][1] };
    const { distanceM, t, segLenM } = projectPointToSegmentMeters(point, a, b);
    segLengths.push(segLenM);
    if (distanceM < minDistance) {
      minDistance = distanceM;
      bestSegIdx = i;
      bestT = t;
    }
  }

  let remaining = (1 - bestT) * (segLengths[bestSegIdx] ?? 0);
  for (let i = bestSegIdx + 1; i < segLengths.length; i++) {
    remaining += segLengths[i];
  }

  return {
    distanceFromRouteMeters: minDistance,
    remainingRouteMeters: Math.max(0, remaining),
  };
}

/**
 * Menghitung jarak minimum (meter) dari sebuah koordinat ke polyline rute.
 */
export function distanceToPolylineMeters(
  point: Coordinate,
  geometry?: GeoJSON.LineString | null
): number {
  return projectOnPolyline(point, geometry, 0).distanceFromRouteMeters;
}

/**
 * Memeriksa apakah dua geometri rute LineString identik (koordinat sama persis).
 */
export function routesAreIdentical(
  a?: GeoJSON.LineString | null,
  b?: GeoJSON.LineString | null
): boolean {
  const ca = a?.coordinates;
  const cb = b?.coordinates;
  if (!ca || !cb || ca.length === 0 || cb.length === 0) return false;
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) {
    if (
      Math.abs(ca[i][0] - cb[i][0]) > 1e-6 ||
      Math.abs(ca[i][1] - cb[i][1]) > 1e-6
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Menghitung sudut arah (bearing) segmen awal rute agar kamera navigasi 3D
 * langsung menghadap searah jalan saat pengguna menekan "Mulai Navigasi".
 */
export function computeInitialRouteBearing(
  geometry?: GeoJSON.LineString | null,
  fallbackFrom?: Coordinate | null,
  fallbackTo?: Coordinate | null
): number {
  const coords = geometry?.coordinates;
  if (coords && coords.length >= 2) {
    const start: Coordinate = { lng: coords[0][0], lat: coords[0][1] };
    for (let i = 1; i < coords.length; i++) {
      const next: Coordinate = { lng: coords[i][0], lat: coords[i][1] };
      if (haversineDistanceMeters(start, next) >= 4) {
        return computeBearingDegrees(start, next);
      }
    }
  }
  if (fallbackFrom && fallbackTo) {
    return computeBearingDegrees(fallbackFrom, fallbackTo);
  }
  return -12;
}

