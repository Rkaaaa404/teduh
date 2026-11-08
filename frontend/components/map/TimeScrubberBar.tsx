'use client';

import React from 'react';
import { Moon, RotateCcw, Sun, Sunrise, Sunset } from 'lucide-react';
import { getCurrentWibSolarHour } from '@/utils/geoMath';

interface TimeScrubberBarProps {
  solarHour: number;
  onSolarHourChange: (hour: number) => void;
  hidden?: boolean;
}

function getPeriodLabel(hour: number): string {
  if (hour < 6.0) return 'Fajar';
  if (hour <= 10.0) return 'Pagi';
  if (hour <= 14.5) return 'Siang';
  if (hour <= 17.25) return 'Sore';
  if (hour <= 18.5) return 'Senja';
  return 'Malam';
}

const PRESETS = [
  { label: 'Pagi', hour: 7.5 },
  { label: 'Siang', hour: 12.25 },
  { label: 'Senja', hour: 17.25 },
  { label: 'Malam', hour: 19.5 },
];

export const TimeScrubberBar: React.FC<TimeScrubberBarProps> = ({
  solarHour,
  onSolarHourChange,
  hidden = false,
}) => {
  if (hidden) return null;

  const hourInt = Math.floor(solarHour);
  const minInt = Math.round((solarHour - hourInt) * 60);
  const formattedTime = `${hourInt.toString().padStart(2, '0')}:${minInt
    .toString()
    .padStart(2, '0')}`;

  const currentWib = getCurrentWibSolarHour();
  const isModified = Math.abs(solarHour - currentWib) > 0.35;

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5 select-none">
      <div className="hud-surface pointer-events-auto flex items-center gap-2.5 rounded-full px-3 py-1.5 text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-slate-700">
          {solarHour < 6 || solarHour > 18.5 ? (
            <Moon className="h-3.5 w-3.5 text-indigo-600" />
          ) : solarHour <= 7 || solarHour >= 17 ? (
            <Sunset className="h-3.5 w-3.5 text-amber-600" />
          ) : (
            <Sun className="h-3.5 w-3.5 text-amber-500" />
          )}
          <span className="hidden sm:inline">{getPeriodLabel(solarHour)}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-900 tabular-nums">
            {formattedTime} WIB
          </span>
        </div>

        <div className="h-3.5 w-px bg-slate-200" />

        <div className="flex items-center gap-0.5 text-[11px]">
          {PRESETS.map((preset) => {
            const active = Math.abs(solarHour - preset.hour) <= 0.3;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => onSolarHourChange(preset.hour)}
                className={`rounded-full px-2 py-0.5 font-medium transition-colors ${
                  active
                    ? 'bg-[#0E7C86] text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {isModified && (
          <button
            type="button"
            onClick={() => onSolarHourChange(getCurrentWibSolarHour())}
            title="Kembalikan ke jam aktual WIB sekarang"
            className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-200"
          >
            <RotateCcw className="h-3 w-3" />
            <span className="hidden md:inline">Sekarang</span>
          </button>
        )}
      </div>

      <div className="hud-surface pointer-events-auto flex w-60 items-center gap-2 rounded-full px-3 py-1 sm:w-72">
        <Sunrise className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <input
          type="range"
          min="5.0"
          max="20.5"
          step="0.25"
          value={solarHour}
          onChange={(e) => onSolarHourChange(parseFloat(e.target.value))}
          aria-label="Simulasi jam pencahayaan matahari Surabaya"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-[#0E7C86]"
        />
        <Moon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
      </div>
    </div>
  );
};

