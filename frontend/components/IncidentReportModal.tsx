'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  CheckCircle2,
  Crosshair,
  Flag,
  Loader2,
  MapPin,
  X,
} from 'lucide-react';
import type {
  Coordinate,
  IncidentCategory,
  IncidentSeverity,
} from '@/types';
import { reverseGeocodeSurabaya, submitManualReport } from '@/services/api';
import { attachDialogLightDismiss } from '@/utils/geoMath';

interface IncidentReportModalProps {
  open: boolean;
  coordinate: Coordinate;
  onClose: () => void;
  onPickCoordinateOnMap: () => void;
  onSubmitted: () => void;
}

const CATEGORIES: Array<{ value: IncidentCategory; label: string }> = [
  { value: 'construction', label: 'Proyek / galian trotoar' },
  { value: 'damaged', label: 'Trotoar rusak / berlubang' },
  { value: 'road_closed', label: 'Jalur tertutup / terhalang' },
  { value: 'flood', label: 'Genangan air / banjir' },
  { value: 'heat', label: 'Titik gersang / panas ekstrem' },
  { value: 'accident', label: 'Insiden lalu lintas' },
];

const SEVERITIES: Array<{ value: IncidentSeverity; label: string }> = [
  { value: 'LOW', label: 'Ringan' },
  { value: 'MEDIUM', label: 'Sedang' },
  { value: 'HIGH', label: 'Tinggi' },
  { value: 'CRITICAL', label: 'Kritis' },
];

export const IncidentReportModal: React.FC<IncidentReportModalProps> = ({
  open,
  coordinate,
  onClose,
  onPickCoordinateOnMap,
  onSubmitted,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  const [category, setCategory] = useState<IncidentCategory>('damaged');
  const [severity, setSeverity] = useState<IncidentSeverity>('MEDIUM');
  const [description, setDescription] = useState<string>('');
  const [streetLabel, setStreetLabel] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successDone, setSuccessDone] = useState<boolean>(false);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const detach = attachDialogLightDismiss(dlg);
    const handleNativeClose = () => onClose();
    dlg.addEventListener('close', handleNativeClose);
    return () => {
      detach();
      dlg.removeEventListener('close', handleNativeClose);
    };
  }, [onClose]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setErrorMsg(null);
      setSuccessDone(false);
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    reverseGeocodeSurabaya(coordinate.lat, coordinate.lng, ctrl.signal).then(
      (label) => {
        if (!ctrl.signal.aborted) setStreetLabel(label);
      }
    );
    return () => ctrl.abort();
  }, [open, coordinate.lat, coordinate.lng]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 8) {
      setErrorMsg('Mohon tuliskan deskripsi kondisi minimal 8 karakter.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await submitManualReport({
        lat: coordinate.lat,
        lon: coordinate.lng,
        category,
        severity,
        description: description.trim(),
        image_url: null,
      });
      setSuccessDone(true);
      setDescription('');
      onSubmitted();
      window.setTimeout(() => {
        onClose();
      }, 1100);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal mengirim laporan.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="m-auto w-[calc(100dvw-1.5rem)] max-w-md rounded-2xl bg-white shadow-2xl"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-200">
              <Flag className="h-4 w-4" />
            </span>
            <div>
              <h2 id={titleId} className="text-sm font-bold text-slate-900">
                Lapor Kendala Jalur (TEDUH-Eye)
              </h2>
              <p className="text-xs text-slate-500">
                Laporan ditinjau operator Pemkot sebelum tampil di peta publik.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog laporan"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {successDone ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="text-sm font-bold text-slate-900">
              Laporan berhasil dikirim ke antrean moderasi
            </p>
            <p className="text-xs text-slate-500">
              Koordinat otomatis di-snap ke segmen jalan terdekat di PostGIS.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
            {/* Coordinate & Pick on Map */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs">
              <div className="flex items-start gap-2 min-w-0">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0E7C86]" />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800">
                    {streetLabel || 'Memuat nama jalan...'}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {coordinate.lat.toFixed(5)}, {coordinate.lng.toFixed(5)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onPickCoordinateOnMap}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Crosshair className="h-3.5 w-3.5 text-[#0E7C86]" />
                <span>Pilih di Peta</span>
              </button>
            </div>

            {/* Category */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Kategori Kendala
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {CATEGORIES.map((cat) => {
                  const active = category === cat.value;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setCategory(cat.value)}
                      className={`rounded-xl border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                        active
                          ? 'border-[#0E7C86] bg-teal-50/70 font-semibold text-slate-900 ring-1 ring-[#0E7C86]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Severity */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Tingkat Dampak bagi Pejalan Kaki
              </label>
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 text-xs">
                {SEVERITIES.map((sev) => (
                  <button
                    key={sev.value}
                    type="button"
                    onClick={() => setSeverity(sev.value)}
                    className={`rounded-lg py-1.5 font-semibold transition-all ${
                      severity === sev.value
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {sev.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="incident-desc"
                className="mb-1 block text-xs font-semibold text-slate-700"
              >
                Deskripsi Faktual di Lapangan
              </label>
              <textarea
                id="incident-desc"
                rows={3}
                required
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contoh: Penutup saluran air terbuka selebar 60 cm di sisi timur trotoar..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0E7C86] focus:bg-white focus:outline-none"
              />
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {errorMsg}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-xl bg-[#0E7C86] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A5E66] disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Kirim Laporan</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
};

