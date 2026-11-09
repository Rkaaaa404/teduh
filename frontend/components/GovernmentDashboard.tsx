'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bus,
  Check,
  Flame,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Trees,
  X,
  XCircle,
} from 'lucide-react';
import type {
  Coordinate,
  HeatPredictionResponse,
  IncidentReport,
  MapAlert,
  PriorityCorridor,
  SimulationItem,
  UHIResponse,
  WalkabilityStats,
  WeatherWarningItem,
} from '@/types';
import {
  approveIncidentReport,
  deleteMapAlertManual,
  fetchActiveMapAlerts,
  fetchAllReports,
  fetchHeatPrediction,
  fetchPendingReports,
  fetchPriorityCorridors,
  fetchSimulations,
  fetchUHIHotspots,
  fetchWalkabilityStats,
  fetchWeatherWarnings,
  rejectIncidentReport,
} from '@/services/api';
import { attachDialogLightDismiss, extractGeometryCenter, formatDataAsOf, getTcsGrade } from '@/utils/geoMath';
import { getPemkotOperatorUuid } from '@/utils/identity';
import { HeatPredictionTab } from '@/components/HeatPredictionTab';

type DashboardTabId =
  | 'uhi'
  | 'corridors'
  | 'walkability'
  | 'prediction'
  | 'moderation';

interface GovernmentDashboardProps {
  open: boolean;
  onClose: () => void;
  onFlyToMap: (coord: Coordinate, label?: string) => void;
  onModerationMutated: () => void;
}

export const GovernmentDashboard: React.FC<GovernmentDashboardProps> = ({
  open,
  onClose,
  onFlyToMap,
  onModerationMutated,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  const [activeTab, setActiveTab] = useState<DashboardTabId>('uhi');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [uhiData, setUhiData] = useState<UHIResponse | null>(null);
  const [corridors, setCorridors] = useState<PriorityCorridor[]>([]);
  const [walkability, setWalkability] = useState<WalkabilityStats | null>(null);
  const [warnings, setWarnings] = useState<WeatherWarningItem[]>([]);
  const [simulations, setSimulations] = useState<SimulationItem[]>([]);
  const [heatPrediction, setHeatPrediction] =
    useState<HeatPredictionResponse | null>(null);

  const [pendingReports, setPendingReports] = useState<IncidentReport[]>([]);
  const [allReports, setAllReports] = useState<IncidentReport[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<MapAlert[]>([]);
  const [draftDescriptions, setDraftDescriptions] = useState<
    Record<string, string>
  >({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>(
    {}
  );
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const loadAllDashboardData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [
        uhiRes,
        corridorsRes,
        walkRes,
        warnRes,
        simRes,
        predRes,
        pendingRes,
        allRepRes,
        alertsRes,
      ] = await Promise.all([
        fetchUHIHotspots(signal),
        fetchPriorityCorridors(signal),
        fetchWalkabilityStats(signal),
        fetchWeatherWarnings(signal).catch(() => []),
        fetchSimulations(signal).catch(() => []),
        fetchHeatPrediction(signal).catch(() => null),
        fetchPendingReports(signal).catch(() => []),
        fetchAllReports(undefined, signal).catch(() => []),
        fetchActiveMapAlerts(signal).catch(() => []),
      ]);

      if (signal?.aborted) return;
      setUhiData(uhiRes);
      setCorridors(corridorsRes.corridors);
      setWalkability(walkRes);
      setWarnings(warnRes);
      setSimulations(simRes);
      setHeatPrediction(predRes);
      setPendingReports(pendingRes);
      setAllReports(allRepRes);
      setActiveAlerts(alertsRes);

      const initialDrafts: Record<string, string> = {};
      for (const r of pendingRes) {
        initialDrafts[r.id] = r.description;
      }
      setDraftDescriptions((prev) => ({ ...initialDrafts, ...prev }));
    } catch (err) {
      if (!signal?.aborted) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Tidak dapat terhubung ke layanan analitik FastAPI.'
        );
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const detach = attachDialogLightDismiss(dlg);
    const handleClose = () => onClose();
    dlg.addEventListener('close', handleClose);
    return () => {
      detach();
      dlg.removeEventListener('close', handleClose);
    };
  }, [onClose]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  // Separate from the effect above: React Strict Mode re-runs effects, and the dialog
  // is already open on the second run, so loading there would never restart. The
  // timer means Strict Mode's throwaway first run never starts a fetch.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => void loadAllDashboardData(ctrl.signal));
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, loadAllDashboardData]);

  const handleApprove = async (report: IncidentReport) => {
    setBusyActionId(report.id);
    try {
      const finalDesc = (
        draftDescriptions[report.id] ?? report.description
      ).trim();
      await approveIncidentReport(
        report.id,
        getPemkotOperatorUuid(),
        finalDesc || report.description
      );
      await loadAllDashboardData();
      onModerationMutated();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyetujui laporan.'
      );
    } finally {
      setBusyActionId(null);
    }
  };

  const handleReject = async (report: IncidentReport) => {
    const reason = (
      rejectReasons[report.id] ?? 'Tidak terverifikasi di lokasi'
    ).trim();
    setBusyActionId(report.id);
    try {
      await rejectIncidentReport(
        report.id,
        getPemkotOperatorUuid(),
        reason || 'Tidak terverifikasi di lokasi'
      );
      await loadAllDashboardData();
      onModerationMutated();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menolak laporan.'
      );
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRetireAlert = async (alertId: string) => {
    setBusyActionId(alertId);
    try {
      await deleteMapAlertManual(alertId, getPemkotOperatorUuid());
      await loadAllDashboardData();
      onModerationMutated();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal mencabut alert peta.'
      );
    } finally {
      setBusyActionId(null);
    }
  };

  const handleInspectOnMap = (coord: Coordinate, label?: string) => {
    onClose();
    onFlyToMap(coord, label);
  };

  const TABS: Array<{
    id: DashboardTabId;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'uhi',
      label: 'UHI Hotspots',
      icon: <Flame className="h-3.5 w-3.5" />,
    },
    {
      id: 'corridors',
      label: 'Koridor Prioritas',
      icon: <Trees className="h-3.5 w-3.5" />,
    },
    {
      id: 'walkability',
      label: 'Akses Transit',
      icon: <Bus className="h-3.5 w-3.5" />,
    },
    {
      id: 'prediction',
      label: 'Simulasi Panas',
      icon: <Sparkles className="h-3.5 w-3.5" />,
    },
    {
      id: 'moderation',
      label: 'Moderasi TEDUH-Eye',
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      badge: pendingReports.length,
    },
  ];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="m-auto h-[92dvh] w-[calc(100dvw-1.25rem)] max-w-6xl overflow-hidden rounded-3xl bg-slate-50 shadow-2xl"
    >
      <div className="flex h-full flex-col">
        {/* Top Executive Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <p className="text-[11px] font-bold tracking-wide text-[#0E7C86] uppercase">
              Decision Support System • Pemerintah Kota Surabaya
            </p>
            <h2 id={titleId} className="text-base font-extrabold text-slate-900">
              Analitik Iklim Mikro, Koridor Penghijauan, & Moderasi Warga
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadAllDashboardData()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              <span>Muat Ulang</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Kembali ke Peta 3D"
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" />
              <span>Tutup</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-5 py-2">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-[#0E7C86] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 font-mono text-[10px] tabular-nums ${
                      active
                        ? 'bg-white text-[#0E7C86]'
                        : 'bg-amber-500 text-white'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-5">
          {errorMsg && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="font-bold underline"
              >
                Tutup
              </button>
            </div>
          )}

          {loading && !uhiData ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin text-[#0E7C86]" />
              <span>Mengambil data spasial...</span>
            </div>
          ) : (
            <>
              {/* TAB 1: UHI HOTSPOTS */}
              {activeTab === 'uhi' && (
                <div className="space-y-5">
                  {warnings.length > 0 && (
                    <div className="space-y-2">
                      {warnings.map((w, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <div>
                            <p className="font-bold">
                              [{w.severity.toUpperCase()}] {w.title}
                            </p>
                            <p className="mt-0.5 text-amber-800">
                              {w.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {uhiData && (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-medium text-slate-500">
                            Total Segmen Terpantau
                          </p>
                          <p className="mt-1 font-mono text-2xl font-extrabold text-slate-900 tabular-nums">
                            {uhiData.summary.total_segments.toLocaleString(
                              'id-ID'
                            )}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-medium text-slate-500">
                            Segmen Kritis (TCS &lt; 0.40)
                          </p>
                          <p className="mt-1 font-mono text-2xl font-extrabold text-red-700 tabular-nums">
                            {uhiData.summary.critical_segments.toLocaleString(
                              'id-ID'
                            )}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-medium text-slate-500">
                            Rata-Rata TCS Kota Surabaya
                          </p>
                          <p className="mt-1 font-mono text-2xl font-extrabold text-[#0E7C86] tabular-nums">
                            {uhiData.summary.avg_city_tcs.toFixed(3)}
                          </p>
                        </div>
                      </div>

                      {formatDataAsOf(uhiData.summary.data_as_of) && (
                        <p className="text-[11px] font-medium text-slate-800">
                          Data per {formatDataAsOf(uhiData.summary.data_as_of)}{' '}
                          WIB
                          {uhiData.summary.conditions_hour != null &&
                            ` · dinilai pada jam terpanas (${String(uhiData.summary.conditions_hour).padStart(2, '0')}:00 WIB)`}
                        </p>
                      )}

                      <div
                        tabIndex={0}
                        role="region"
                        aria-labelledby="uhi-table-caption"
                        className="table-wrapper"
                      >
                        <table
                          style={
                            {
                              '--label-2': '"Suhu Permukaan (Estimasi)"',
                              '--label-3': '"Rasio Teduh"',
                              '--label-4': '"Skor TCS"',
                              '--label-5': '"Lokasi 3D"',
                            } as React.CSSProperties
                          }
                          className="text-left text-xs"
                        >
                          <caption id="uhi-table-caption" className="sr-only">
                            Daftar titik panas Urban Heat Island Kota Surabaya
                          </caption>
                          <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600">
                            <tr>
                              <th className="border-b border-slate-200 px-4 py-2.5">
                                Nama Jalan / Segmen
                              </th>
                              <th className="border-b border-slate-200 px-4 py-2.5">
                                Suhu Permukaan (Estimasi)
                              </th>
                              <th className="border-b border-slate-200 px-4 py-2.5">
                                Rasio Teduh
                              </th>
                              <th className="border-b border-slate-200 px-4 py-2.5">
                                Skor TCS
                              </th>
                              <th className="border-b border-slate-200 px-4 py-2.5 text-right">
                                Inspeksi Peta
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {uhiData.hotspots.map((h) => {
                              const center = extractGeometryCenter(h.geometry);
                              const grade = getTcsGrade(h.avg_tcs);
                              const name =
                                h.street_name || `Segmen #${h.segment_id}`;
                              return (
                                <tr
                                  key={h.segment_id}
                                  className="hover:bg-slate-50/80"
                                >
                                  <th
                                    scope="row"
                                    className="px-4 py-2.5 font-semibold text-slate-900"
                                  >
                                    <div>{name}</div>
                                    <div className="font-mono text-[10px] font-normal text-slate-400">
                                      Segmen #{h.segment_id}
                                    </div>
                                  </th>
                                  <td className="px-4 py-2.5 font-mono font-semibold text-orange-700 tabular-nums">
                                    {h.avg_lst.toFixed(1)}°C
                                  </td>
                                  <td className="px-4 py-2.5 font-mono text-slate-600 tabular-nums">
                                    {Math.round(h.shade_ratio * 100)}%
                                  </td>
                                  <td className="px-4 py-2.5 font-mono tabular-nums">
                                    <span
                                      className="rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
                                      style={{ backgroundColor: grade.color }}
                                    >
                                      {h.avg_tcs.toFixed(3)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right">
                                    {center && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleInspectOnMap(center, name)
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-teal-50 hover:text-[#0E7C86]"
                                      >
                                        <MapPin className="h-3 w-3" />
                                        <span>Lihat di Peta</span>
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* TAB 2: PRIORITY CORRIDORS */}
              {activeTab === 'corridors' && (
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="corridors-caption"
                  className="table-wrapper"
                >
                  <table
                    style={
                      {
                        '--label-2': '"Skor Prioritas"',
                        '--label-3': '"Rata-Rata TCS"',
                        '--label-4': '"Akses Transit"',
                        '--label-5': '"Halte Terdekat"',
                        '--label-6': '"Rekomendasi Teknis"',
                      } as React.CSSProperties
                    }
                    className="text-left text-xs"
                  >
                    <caption id="corridors-caption" className="sr-only">
                      Peringkat koridor prioritas penghijauan Kota Surabaya
                    </caption>
                    <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <tr>
                        <th className="border-b border-slate-200 px-4 py-2.5">
                          Koridor Jalan
                        </th>
                        <th className="border-b border-slate-200 px-4 py-2.5">
                          Skor Prioritas
                        </th>
                        <th className="border-b border-slate-200 px-4 py-2.5">
                          Rata-Rata TCS
                        </th>
                        <th className="border-b border-slate-200 px-4 py-2.5">
                          Akses Transit
                        </th>
                        <th className="border-b border-slate-200 px-4 py-2.5">
                          Halte Terdekat
                        </th>
                        <th className="border-b border-slate-200 px-4 py-2.5">
                          Rekomendasi Intervensi Fisik
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {corridors.map((c, idx) => {
                        const grade = getTcsGrade(c.avg_tcs);
                        return (
                          <tr
                            key={`${c.corridor_name}-${idx}`}
                            className="hover:bg-slate-50/80"
                          >
                            <th
                              scope="row"
                              className="px-4 py-3 font-semibold text-slate-900"
                            >
                              <div>{c.corridor_name}</div>
                              <div className="text-[10px] font-normal text-slate-400">
                                {c.segments.length} segmen terhubung
                              </div>
                            </th>
                            <td className="px-4 py-3 font-mono font-extrabold text-slate-900 tabular-nums">
                              {c.priority_score.toFixed(3)}
                            </td>
                            <td className="px-4 py-3 font-mono tabular-nums">
                              <span
                                className="rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
                                style={{ backgroundColor: grade.color }}
                              >
                                {c.avg_tcs.toFixed(3)}
                              </span>
                            </td>
                            <td className="px-4 py-3 capitalize text-slate-700">
                              {c.transit_access === 'high'
                                ? 'Tinggi'
                                : c.transit_access === 'medium'
                                  ? 'Sedang'
                                  : 'Rendah'}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {c.nearest_transit ?? '—'}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-800">
                              {c.recommendation}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB 3: WALKABILITY & TRANSIT ACCESS */}
              {activeTab === 'walkability' && walkability && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Total Titik Halte / Transit Surabaya
                    </p>
                    <p className="mt-2 font-mono text-3xl font-extrabold text-slate-900 tabular-nums">
                      {walkability.total_transit_stops.toLocaleString('id-ID')}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Suroboyo Bus, WiraWiri, & simpul angkutan umum
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Halte Berlingkungan Nyaman (TCS &gt; 0.55, radius ±780 m)
                    </p>
                    <p className="mt-2 font-mono text-3xl font-extrabold text-emerald-700 tabular-nums">
                      {walkability.comfortable_stops.toLocaleString(
                        'id-ID'
                      )}{' '}
                      <span className="text-base font-bold text-slate-500">
                        ({walkability.comfortable_percentage}%
                        {walkability.conditions_hour != null && ' saat jam terpanas'})
                      </span>
                    </p>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{
                          width: `${Math.min(100, walkability.comfortable_percentage)}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Indeks TCS Kota (24 Jam Terakhir)
                    </p>
                    <p className="mt-2 font-mono text-3xl font-extrabold text-[#0E7C86] tabular-nums">
                      {walkability.avg_tcs_city.toFixed(3)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Standar akses nyaman: rata-rata koridor &gt; 0.55 dalam
                      radius 750 m
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 4: HEAT PREDICTION & SIMULATIONS */}
              {activeTab === 'prediction' && (
                <HeatPredictionTab
                  prediction={heatPrediction}
                  simulations={simulations}
                  onFlyToMap={handleInspectOnMap}
                />
              )}

              {/* TAB 5: TEDUH-EYE MODERATION */}
              {activeTab === 'moderation' && (
                <div className="space-y-6">
                  {/* Pending Queue */}
                  <div>
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      Antrean Verifikasi Laporan Warga ({pendingReports.length})
                    </h3>

                    {pendingReports.length === 0 ? (
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                        Tidak ada laporan berstatus{' '}
                        <code className="font-mono">PENDING_REVIEW</code> saat
                        ini.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {pendingReports.map((rep) => {
                          const busy = busyActionId === rep.id;
                          return (
                            <div
                              key={rep.id}
                              className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 uppercase">
                                    {rep.category} • {rep.severity ?? 'MEDIUM'}
                                  </span>
                                  {rep.ai_suggested && (
                                    <span className="ml-1.5 inline-block rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-[#0E7C86]">
                                      AI{' '}
                                      {rep.ai_confidence
                                        ? `${Math.round(rep.ai_confidence * 100)}%`
                                        : ''}
                                    </span>
                                  )}
                                  <p className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                                    {rep.lat.toFixed(5)}, {rep.lon.toFixed(5)}
                                    {rep.segment_id
                                      ? ` • Segmen #${rep.segment_id}`
                                      : ''}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleInspectOnMap(
                                      { lat: rep.lat, lng: rep.lon },
                                      rep.description
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  <MapPin className="h-3 w-3 text-[#0E7C86]" />
                                  <span>Peta</span>
                                </button>
                              </div>

                              <div>
                                <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                                  Deskripsi Publik (dapat disunting sebelum
                                  dipublikasikan)
                                </label>
                                <textarea
                                  rows={2}
                                  value={
                                    draftDescriptions[rep.id] ?? rep.description
                                  }
                                  onChange={(e) =>
                                    setDraftDescriptions((prev) => ({
                                      ...prev,
                                      [rep.id]: e.target.value,
                                    }))
                                  }
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 focus:border-[#0E7C86] focus:bg-white focus:outline-none"
                                />
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  value={rejectReasons[rep.id] ?? ''}
                                  onChange={(e) =>
                                    setRejectReasons((prev) => ({
                                      ...prev,
                                      [rep.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Alasan tolak (opsional)..."
                                  className="min-w-36 flex-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700"
                                />
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleReject(rep)}
                                  className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  <span>Tolak</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleApprove(rep)}
                                  className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  <span>Setujui & Tayangkan</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Active Map Alerts Management */}
                  <div>
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      Pin Peringatan Aktif di Peta Publik ({activeAlerts.length})
                    </h3>
                    {activeAlerts.length === 0 ? (
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-500">
                        Belum ada pin peringatan aktif di peta.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                        {activeAlerts.map((al) => (
                          <div
                            key={al.id}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900">
                                {al.category.toUpperCase()} •{' '}
                                {al.severity ?? 'MEDIUM'}
                              </p>
                              <p className="mt-0.5 truncate text-slate-600">
                                {al.description}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  handleInspectOnMap(
                                    { lat: al.lat, lng: al.lon },
                                    al.description
                                  )
                                }
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                                title="Lihat di Peta"
                              >
                                <MapPin className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={busyActionId === al.id}
                                onClick={() => void handleRetireAlert(al.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>Cabut</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Historical Log Summary */}
                  {allReports.length > 0 && (
                    <details className="rounded-2xl border border-slate-200 bg-white text-xs">
                      <summary className="cursor-pointer px-4 py-3 font-bold text-slate-800">
                        Arsip Seluruh Laporan Masuk ({allReports.length})
                      </summary>
                      <div className="divide-y divide-slate-100 border-t border-slate-100 px-4 py-1">
                        {allReports.slice(0, 25).map((r) => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between gap-2 py-2"
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-slate-800">
                                [{r.status}]
                              </span>{' '}
                              <span className="text-slate-600">
                                {r.final_description || r.description}
                              </span>
                            </div>
                            <span className="shrink-0 font-mono text-[10px] text-slate-400">
                              {new Date(r.created_at).toLocaleDateString(
                                'id-ID'
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
};

