'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flag,
  Footprints,
  Sun,
  Video,
} from 'lucide-react';
import type {
  CCTVCamera,
  RoutePreferenceType,
  RouteResponse,
  RouteResult,
} from '@/types';
import {
  formatDataAsOf,
  getTcsGrade,
  routesAreIdentical,
  UNSCORED_SEGMENT_COLOR,
} from '@/utils/geoMath';

interface RoutePanelProps {
  routeData: RouteResponse | null;
  selectedRouteType: RoutePreferenceType;
  previewRouteType?: RoutePreferenceType | null;
  loadingRoute?: boolean;
  cctvCameras: CCTVCamera[];
  hidden?: boolean;
  onSelectRouteType: (type: RoutePreferenceType) => void;
  onPreviewRouteType?: (type: RoutePreferenceType | null) => void;
  onStartNavigation: () => void;
  onOpenCCTV: (cam: CCTVCamera) => void;
  onOpenIncidentModal: () => void;
}

function formatMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

export const RoutePanel: React.FC<RoutePanelProps> = ({
  routeData,
  selectedRouteType,
  previewRouteType = null,
  loadingRoute = false,
  cctvCameras,
  hidden = false,
  onSelectRouteType,
  onPreviewRouteType,
  onStartNavigation,
  onOpenCCTV,
  onOpenIncidentModal,
}) => {
  const [minimized, setMinimized] = useState<boolean>(false);

  if (hidden || !routeData || routeData.routes.length === 0) return null;

  const comfortableRoute = routeData.routes.find(
    (r) => r.type === 'most_comfortable'
  );
  const shortestRoute = routeData.routes.find((r) => r.type === 'shortest');

  const displayedType = previewRouteType ?? selectedRouteType;
  const activeRoute: RouteResult =
    routeData.routes.find((r) => r.type === displayedType) ??
    routeData.routes.find((r) => r.type === selectedRouteType) ??
    comfortableRoute ??
    routeData.routes[0];

  const isIdenticalCorridor = routesAreIdentical(
    comfortableRoute?.geometry,
    shortestRoute?.geometry
  );

  if (activeRoute.distance_m <= 0) {
    return (
      <section className="hud-surface pointer-events-auto absolute bottom-20 left-3 z-25 w-[calc(100dvw-1.5rem)] max-w-92 rounded-2xl p-3.5 text-xs text-slate-700 sm:bottom-5 sm:left-4">
        <p className="font-semibold text-slate-900">
          Rute tidak ditemukan pada jaringan jalan kaki.
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Pastikan kedua titik berada dekat jaringan jalan Kota Surabaya dan
          topologi pgRouting telah aktif.
        </p>
      </section>
    );
  }

  const activeGrade = getTcsGrade(activeRoute.avg_tcs);
  const budgetLimit = routeData.heat_budget.budget_limit_min || 15;
  const budgetRatio = Math.min(
    100,
    Math.round((activeRoute.sun_exposure_min / budgetLimit) * 100)
  );
  const totalSegLength = activeRoute.segments.reduce(
    (acc, s) => acc + Math.max(s.length_m, 1),
    0
  );
  const dataAsOf = formatDataAsOf(routeData.data_as_of);
  const conditionsLabel =
    routeData.time_basis === 'forecast' && routeData.conditions_hour !== null
      ? `Prakiraan pukul ${String(routeData.conditions_hour).padStart(2, '0')}:00 WIB`
      : 'Kondisi data terakhir';

  return (
    <section
      aria-label="Perbandingan rute dan profil panas"
      className="hud-surface pointer-events-auto absolute bottom-20 left-3 z-25 flex max-h-[58dvh] w-[calc(100dvw-1.5rem)] max-w-92 flex-col overflow-hidden rounded-2xl sm:bottom-5 sm:left-4 sm:w-92"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: activeGrade.color }}
          />
          <h3 className="text-xs font-bold text-slate-900">
            Perbandingan Jalur Pejalan Kaki
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setMinimized((v) => !v)}
          aria-label={minimized ? 'Perluas panel rute' : 'Ringkas panel rute'}
          className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          {minimized ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {!minimized && (
        <div className="space-y-3 overflow-y-auto p-3.5">
          <p className="text-[11px] font-medium text-slate-600">
            {conditionsLabel}
            {dataAsOf ? ` • Data per ${dataAsOf} WIB` : ''}
          </p>

          {/* Active BMKG Weather Warning if any */}
          {routeData.weather_alert && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span className="leading-snug">{routeData.weather_alert}</span>
            </div>
          )}

          {/* Side-by-Side Dual Route Selector Cards */}
          <div className="grid grid-cols-2 gap-2">
            {[comfortableRoute, shortestRoute]
              .filter((r): r is RouteResult => Boolean(r))
              .map((route) => {
                const isComfort = route.type === 'most_comfortable';
                const selected = selectedRouteType === route.type;
                const isPreviewed = activeRoute.type === route.type;
                const grade = getTcsGrade(route.avg_tcs);
                const isRecommended =
                  routeData.heat_budget.recommended_route === route.type;
                const ribbonColor = isComfort ? '#0E7C86' : '#2563EB';

                return (
                  <button
                    key={route.type}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      onSelectRouteType(route.type as RoutePreferenceType)
                    }
                    onMouseEnter={() =>
                      onPreviewRouteType?.(route.type as RoutePreferenceType)
                    }
                    onMouseLeave={() => onPreviewRouteType?.(null)}
                    onFocus={() =>
                      onPreviewRouteType?.(route.type as RoutePreferenceType)
                    }
                    onBlur={() => onPreviewRouteType?.(null)}
                    className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all ${
                      selected
                        ? isComfort
                          ? 'border-[#0E7C86] bg-teal-50/70 ring-2 ring-[#0E7C86]'
                          : 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-600'
                        : isPreviewed
                          ? 'border-slate-400 bg-slate-50 ring-1 ring-slate-300'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-900">
                        <span
                          aria-hidden="true"
                          className="inline-block h-1.5 w-3.5 rounded-full"
                          style={{ backgroundColor: ribbonColor }}
                        />
                        <span>{isComfort ? 'Ternyaman' : 'Tercepat'}</span>
                      </span>
                      {isRecommended && (
                        <span className="rounded-full bg-[#0E7C86] px-1.5 py-0.5 text-[9px] font-bold text-white">
                          Saran
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="font-mono text-base font-extrabold text-slate-900 tabular-nums">
                        {Math.round(route.duration_min)}
                      </span>
                      <span className="text-[11px] font-medium text-slate-600">
                        mnt · {formatMeters(route.distance_m)}
                      </span>
                    </div>

                    <div className="mt-1.5 flex w-full items-center justify-between gap-1 text-[10px]">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: grade.color }}
                        />
                        <span className="font-mono font-semibold text-slate-700 tabular-nums">
                          TCS {route.avg_tcs.toFixed(2)}
                        </span>
                      </span>
                      <span className="text-[9px] font-semibold text-slate-600">
                        {selected ? 'Aktif di peta' : 'Klik pratinjau'}
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>

          {/* Map Preview Ribbon Legend & Identical Corridor Notice */}
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-2.5 py-2 text-[10px] text-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold">
                <span className="inline-block h-1.5 w-4 rounded-full bg-[#0E7C86]" />
                <span>Ternyaman (Teal)</span>
              </span>
              <span className="flex items-center gap-1.5 font-semibold">
                <span className="inline-block h-1.5 w-4 rounded-full bg-[#2563EB]" />
                <span>Tercepat (Biru)</span>
              </span>
              <span className="text-slate-600">
                {isIdenticalCorridor
                  ? 'Koridor tunggal optimal'
                  : 'Garis putus: opsi pembanding'}
              </span>
            </div>
            {isIdenticalCorridor && (
              <p className="mt-1 border-t border-slate-200/70 pt-1 text-[10px] font-medium text-slate-600">
                Rute Tercepat dan Ternyaman melewati koridor jalan yang sama
                untuk titik ini. Klik kartu di atas untuk mengganti sorotan
                rute di peta.
              </p>
            )}
          </div>

          {/* Multi-Segment Thermal Profile Strip */}
          {activeRoute.segments.length > 0 && totalSegLength > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-700">
                  Profil Termal Sepanjang Koridor
                </span>
                <span className={`font-semibold ${activeGrade.textClass}`}>
                  {activeGrade.label}
                </span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70">
                {activeRoute.segments.map((seg, idx) => {
                  const pct = (Math.max(seg.length_m, 1) / totalSegLength) * 100;
                  const segColor =
                    seg.tcs_value === null
                      ? UNSCORED_SEGMENT_COLOR
                      : getTcsGrade(seg.tcs_value).color;
                  return (
                    <div
                      key={`${seg.segment_id}-${idx}`}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: segColor,
                      }}
                      title={`Segmen #${seg.segment_id} • ${Math.round(seg.length_m)} m • TCS ${seg.tcs_value?.toFixed(2) ?? 'n/a'} • Teduh ${seg.shade_ratio === null ? 'n/a' : `${Math.round(seg.shade_ratio * 100)}%`}`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Heat Budget Exposure Meter */}
          <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 font-semibold text-slate-700">
                <Sun className="h-3.5 w-3.5 text-amber-500" />
                <span>Paparan Terik Langsung</span>
              </span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                {activeRoute.sun_exposure_min.toFixed(1)} / {budgetLimit} mnt
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-all ${
                  activeRoute.within_heat_budget
                    ? 'bg-emerald-600'
                    : 'bg-red-600'
                }`}
                style={{ width: `${budgetRatio}%` }}
              />
            </div>
            <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-700">
              <CheckCircle2
                className={`h-3.5 w-3.5 shrink-0 ${
                  activeRoute.within_heat_budget
                    ? 'text-emerald-600'
                    : 'text-red-600'
                }`}
              />
              <span>
                {activeRoute.within_heat_budget
                  ? 'Masuk dalam batas aman Heat Budget pilihan Anda.'
                  : 'Melewati batas Heat Budget — disarankan istirahat di titik teduh.'}
              </span>
            </p>
          </div>

          {/* Secondary Disclosure: Factual Segment List (<details>) */}
          {activeRoute.segments.length > 0 && (
            <details className="group rounded-xl border border-slate-200 bg-white text-xs">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-semibold text-slate-800">
                <span>
                  Sampel {activeRoute.segments.length} segmen sepanjang koridor
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="max-h-36 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 px-3 py-1">
                {activeRoute.segments.map((seg, i) => {
                  const badgeColor =
                    seg.tcs_value === null
                      ? UNSCORED_SEGMENT_COLOR
                      : getTcsGrade(seg.tcs_value).color;
                  return (
                    <div
                      key={`${seg.segment_id}-${i}`}
                      className="flex items-center justify-between py-1.5 text-[11px]"
                    >
                      <div>
                        <span className="font-mono font-semibold text-slate-900">
                          Segmen #{seg.segment_id}
                        </span>
                        <span className="ml-1.5 font-medium text-slate-600">
                          {seg.surface ?? 'trotoar'} · {Math.round(seg.length_m)}{' '}
                          m
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono tabular-nums">
                        {seg.apparent_temp !== null && (
                          <span className="font-medium text-slate-600">
                            {seg.apparent_temp.toFixed(1)}°C
                          </span>
                        )}
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs"
                          style={{ backgroundColor: badgeColor }}
                        >
                          {seg.tcs_value?.toFixed(2) ?? 'n/a'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* Secondary Utility Row: CCTV & Report */}
          <div className="flex items-center gap-2">
            {cctvCameras.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenCCTV(cctvCameras[0])}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                <Video className="h-3.5 w-3.5 text-emerald-600" />
                <span>CCTV Koridor ({cctvCameras.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenIncidentModal}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            >
              <Flag className="h-3.5 w-3.5 text-amber-600" />
              <span>Lapor Kendala</span>
            </button>
          </div>

          {/* Primary Start Walking Navigation CTA */}
          <button
            type="button"
            onClick={onStartNavigation}
            disabled={loadingRoute}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors disabled:opacity-50 ${
              selectedRouteType === 'most_comfortable'
                ? 'bg-[#0E7C86] hover:bg-[#0A5E66]'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <Footprints className="h-4 w-4" />
            <span>
              {loadingRoute
                ? 'Memperbarui Rute...'
                : `Mulai Navigasi (${selectedRouteType === 'most_comfortable' ? 'Ternyaman' : 'Tercepat'})`}
            </span>
          </button>
        </div>
      )}
    </section>
  );
};
