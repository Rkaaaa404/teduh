'use client';

import React from 'react';
import Image from 'next/image';
import { BarChart3, Flag, Map as MapIcon } from 'lucide-react';

interface NavbarProps {
  activePanel: 'map' | 'dashboard';
  onChangePanel: (panel: 'map' | 'dashboard') => void;
  pendingReportsCount: number;
  backendOnline: boolean | null;
  onOpenReportModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activePanel,
  onChangePanel,
  pendingReportsCount,
  backendOnline,
  onOpenReportModal,
}) => {
  return (
    <header className="pointer-events-none absolute top-3 left-1/2 z-30 flex w-max max-w-[calc(100dvw-1.25rem)] -translate-x-1/2 items-center">
      <nav
        aria-label="Navigasi utama TEDUH"
        className="hud-surface pointer-events-auto flex items-center gap-1.5 rounded-full p-1 pl-2.5"
      >
        {/* Brand Identity */}
        <div className="flex items-center gap-2 pr-1.5">
          <Image
            src="/Logo_Teduh.png"
            alt="Logo TEDUH"
            width={24}
            height={24}
            className="h-6 w-6 rounded-full object-contain"
            priority
          />
          <div className="hidden items-center gap-1.5 sm:flex">
            <span className="text-xs font-extrabold tracking-tight text-slate-900">
              TEDUH
            </span>
            <span className="text-[11px] font-medium text-slate-500">
              Surabaya
            </span>
          </div>
          <span
            role="status"
            aria-label={
              backendOnline === null
                ? 'Memeriksa status API'
                : backendOnline
                  ? 'API Backend terhubung'
                  : 'API Backend tidak terjangkau'
            }
            title={
              backendOnline === null
                ? 'Memeriksa status API...'
                : backendOnline
                  ? 'Terhubung ke FastAPI & PostGIS'
                  : 'API Backend tidak terjangkau (localhost:8000)'
            }
            className={`h-2 w-2 rounded-full ${
              backendOnline === null
                ? 'bg-amber-400 animate-pulse'
                : backendOnline
                  ? 'bg-emerald-500'
                  : 'bg-red-500'
            }`}
          />
        </div>

        <div className="h-4 w-px bg-slate-200" />

        {/* View Switcher */}
        <div className="flex items-center gap-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => onChangePanel('map')}
            aria-pressed={activePanel === 'map'}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
              activePanel === 'map'
                ? 'bg-[#0E7C86] text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <MapIcon aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Peta 3D</span>
          </button>

          <button
            type="button"
            onClick={() => onChangePanel('dashboard')}
            aria-pressed={activePanel === 'dashboard'}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
              activePanel === 'dashboard'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <BarChart3 aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Pemkot</span>
            {pendingReportsCount > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.2 font-mono text-[10px] font-bold text-white tabular-nums">
                {pendingReportsCount}
              </span>
            )}
          </button>
        </div>

        <div className="h-4 w-px bg-slate-200" />

        {/* Quick Incident Report Trigger */}
        <button
          type="button"
          onClick={onOpenReportModal}
          aria-label="Lapor Jalur — Laporkan kendala jalur pejalan kaki"
          title="Laporkan kendala jalur pejalan kaki (TEDUH-Eye)"
          className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200/80 transition-colors hover:bg-amber-100"
        >
          <Flag aria-hidden="true" className="h-3.5 w-3.5 text-amber-600" />
          <span className="hidden md:inline">Lapor Jalur</span>
        </button>
      </nav>
    </header>
  );
};
