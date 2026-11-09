'use client';

import React, { useEffect, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  Box,
  CloudRain,
  CloudSun,
  Leaf,
  Locate,
  Minus,
  Moon,
  Plus,
  Sun,
} from 'lucide-react';
import type { WeatherSnapshot } from '@/types';

interface CameraCompassControlProps {
  map: MapLibreMap | null;
  weather: WeatherSnapshot | null;
  ecoMode: boolean;
  onToggleEcoMode: () => void;
  onLocateMe: () => void;
  locating?: boolean;
}

function renderWeatherIcon(code: number, hourLabel: string) {
  const hourNum = parseInt(hourLabel.slice(0, 2), 10);
  const isNightHour = !Number.isNaN(hourNum) && (hourNum < 6 || hourNum >= 18);
  if (code >= 51) {
    return <CloudRain className="h-3.5 w-3.5 text-sky-600 shrink-0" />;
  }
  if (isNightHour) {
    return <Moon className="h-3.5 w-3.5 text-indigo-600 shrink-0" />;
  }
  if (code >= 2) {
    return <CloudSun className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  }
  return <Sun className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
}

export const CameraCompassControl: React.FC<CameraCompassControlProps> = ({
  map,
  weather,
  ecoMode,
  onToggleEcoMode,
  onLocateMe,
  locating = false,
}) => {
  const [pitch, setPitch] = useState<number>(52);
  const [bearing, setBearing] = useState<number>(-12);

  useEffect(() => {
    if (!map) return;

    const syncOrientation = () => {
      setBearing(Math.round(map.getBearing()));
      setPitch(Math.round(map.getPitch()));
    };

    syncOrientation();
    map.on('rotate', syncOrientation);
    map.on('pitch', syncOrientation);

    return () => {
      map.off('rotate', syncOrientation);
      map.off('pitch', syncOrientation);
    };
  }, [map]);

  const is3D = pitch > 15;

  const toggle3D = () => {
    if (!map) return;
    if (ecoMode) {
      onToggleEcoMode();
      return;
    }
    map.easeTo({ pitch: is3D ? 0 : 54, duration: 650 });
  };

  const resetNorth = () => {
    if (!map) return;
    map.easeTo({ bearing: 0, duration: 550 });
  };

  return (
    <div className="pointer-events-none absolute top-16 right-3 z-20 flex flex-col items-end gap-2 sm:top-4 sm:right-4 select-none">
      {/* Top Row: Weather Pill + Laptop GPU Eco Mode Toggle */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {weather && (
          <div
            className="hud-surface pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-slate-700"
            title={`Cuaca Surabaya (${weather.hourLabel}) • Kelembapan ${weather.humidity}%`}
          >
            {renderWeatherIcon(weather.weatherCode, weather.hourLabel)}
            <span className="font-mono font-bold text-slate-900 tabular-nums">
              {weather.temperature}°C
            </span>
            <span className="hidden text-slate-300 md:inline">•</span>
            <span className="hidden text-slate-600 md:inline">
              Terasa{' '}
              <strong className="font-mono font-semibold text-slate-800 tabular-nums">
                {weather.apparentTemperature}°C
              </strong>
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-600">
              UV{' '}
              <strong
                className={`font-mono font-semibold tabular-nums ${
                  weather.uvIndex >= 8
                    ? 'text-red-600'
                    : weather.uvIndex >= 5
                      ? 'text-amber-600'
                      : 'text-emerald-700'
                }`}
              >
                {weather.uvIndex}
              </strong>
            </span>
            {weather.isForecast && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                {weather.hourLabel}
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onToggleEcoMode}
          aria-pressed={ecoMode}
          title={
            ecoMode
              ? 'Mode Ringan Aktif (2D Hemat Baterai & GPU) — Klik untuk kembali ke 3D Penuh'
              : 'Aktifkan Mode Ringan (2D Hemat Baterai & GPU Laptop)'
          }
          className={`hud-surface pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            ecoMode
              ? '!bg-emerald-700 !border-emerald-800 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Leaf className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">
            {ecoMode ? 'Mode Ringan' : 'Hemat GPU'}
          </span>
        </button>
      </div>

      {/* Vertical Camera Control Stack */}
      <div className="hud-surface pointer-events-auto flex flex-col overflow-hidden rounded-xl">
        <button
          type="button"
          onClick={toggle3D}
          title={is3D ? 'Ubah ke perspektif 2D datar' : 'Ubah ke perspektif 3D'}
          aria-label="Ubah perspektif 3D atau 2D"
          className={`flex h-9 w-10 items-center justify-center gap-0.5 border-b border-slate-200/80 text-[11px] font-bold transition-colors ${
            is3D
              ? 'bg-[#0E7C86] text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Box className="h-3.5 w-3.5" />
          <span>{is3D ? '3D' : '2D'}</span>
        </button>

        <button
          type="button"
          onClick={() => map?.zoomIn({ duration: 280 })}
          title="Perbesar peta"
          aria-label="Perbesar peta"
          className="flex h-8 w-10 items-center justify-center border-b border-slate-200/80 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <Plus className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => map?.zoomOut({ duration: 280 })}
          title="Perkecil peta"
          aria-label="Perkecil peta"
          className="flex h-8 w-10 items-center justify-center border-b border-slate-200/80 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <Minus className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onLocateMe}
          title="Pusatkan ke posisi GPS saya"
          aria-label="Pusatkan ke posisi GPS saya"
          className={`flex h-8 w-10 items-center justify-center text-[#0E7C86] transition-colors hover:bg-teal-50 ${
            locating ? 'animate-pulse bg-teal-50' : ''
          }`}
        >
          <Locate className="h-4 w-4" />
        </button>
      </div>

      {/* Interactive 3D Compass Rose */}
      <div className="hud-surface pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full">
        <button
          type="button"
          onClick={() =>
            map?.easeTo({
              pitch: Math.min((map.getPitch() || 0) + 14, 72),
              duration: 320,
            })
          }
          title="Miringkan kamera naik"
          aria-label="Miringkan kamera naik"
          className="absolute top-0.5 flex h-3.5 w-5 items-center justify-center text-[8px] text-slate-400 hover:text-slate-800"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() =>
            map?.easeTo({
              pitch: Math.max((map.getPitch() || 0) - 14, 0),
              duration: 320,
            })
          }
          title="Tegakkan kamera turun"
          aria-label="Tegakkan kamera turun"
          className="absolute bottom-0.5 flex h-3.5 w-5 items-center justify-center text-[8px] text-slate-400 hover:text-slate-800"
        >
          ▼
        </button>
        <button
          type="button"
          onClick={() =>
            map?.easeTo({
              bearing: (map.getBearing() || 0) - 25,
              duration: 320,
            })
          }
          title="Putar kamera ke kiri"
          aria-label="Putar kamera ke kiri"
          className="absolute left-0.5 flex h-5 w-3.5 items-center justify-center text-[8px] text-slate-400 hover:text-slate-800"
        >
          ◄
        </button>
        <button
          type="button"
          onClick={() =>
            map?.easeTo({
              bearing: (map.getBearing() || 0) + 25,
              duration: 320,
            })
          }
          title="Putar kamera ke kanan"
          aria-label="Putar kamera ke kanan"
          className="absolute right-0.5 flex h-5 w-3.5 items-center justify-center text-[8px] text-slate-400 hover:text-slate-800"
        >
          ►
        </button>

        <button
          type="button"
          onClick={resetNorth}
          title="Hadapkan kembali ke Utara (0°)"
          aria-label="Reset arah Utara"
          className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-transform duration-150 ease-out"
          style={{ transform: `rotate(${-bearing}deg)` }}
        >
          <span
            className="absolute top-0 h-0 w-0 border-r-[3.5px] border-b-[10px] border-l-[3.5px] border-r-transparent border-b-[#B42318] border-l-transparent"
            style={{ transform: 'translateY(-1px)' }}
          />
          <span
            className="absolute bottom-0 h-0 w-0 border-t-[10px] border-r-[3.5px] border-l-[3.5px] border-t-slate-400 border-r-transparent border-l-transparent"
            style={{ transform: 'translateY(1px)' }}
          />
          <span className="z-10 h-1.5 w-1.5 rounded-full bg-slate-700" />
        </button>
      </div>
    </div>
  );
};
