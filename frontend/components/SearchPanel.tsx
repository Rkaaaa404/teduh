'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  HeatTolerance,
  NominatimSearchResult,
  PlacePoint,
} from '@/types';
import type { MapPickTarget } from '@/components/MapView';
import { searchPlacesSurabaya } from '@/services/api';

interface SearchPanelProps {
  origin: PlacePoint | null;
  destination: PlacePoint | null;
  tolerance: HeatTolerance;
  pickTarget: MapPickTarget;
  loadingRoute: boolean;
  errorMessage: string | null;
  hidden?: boolean;
  onSelectOrigin: (point: PlacePoint | null) => void;
  onSelectDestination: (point: PlacePoint | null) => void;
  onSwapPoints: () => void;
  onClearAll: () => void;
  onToleranceChange: (t: HeatTolerance) => void;
  onPickTargetChange: (target: MapPickTarget) => void;
  onUseMyGpsForOrigin: () => void;
  onSubmitRoute: () => void;
}

const TOLERANCE_OPTIONS: Array<{
  value: HeatTolerance;
  title: string;
  budget: string;
}> = [
  { value: 'low', title: 'Rendah', budget: 'Maks 8 mnt' },
  { value: 'medium', title: 'Sedang', budget: 'Maks 15 mnt' },
  { value: 'high', title: 'Tinggi', budget: 'Maks 25 mnt' },
];

export const SearchPanel: React.FC<SearchPanelProps> = ({
  origin,
  destination,
  tolerance,
  pickTarget,
  loadingRoute,
  errorMessage,
  hidden = false,
  onSelectOrigin,
  onSelectDestination,
  onSwapPoints,
  onClearAll,
  onToleranceChange,
  onPickTargetChange,
  onUseMyGpsForOrigin,
  onSubmitRoute,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const pointsKey = `${origin?.lat ?? ''},${origin?.lng ?? ''},${origin?.label ?? ''}|${destination?.lat ?? ''},${destination?.lng ?? ''},${destination?.label ?? ''}`;
  const [activeEdit, setActiveEdit] = useState<{
    field: 'origin' | 'destination';
    pointsKey: string;
  } | null>(null);
  const activeField =
    activeEdit && activeEdit.pointsKey === pointsKey ? activeEdit.field : null;
  const setActiveField = (field: 'origin' | 'destination' | null) => {
    setActiveEdit(field ? { field, pointsKey } : null);
  };
  const [draftQuery, setDraftQuery] = useState<string>('');
  const [suggestions, setSuggestions] = useState<NominatimSearchResult[]>([]);
  const [searching, setSearching] = useState<boolean>(false);

  // Debounced Nominatim Search strictly driven by user typing while field is active
  useEffect(() => {
    if (!activeField || draftQuery.trim().length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchPlacesSurabaya(draftQuery, controller.signal);
        if (!controller.signal.aborted) {
          setSuggestions(res);
        }
      } catch {
        if (!controller.signal.aborted) setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draftQuery, activeField]);

  if (hidden) return null;

  const displayedOrigin =
    activeField === 'origin' ? draftQuery : (origin?.label ?? '');
  const displayedDest =
    activeField === 'destination' ? draftQuery : (destination?.label ?? '');
  const visibleSuggestions =
    activeField && draftQuery.trim().length >= 2 ? suggestions : [];

  const handleChooseSuggestion = (
    item: NominatimSearchResult,
    targetField: 'origin' | 'destination' | null = activeField
  ) => {
    const shortLabel =
      item.name?.trim() ||
      item.display_name.split(',').slice(0, 2).join(',').trim();
    const point: PlacePoint = {
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      label: shortLabel,
    };
    if (targetField === 'origin') {
      onSelectOrigin(point);
    } else if (targetField === 'destination') {
      onSelectDestination(point);
    }
    setSuggestions([]);
    setDraftQuery('');
    setActiveField(null);
  };

  const handleCommitDraftOnEnter = async (
    field: 'origin' | 'destination'
  ) => {
    if (visibleSuggestions.length > 0) {
      handleChooseSuggestion(visibleSuggestions[0], field);
      return;
    }
    const q = draftQuery.trim();
    if (q.length < 2) {
      setActiveField(null);
      setDraftQuery('');
      return;
    }
    setSearching(true);
    try {
      const res = await searchPlacesSurabaya(q);
      if (res.length > 0) {
        handleChooseSuggestion(res[0], field);
      } else {
        setActiveField(null);
        setDraftQuery('');
      }
    } catch {
      setActiveField(null);
      setDraftQuery('');
    } finally {
      setSearching(false);
    }
  };

  return (
    <section
      aria-label="Pencarian rute pejalan kaki"
      className="hud-surface pointer-events-auto absolute top-16 left-3 z-25 w-[calc(100dvw-4.5rem)] max-w-86 rounded-2xl p-3 transition-all sm:top-4 sm:left-4 sm:w-86"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#0E7C86]/10 text-[#0E7C86]">
            <Search className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xs font-bold text-slate-900">
              Rute Jalan Kaki Teduh
            </h2>
            <p className="truncate text-[11px] text-slate-500">
              {collapsed && origin && destination
                ? `${origin.label} → ${destination.label}`
                : 'Cari lokasi atau klik langsung di peta'}
            </p>
          </div>
          {collapsed ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
          )}
        </button>

        {(origin || destination) && !collapsed && (
          <button
            type="button"
            onClick={() => {
              setActiveField(null);
              setDraftQuery('');
              setSuggestions([]);
              onClearAll();
            }}
            title="Bersihkan rute & titik"
            aria-label="Bersihkan rute dan titik"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="mt-3 space-y-2.5">
          <div className="relative space-y-2">
            {/* Origin Row */}
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0E7C86] font-mono text-[10px] font-bold text-white">
                A
              </span>
              <div className="relative flex-1">
                <input
                  type="text"
                  value={displayedOrigin}
                  onFocus={() => {
                    setActiveField('origin');
                    setDraftQuery(origin?.label ?? '');
                    setSuggestions([]);
                  }}
                  onChange={(e) => {
                    setActiveField('origin');
                    setDraftQuery(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCommitDraftOnEnter('origin');
                    } else if (e.key === 'Escape') {
                      setActiveField(null);
                      setDraftQuery('');
                      setSuggestions([]);
                    }
                  }}
                  placeholder="Titik keberangkatan..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-1.5 pr-14 pl-2.5 text-xs text-slate-900 placeholder:text-slate-500 focus:border-[#0E7C86] focus:bg-white focus:outline-none"
                />
                <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveField(null);
                      onUseMyGpsForOrigin();
                    }}
                    title="Gunakan lokasi GPS saat ini"
                    aria-label="Gunakan lokasi GPS untuk titik asal"
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-[#0E7C86]"
                  >
                    <LocateFixed className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveField(null);
                      onPickTargetChange(
                        pickTarget === 'origin' ? null : 'origin'
                      );
                    }}
                    title="Klik titik keberangkatan di peta"
                    aria-label="Pilih titik keberangkatan di peta"
                    className={`rounded-md p-1 transition-colors ${
                      pickTarget === 'origin'
                        ? 'bg-[#0E7C86] text-white'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Destination Row */}
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#B42318] font-mono text-[10px] font-bold text-white">
                B
              </span>
              <div className="relative flex-1">
                <input
                  type="text"
                  value={displayedDest}
                  onFocus={() => {
                    setActiveField('destination');
                    setDraftQuery(destination?.label ?? '');
                    setSuggestions([]);
                  }}
                  onChange={(e) => {
                    setActiveField('destination');
                    setDraftQuery(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCommitDraftOnEnter('destination');
                    } else if (e.key === 'Escape') {
                      setActiveField(null);
                      setDraftQuery('');
                      setSuggestions([]);
                    }
                  }}
                  placeholder="Tujuan di Surabaya..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-1.5 pr-14 pl-2.5 text-xs text-slate-900 placeholder:text-slate-500 focus:border-[#0E7C86] focus:bg-white focus:outline-none"
                />
                <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveField(null);
                      onSwapPoints();
                    }}
                    disabled={!origin && !destination}
                    title="Tukar titik A dan B"
                    aria-label="Tukar titik asal dan tujuan"
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveField(null);
                      onPickTargetChange(
                        pickTarget === 'destination' ? null : 'destination'
                      );
                    }}
                    title="Klik titik tujuan di peta"
                    aria-label="Pilih titik tujuan di peta"
                    className={`rounded-md p-1 transition-colors ${
                      pickTarget === 'destination'
                        ? 'bg-[#B42318] text-white'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {(pickTarget === 'origin' || pickTarget === 'destination') && (
              <div className="flex items-center justify-between rounded-xl bg-teal-50 px-2.5 py-1.5 text-[11px] font-medium text-teal-900 ring-1 ring-teal-200">
                <span>
                  Klik di peta 3D untuk memilih{' '}
                  <strong>
                    {pickTarget === 'origin' ? 'Titik A' : 'Tujuan B'}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => onPickTargetChange(null)}
                  className="font-semibold text-teal-700 underline"
                >
                  Batal
                </button>
              </div>
            )}

            {(searching || visibleSuggestions.length > 0) && activeField && (
              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                {searching && (
                  <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0E7C86]" />
                    <span>Mencari lokasi di Surabaya...</span>
                  </div>
                )}
                {!searching &&
                  visibleSuggestions.map((item) => (
                    <button
                      key={item.place_id}
                      type="button"
                      onClick={() => handleChooseSuggestion(item)}
                      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-slate-100"
                    >
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0E7C86]" />
                      <span className="line-clamp-2 text-slate-700">
                        {item.display_name}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Heat Tolerance / Heat Budget Selector */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-700">
                Toleransi Paparan Panas
              </span>
              <span className="text-[10px] font-semibold text-slate-600">Heat Budget</span>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
              {TOLERANCE_OPTIONS.map((opt) => {
                const selected = tolerance === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onToleranceChange(opt.value)}
                    className={`flex flex-col items-center rounded-lg py-1 text-center transition-all ${
                      selected
                        ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-300'
                        : 'text-slate-600 hover:text-slate-950'
                    }`}
                  >
                    <span className="text-[11px] font-bold">{opt.title}</span>
                    <span className="font-mono text-[9px] font-medium text-slate-600 tabular-nums">
                      {opt.budget}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-snug font-medium text-red-800">
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            disabled={!origin || !destination || loadingRoute}
            onClick={() => {
              setActiveField(null);
              setDraftQuery('');
              setSuggestions([]);
              onSubmitRoute();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0E7C86] px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#0A5E66] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {loadingRoute ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Menghitung rute pgRouting...</span>
              </>
            ) : (
              <>
                <Navigation className="h-3.5 w-3.5" />
                <span>Cari Rute Terbaik</span>
              </>
            )}
          </button>
        </div>
      )}
    </section>
  );
};
