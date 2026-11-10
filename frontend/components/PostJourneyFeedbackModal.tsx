'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  CheckCircle2,
  Footprints,
  Loader2,
  MessageSquare,
  Star,
  Sun,
  Trees,
  X,
} from 'lucide-react';
import { submitJourneyFeedback } from '@/services/api';
import { attachDialogLightDismiss } from '@/utils/geoMath';
import { getPedestrianUserUuid } from '@/utils/identity';

interface PostJourneyFeedbackModalProps {
  open: boolean;
  predictedTcs: number | null;
  onClose: () => void;
  onRequestIncidentReport: () => void;
}

function StarRatingCard({
  label,
  value,
  onChange,
  icon: Icon,
  iconColor,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
        <span className="flex items-center gap-2">
          <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
          {label}
        </span>
        <span className="font-mono text-xs font-bold text-slate-600 tabular-nums">
          {value} / 5
        </span>
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${label}: ${n} dari 5 bintang`}
            className="rounded p-1 transition-transform hover:scale-115 focus-visible:outline-2 focus-visible:outline-[#0E7C86]"
          >
            <Star
              className={`h-5 w-5 transition-colors ${
                n <= value
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-slate-300 hover:text-amber-200'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export const PostJourneyFeedbackModal: React.FC<
  PostJourneyFeedbackModalProps
> = ({ open, predictedTcs, onClose, onRequestIncidentReport }) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  const [ratingThermal, setRatingThermal] = useState<number>(4);
  const [ratingShade, setRatingShade] = useState<number>(4);
  const [ratingWalkway, setRatingWalkway] = useState<number>(4);
  const [hasUnreported, setHasUnreported] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [done, setDone] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const detach = attachDialogLightDismiss(dlg);
    const onNativeClose = () => onClose();
    dlg.addEventListener('close', onNativeClose);
    return () => {
      detach();
      dlg.removeEventListener('close', onNativeClose);
    };
  }, [onClose]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setDone(false);
      setErrorMsg(null);
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await submitJourneyFeedback({
        user_id: getPedestrianUserUuid(),
        route_id: null,
        tcs_predicted: predictedTcs,
        rating_thermal: ratingThermal,
        rating_shade: ratingShade,
        rating_walkway: ratingWalkway,
        has_unreported: hasUnreported,
        notes: notes.trim() || null,
      });
      setDone(true);
      if (hasUnreported) {
        window.setTimeout(() => {
          onClose();
          onRequestIncidentReport();
        }, 800);
      } else {
        window.setTimeout(() => {
          onClose();
        }, 1000);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyimpan evaluasi.'
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
      className="m-auto w-[calc(100dvw-1.5rem)] max-w-md rounded-2xl bg-transparent p-0 shadow-2xl"
    >
      <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header Bar */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-sm font-bold text-slate-900">
              Evaluasi Kenyamanan Perjalanan
            </h2>
            <p className="mt-0.5 text-xs font-normal text-slate-600">
              Data Anda mengkalibrasi bobot Thermal Comfort Score (TCS) kota.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog evaluasi"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        {done ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <h3 className="text-base font-bold text-slate-900">
              Terima kasih atas kontribusi Anda!
            </h3>
            <p className="text-xs text-slate-600">
              Ulasan Anda membantu pejalan kaki Surabaya mendapatkan rute paling teduh.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
            {/* 3 Rating Cards */}
            <div className="space-y-2.5">
              <StarRatingCard
                label="Kenyamanan Suhu Udara"
                value={ratingThermal}
                onChange={setRatingThermal}
                icon={Sun}
                iconColor="text-amber-500"
              />
              <StarRatingCard
                label="Keteduhan Pohon & Kanopi Bangunan"
                value={ratingShade}
                onChange={setRatingShade}
                icon={Trees}
                iconColor="text-teal-600"
              />
              <StarRatingCard
                label="Kemulusan & Kelayakan Trotoar"
                value={ratingWalkway}
                onChange={setRatingWalkway}
                icon={Footprints}
                iconColor="text-sky-600"
              />
            </div>

            {/* Checkbox for unreported obstacle */}
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100">
              <input
                type="checkbox"
                checked={hasUnreported}
                onChange={(e) => setHasUnreported(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0E7C86] focus:ring-[#0E7C86]"
              />
              <span>
                Saya menemukan kendala trotoar yang belum tercatat di peta
              </span>
            </label>

            {/* Notes textarea */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="feedback-notes"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
              >
                <MessageSquare className="h-3.5 w-3.5 text-slate-500" />
                <span>Catatan tambahan (opsional)</span>
              </label>
              <textarea
                id="feedback-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Contoh: Kanopi halte sangat sejuk, galian kabel tertutup rapi..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 placeholder:text-slate-500 focus:border-[#0E7C86] focus:bg-white focus:ring-1 focus:ring-[#0E7C86] focus:outline-none"
              />
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                {errorMsg}
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                Lewati
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0E7C86] px-4 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:bg-[#0A5E66] active:bg-[#08484E] disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>
                  {hasUnreported ? 'Simpan & Lapor Kendala' : 'Kirim Evaluasi'}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
};

