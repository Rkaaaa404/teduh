'use client';

import React, { useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Flame,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import type { MapLayerMode } from '@/types';

interface TCSLegendProps {
  mode: MapLayerMode;
  onModeChange: (mode: MapLayerMode) => void;
  segmentCount: number;
  loadingSegments: boolean;
  offsetForPip?: boolean;
}

const TCS_GRADES = [
  { color: '#1F8A5B', range: '≥ 0.70', label: 'Teduh & nyaman' },
  { color: '#D9822B', range: '0.50 – 0.69', label: 'Cukup hangat' },
  { color: '#D9532F', range: '0.35 – 0.49', label: 'Panas terik' },
  { color: '#B42318', range: '< 0.35', label: 'Panas ekstrem' },
];

export const TCSLegend: React.FC<TCSLegendProps> = ({
  mode,
  onModeChange,
  segmentCount,
  loadingSegments,
  offsetForPip = false,
}) => {
  const [expanded, setExpanded] = useState<boolean>(true);

  return (
    <aside
      aria-label="Mode visualisasi dan legenda peta"
      className={`hud-surface pointer-events-auto absolute right-3 z-20 hidden w-64 rounded-2xl p-2.5 transition-all duration-200 lg:block ${
        offsetForPip ? 'bottom-64' : 'bottom-5'
      }`}
    >
      {/* Layer Mode Segmented Switcher */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-[11px] font-semibold">
        <button
          type="button"
          onClick={() => onModeChange('tcs')}
          className={`flex items-center justify-center gap-1 rounded-lg py-1.5 transition-all ${
            mode === 'tcs'
              ? 'bg-white text-[#0E7C86] shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>TCS</span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange('uhi')}
          className={`flex items-center justify-center gap-1 rounded-lg py-1.5 transition-all ${
            mode === 'uhi'
              ? 'bg-white text-orange-600 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Flame className="h-3.5 w-3.5" />
          <span>UHI</span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange('realistic')}
          className={`flex items-center justify-center gap-1 rounded-lg py-1.5 transition-all ${
            mode === 'realistic'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span>3D Kota</span>
        </button>
      </div>

      {/* Header + Collapse Button */}
      <div className="mt-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
          <span>
            {mode === 'tcs'
              ? 'Indeks Kenyamanan Termal'
              : mode === 'uhi'
                ? 'Sebaran Suhu Udara (UHI)'
                : 'Model Kota 3D Surabaya'}
          </span>
          {loadingSegments && (
            <Loader2 className="h-3 w-3 animate-spin text-[#0E7C86]" />
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Sembunyikan legenda' : 'Tampilkan legenda'}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 border-t border-slate-100 pt-2 text-xs">
          {mode === 'tcs' && (
            <>
              <div className="space-y-1.5">
                {TCS_GRADES.map((g) => (
                  <div
                    key={g.range}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-5 rounded-full"
                        style={{ backgroundColor: g.color }}
                      />
                      <span className="font-medium text-slate-700">
                        {g.label}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                      {g.range}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Menampilkan{' '}
                <strong className="font-mono text-slate-700 tabular-nums">
                  {segmentCount.toLocaleString('id-ID')}
                </strong>{' '}
                segmen jalan dari PostGIS pada area pandang aktif.
              </p>
            </>
          )}

          {mode === 'uhi' && (
            <div>
              <div className="h-2.5 w-full rounded-full bg-gradient-to-r from-sky-500 via-emerald-500 via-amber-500 to-red-700" />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500 tabular-nums">
                <span>29°C</span>
                <span>33°C</span>
                <span>36°C</span>
                <span>≥38°C</span>
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">
                Berdasarkan suhu terasa (<em>apparent temperature</em>) segmen
                terkini di Surabaya.
              </p>
            </div>
          )}

          {mode === 'realistic' && (
            <p className="text-[11px] leading-relaxed text-slate-600">
              Mode arsitektur bersih untuk inspeksi koridor jalan, ekstrusi
              gedung 3D, arah datang cahaya matahari, dan pantauan CCTV Dishub.
            </p>
          )}
        </div>
      )}
    </aside>
  );
};
