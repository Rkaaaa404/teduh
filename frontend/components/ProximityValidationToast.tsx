'use client';

import React, { useState } from 'react';
import { MapPin, X } from 'lucide-react';
import type { MapAlert } from '@/types';
import { submitAlertValidation } from '@/services/api';
import { getPedestrianUserUuid } from '@/utils/identity';

interface ProximityValidationToastProps {
  alert: MapAlert;
  distanceMeters: number;
  onDismiss: () => void;
  onValidated: () => void;
}

export const ProximityValidationToast: React.FC<
  ProximityValidationToastProps
> = ({ alert, distanceMeters, onDismiss, onValidated }) => {
  const [busy, setBusy] = useState<boolean>(false);

  const sendResponse = async (choice: 'still_active' | 'no_longer_active') => {
    setBusy(true);
    try {
      await submitAlertValidation(alert.id, choice, getPedestrianUserUuid());
      onValidated();
      onDismiss();
    } catch {
      onDismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="hud-surface-dark pointer-events-auto absolute top-28 left-1/2 z-30 flex w-[calc(100dvw-1.5rem)] max-w-sm -translate-x-1/2 flex-col gap-2.5 rounded-2xl p-3.5 text-xs text-white"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
            <MapPin className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="font-bold text-white">
              Anda {Math.round(distanceMeters)} m dari titik laporan
            </p>
            <p className="line-clamp-1 text-[11px] text-slate-300">
              {alert.description}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Tutup notifikasi validasi"
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => sendResponse('still_active')}
          className="rounded-xl bg-[#0E7C86] py-1.5 font-bold text-white hover:bg-[#0A5E66] disabled:opacity-50"
        >
          Masih Aktif
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => sendResponse('no_longer_active')}
          className="rounded-xl bg-slate-800 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          Sudah Teratasi
        </button>
      </div>
    </div>
  );
};

