'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Star, X } from 'lucide-react';
import { submitJourneyFeedback } from '@/services/api';
import { attachDialogLightDismiss } from '@/utils/geoMath';
import { getPedestrianUserUuid } from '@/utils/identity';

interface PostJourneyFeedbackModalProps {
  open: boolean;
  predictedTcs: number | null;
  onClose: () => void;
  onRequestIncidentReport: () => void;
}

function StarRatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${label}: ${n} dari 5`}
            className="rounded p-0.5 transition-transform hover:scale-110"
          >
            <Star
              className={`h-5 w-5 ${
                n <= value
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-slate-300'
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
      className="m-auto w-[calc(100dvw-1.5rem)] max-w-md rounded-2xl bg-white shadow-2xl"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 id={titleId} className="text-sm font-bold text-slate-900">
              Evaluasi Kenyamanan Perjalanan
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Data Anda mengkalibrasi bobot Thermal Comfort Score (TCS) kota.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lewati evaluasi"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="text-sm font-bold text-slate-900">
              Terima kasih atas kontribusi Anda!
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <StarRatingRow
                label="Kenyamanan suhu udara"
                value={ratingThermal}
                onChange={setRatingThermal}
              />
              <StarRatingRow
                label="Keteduhan pohon / bangunan"
                value={ratingShade}
                onChange={setRatingShade}
              />
              <StarRatingRow
                label="Kemulusan & kelayakan trotoar"
                value={ratingWalkway}
                onChange={setRatingWalkway}
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={hasUnreported}
                onChange={(e) => setHasUnreported(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0E7C86]"
              />
              <span>
                Saya menemukan kendala trotoar yang belum tercatat di peta
              </span>
            </label>

            <div>
              <label
                htmlFor="feedback-notes"
                className="mb-1 block text-xs font-semibold text-slate-700"
              >
                Catatan tambahan (opsional)
              </label>
              <textarea
                id="feedback-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Masukan kondisi jalur bagi pejalan kaki..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 focus:border-[#0E7C86] focus:bg-white focus:outline-none"
              />
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {errorMsg}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Lewati
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-xl bg-[#0E7C86] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A5E66] disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>
                  {hasUnreported ? 'Simpan & Laporkan Kendala' : 'Kirim Evaluasi'}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
};

