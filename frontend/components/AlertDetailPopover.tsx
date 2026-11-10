'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import type { AlertValidationStats, Coordinate, MapAlert } from '@/types';
import {
  fetchAlertValidationStats,
  submitAlertValidation,
} from '@/services/api';
import { haversineDistanceMeters } from '@/utils/geoMath';
import { getPedestrianUserUuid } from '@/utils/identity';

interface AlertDetailPopoverProps {
  alert: MapAlert | null;
  userLocation: Coordinate | null;
  onClose: () => void;
  onValidated: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  construction: 'Proyek / Galian Trotoar',
  road_closed: 'Jalur Tertutup',
  damaged: 'Trotoar Rusak',
  flood: 'Genangan / Banjir',
  heat: 'Zona Terik Ekstrem',
  accident: 'Insiden Lalu Lintas',
};

function AlertDetailContent({
  alert,
  userLocation,
  onClose,
  onValidated,
}: {
  alert: MapAlert;
  userLocation: Coordinate | null;
  onClose: () => void;
  onValidated: () => void;
}) {
  const [stats, setStats] = useState<AlertValidationStats | null>(null);
  const [loadingStats, setLoadingStats] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [votedMessage, setVotedMessage] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchAlertValidationStats(alert.id, ctrl.signal)
      .then((res) => {
        if (!ctrl.signal.aborted) setStats(res);
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setLoadingStats(false);
      });
    return () => ctrl.abort();
  }, [alert.id]);

  const distanceM = userLocation
    ? Math.round(
        haversineDistanceMeters(userLocation, {
          lat: alert.lat,
          lng: alert.lon,
        })
      )
    : null;

  const handleVote = async (choice: 'still_active' | 'no_longer_active') => {
    setSubmitting(true);
    try {
      const res = await submitAlertValidation(
        alert.id,
        choice,
        getPedestrianUserUuid()
      );
      if (res.validation_summary.auto_removed) {
        setVotedMessage(
          'Mayoritas warga menyatakan kendala sudah selesai — pin dinonaktifkan otomatis.'
        );
      } else {
        setVotedMessage('Terima kasih, validasi Anda telah tercatat.');
      }
      const updated = await fetchAlertValidationStats(alert.id);
      setStats(updated);
      onValidated();
    } catch (err) {
      setVotedMessage(
        err instanceof Error ? err.message : 'Gagal mengirim validasi.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const activePct =
    stats && stats.still_active_pct !== null
      ? Math.round(stats.still_active_pct * 100)
      : null;

  return (
    <aside
      aria-label="Detail peringatan jalur pejalan kaki"
      className="hud-surface pointer-events-auto absolute top-20 right-16 z-30 w-80 rounded-2xl p-4 text-xs shadow-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <p className="font-bold text-slate-900">
              {CATEGORY_LABELS[alert.category] ?? alert.category}
            </p>
            <p className="font-mono text-[10px] text-slate-500 tabular-nums">
              {alert.severity ?? 'MEDIUM'}
              {distanceM !== null ? ` • ${distanceM} m dari Anda` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup detail alert"
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mt-2.5 leading-relaxed text-slate-700">
        {alert.description}
      </p>

      <div className="mt-3 rounded-xl border border-slate-200/90 bg-slate-50 p-2.5">
        {loadingStats ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0E7C86]" />
            <span>Memuat konsensus warga...</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-700">
                Konfirmasi Warga
              </span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                {activePct === null
                  ? 'Belum ada validasi'
                  : `${stats?.total_validations ?? 0} suara (${activePct}% aktif)`}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[#0E7C86] transition-all"
                style={{ width: `${activePct ?? 0}%` }}
              />
            </div>
          </>
        )}
      </div>

      {votedMessage ? (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-xl bg-emerald-50 px-2.5 py-2 text-[11px] font-medium text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>{votedMessage}</span>
        </div>
      ) : (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-700">
            Apakah kendala ini masih ada di lokasi?
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleVote('still_active')}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white py-1.5 font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              <ThumbsUp className="h-3.5 w-3.5 text-[#0E7C86]" />
              <span>Masih Ada</span>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleVote('no_longer_active')}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white py-1.5 font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              <ThumbsDown className="h-3.5 w-3.5 text-slate-600" />
              <span>Sudah Bersih</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

export const AlertDetailPopover: React.FC<AlertDetailPopoverProps> = (
  props
) => {
  if (!props.alert) return null;
  return (
    <AlertDetailContent
      key={props.alert.id}
      alert={props.alert}
      userLocation={props.userLocation}
      onClose={props.onClose}
      onValidated={props.onValidated}
    />
  );
};
