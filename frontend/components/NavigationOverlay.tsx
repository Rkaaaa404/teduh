'use client';

import React, { useMemo } from 'react';
import { Check, Flag, Navigation2, Trees } from 'lucide-react';
import type { Coordinate, PlacePoint, RouteResult } from '@/types';
import { getTcsGrade, haversineDistanceMeters } from '@/utils/geoMath';

interface NavigationOverlayProps {
  activeRoute: RouteResult;
  destination: PlacePoint;
  userLocation: Coordinate | null;
  onOpenReportModal: () => void;
  onFinishNavigation: () => void;
}

export const NavigationOverlay: React.FC<NavigationOverlayProps> = ({
  activeRoute,
  destination,
  userLocation,
  onOpenReportModal,
  onFinishNavigation,
}) => {
  const remainingMeters = useMemo(() => {
    if (!userLocation) return activeRoute.distance_m;
    return haversineDistanceMeters(userLocation, destination);
  }, [userLocation, destination, activeRoute.distance_m]);

  // Walking speed 4.5 km/h = 75 m/min (konsisten dengan api/routes/navigation.py baris 226)
  const remainingMinutes = Math.max(1, Math.round(remainingMeters / 75));
  const currentSegment = activeRoute.segments[0] ?? null;
  const grade = getTcsGrade(
    currentSegment ? currentSegment.tcs_value : activeRoute.avg_tcs
  );

  return (
    <>
      {/* Top Active Guidance Pill */}
      <div className="pointer-events-none absolute top-16 left-1/2 z-30 w-[calc(100dvw-1.5rem)] max-w-md -translate-x-1/2">
        <div className="hud-surface-dark pointer-events-auto flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0E7C86] text-white">
              <Navigation2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-white">
                Menuju {destination.label}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-slate-300">
                {currentSegment
                  ? `Koridor Segmen #${currentSegment.segment_id} • Teduh ${Math.round(currentSegment.shade_ratio * 100)}%`
                  : `Rute ${activeRoute.type === 'most_comfortable' ? 'Ternyaman' : 'Tercepat'} aktif`}
              </p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <span
              className="inline-block rounded-lg px-2 py-0.5 font-mono text-xs font-bold text-white tabular-nums"
              style={{ backgroundColor: grade.color }}
            >
              TCS{' '}
              {(currentSegment?.tcs_value ?? activeRoute.avg_tcs).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Dynamic Island Metrics & Controls */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 w-[calc(100dvw-1.5rem)] max-w-lg -translate-x-1/2">
        <div className="hud-surface pointer-events-auto flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] font-semibold text-slate-500">
                Sisa Jarak
              </p>
              <p className="font-mono text-sm font-extrabold text-slate-900 tabular-nums">
                {remainingMeters >= 1000
                  ? `${(remainingMeters / 1000).toFixed(2)} km`
                  : `${Math.round(remainingMeters)} m`}
              </p>
            </div>
            <div className="h-7 w-px bg-slate-200" />
            <div>
              <p className="text-[10px] font-semibold text-slate-500">
                Estimasi
              </p>
              <p className="font-mono text-sm font-extrabold text-slate-900 tabular-nums">
                {remainingMinutes} mnt
              </p>
            </div>
            <div className="hidden h-7 w-px bg-slate-200 sm:block" />
            <div className="hidden items-center gap-1.5 sm:flex">
              <Trees className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-semibold text-slate-700">
                {grade.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenReportModal}
              title="Laporkan kendala di titik ini"
              className="flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
            >
              <Flag className="h-3.5 w-3.5 text-amber-600" />
              <span className="hidden sm:inline">Lapor</span>
            </button>
            <button
              type="button"
              onClick={onFinishNavigation}
              className="flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Selesai</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
