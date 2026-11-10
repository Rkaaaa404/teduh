'use client';

import React, { useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpRight, Flame, MapPin, Sparkles, Trees } from 'lucide-react';
import type {
  Coordinate,
  HeatPredictionResponse,
  SimulationItem,
} from '@/types';
import { extractGeometryCenter, getTcsGrade } from '@/utils/geoMath';

interface HeatPredictionTabProps {
  prediction: HeatPredictionResponse | null;
  simulations: SimulationItem[];
  onFlyToMap: (coord: Coordinate, label?: string) => void;
}

export const HeatPredictionTab: React.FC<HeatPredictionTabProps> = ({
  prediction,
  simulations,
  onFlyToMap,
}) => {
  const [subView, setSubView] = useState<'hotzones' | 'simulations'>(
    'hotzones'
  );

  if (!prediction) {
    return (
      <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-8 text-center text-xs text-slate-400">
        Data prediksi panas belum tersedia di tabel <code className="font-mono text-teal-300">tcs_simulations</code>. Pastikan Spark pipeline telah dijalankan.
      </div>
    );
  }

  const { summary, hourly_trend, hot_zones } = prediction;
  const scenarioModelLabel =
    summary.simulation_source === 'mllib'
      ? 'Spark MLlib Simulation'
      : 'Simulasi Formula TCS';

  return (
    <div className="space-y-6">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-4">
          <p className="text-xs font-semibold text-rose-300">
            Segmen Panas (TCS &lt; 0.50)
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-rose-400 tabular-nums">
            {summary.hot_segments.toLocaleString('id-ID')}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {summary.hot_percentage}% dari{' '}
            {summary.total_segments.toLocaleString('id-ID')} segmen
          </p>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-800/80 p-4">
          <p className="text-xs font-semibold text-slate-400">
            Rata-Rata TCS Kota
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-white tabular-nums">
            {summary.avg_city_tcs.toFixed(3)}
          </p>
          <p className="mt-1 text-[11px] text-teal-400">
            {summary.cool_segments.toLocaleString('id-ID')} segmen sudah teduh
            (&gt;0.65)
          </p>
        </div>

        <div className="rounded-2xl border border-orange-500/40 bg-orange-950/20 p-4">
          <p className="text-xs font-semibold text-orange-300">
            Suhu Terasa Rata-Rata / Maks
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-orange-400 tabular-nums">
            {summary.avg_apparent_temp}°C{' '}
            <span className="text-sm font-semibold text-slate-400">
              / {summary.max_apparent_temp}°C
            </span>
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {summary.peak_heat_hour === null
              ? 'Prakiraan per jam belum tersedia'
              : `Jam puncak terik sekitar ${summary.peak_heat_hour}:00 WIB`}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-800/80 p-4">
          <p className="text-xs font-semibold text-slate-400">
            Kandidat Intervensi Terbaik
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-teal-400 tabular-nums">
            {simulations.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Segmen hasil pemodelan ({scenarioModelLabel})
          </p>
        </div>
      </div>

      {/* Multi-Scenario Hourly TCS Curve (Recharts) */}
      <div className="rounded-2xl border border-slate-700 bg-slate-800/80 p-5">
        <div className="mb-4 flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-bold text-white">
              Kurva Harian Kenyamanan Termal (06:00 – 21:00 WIB)
            </h3>
            <p className="text-xs text-slate-400">
              Prakiraan cuaca per jam, dibandingkan dengan skenario penambahan
              kanopi pohon dan <em>cool pavement</em>.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/40 bg-teal-500/20 px-2.5 py-1 text-[11px] font-semibold text-teal-300">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{scenarioModelLabel}</span>
          </span>
        </div>

        <div className="h-68 w-full">
          {hourly_trend.length === 0 ? (
            <p className="flex h-full items-center justify-center text-xs text-slate-400">
              Prakiraan per jam belum tersedia. Jalankan pembaruan data.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={hourly_trend}
                margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  stroke="#475569"
                />
                <YAxis
                  domain={[0.3, 1.0]}
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  stroke="#475569"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderRadius: '12px',
                    borderColor: '#334155',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#94A3B8' }} />
                <Line
                  type="monotone"
                  dataKey="tcs_current"
                  name="TCS Eksisting"
                  stroke="#F87171"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="tcs_green_scenario"
                  name="Skenario Penghijauan"
                  stroke="#34D399"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="tcs_cool_scenario"
                  name="Skenario Cool Pavement"
                  stroke="#2DD4BF"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Sub-Switch: Top 50 Hot Zones vs Top 50 Greening Gain Simulations */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-xl border border-slate-700 bg-slate-800 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSubView('hotzones')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                subView === 'hotzones'
                  ? 'bg-slate-700 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Flame className="h-3.5 w-3.5 text-orange-400" />
              <span>50 Zona Terpanas ({hot_zones.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('simulations')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                subView === 'simulations'
                  ? 'bg-slate-700 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Trees className="h-3.5 w-3.5 text-emerald-400" />
              <span>Dampak Penghijauan Tertinggi ({simulations.length})</span>
            </button>
          </div>
        </div>

        {subView === 'hotzones' ? (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="hotzones-caption"
            className="table-wrapper-dark"
          >
            <table
              style={
                {
                  '--label-2': '"Tipe Jalan"',
                  '--label-3': '"Suhu Terasa"',
                  '--label-4': '"Peneduh"',
                  '--label-5': '"TCS Saat Ini"',
                  '--label-6': '"Prediksi Hijau"',
                } as React.CSSProperties
              }
              className="text-left text-xs"
            >
              <caption id="hotzones-caption" className="sr-only">
                Daftar 50 segmen zona terpanas beserta proyeksi kenaikan TCS
              </caption>
              <thead className="border-b border-slate-700 bg-slate-900/90 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                <tr>
                  <th className="px-4 py-3">
                    Segmen Jalan
                  </th>
                  <th className="px-4 py-3">
                    Tipe
                  </th>
                  <th className="px-4 py-3">
                    Suhu Terasa
                  </th>
                  <th className="px-4 py-3">
                    Rasio Teduh
                  </th>
                  <th className="px-4 py-3">
                    TCS Saat Ini
                  </th>
                  <th className="px-4 py-3">
                    Skenario Hijau
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {hot_zones.map((z) => {
                  const grade = getTcsGrade(z.current_tcs);
                  return (
                    <tr key={z.segment_id} className="transition-colors hover:bg-slate-800/60">
                      <th
                        scope="row"
                        className="px-4 py-3 font-semibold text-white"
                      >
                        <div>{z.street_name}</div>
                        <div className="font-mono text-[10px] font-normal text-slate-400">
                          ID #{z.segment_id}
                        </div>
                      </th>
                      <td className="px-4 py-3 text-slate-300">
                        {z.highway_type}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-orange-400 tabular-nums">
                        {z.apparent_temp.toFixed(1)}°C
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300 tabular-nums">
                        {Math.round(z.shade_ratio * 100)}%
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white shadow-xs"
                          style={{ backgroundColor: grade.color }}
                        >
                          {z.current_tcs.toFixed(3)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        <span className="font-bold text-emerald-400">
                          {z.predicted_tcs_green.toFixed(3)}
                        </span>
                        <span className="ml-1.5 inline-flex items-center text-[10px] font-semibold text-emerald-400">
                          <ArrowUpRight className="h-3 w-3" />+
                          {z.improvement_pct}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="sim-caption"
            className="table-wrapper-dark"
          >
            <table
              style={
                {
                  '--label-2': '"TCS Awal"',
                  '--label-3': '"Prediksi Pohon"',
                  '--label-4': '"Prediksi Cool Pavement"',
                  '--label-5': '"Kenaikan TCS"',
                  '--label-6': '"Inspeksi Peta"',
                } as React.CSSProperties
              }
              className="text-left text-xs"
            >
              <caption id="sim-caption" className="sr-only">
                Peringkat 50 segmen dengan kenaikan kenyamanan tertinggi
              </caption>
              <thead className="border-b border-slate-700 bg-slate-900/90 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                <tr>
                  <th className="px-4 py-3">
                    Nama Jalan / Segmen
                  </th>
                  <th className="px-4 py-3">
                    TCS Awal
                  </th>
                  <th className="px-4 py-3">
                    Penghijauan
                  </th>
                  <th className="px-4 py-3">
                    Cool Pavement
                  </th>
                  <th className="px-4 py-3">
                    Gain Hijau
                  </th>
                  <th className="px-4 py-3 text-right">
                    Peta 3D
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {simulations.map((sim) => {
                  const center = extractGeometryCenter(sim.geometry);
                  return (
                    <tr key={sim.segment_id} className="transition-colors hover:bg-slate-800/60">
                      <th
                        scope="row"
                        className="px-4 py-3 font-semibold text-white"
                      >
                        {sim.street_name}
                      </th>
                      <td className="px-4 py-3 font-mono text-slate-300 tabular-nums">
                        {sim.current_tcs.toFixed(3)}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-emerald-400 tabular-nums">
                        {sim.predicted_tcs_green.toFixed(3)}
                      </td>
                      <td className="px-4 py-3 font-mono text-teal-300 tabular-nums">
                        {sim.predicted_tcs_cool.toFixed(3)}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-emerald-400 tabular-nums">
                        +{sim.tcs_improvement_green.toFixed(3)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {center && (
                          <button
                            type="button"
                            onClick={() => onFlyToMap(center, sim.street_name)}
                            className="inline-flex items-center gap-1 rounded-xl border border-teal-500/40 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-teal-300 hover:bg-teal-600/30 hover:text-white transition-colors"
                          >
                            <MapPin className="h-3 w-3" />
                            <span>Lihat</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
