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
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
        Data prediksi panas belum tersedia di tabel <code className="font-mono">tcs_simulations</code>. Pastikan Spark pipeline telah dijalankan.
      </div>
    );
  }

  const { summary, hourly_trend, hot_zones } = prediction;
  const scenarioModelLabel =
    summary.simulation_source === 'mllib'
      ? 'Spark MLlib Simulation'
      : 'Simulasi Formula TCS';

  return (
    <div className="space-y-5">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">
            Segmen Panas (TCS &lt; 0.50)
          </p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-red-700 tabular-nums">
            {summary.hot_segments.toLocaleString('id-ID')}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {summary.hot_percentage}% dari{' '}
            {summary.total_segments.toLocaleString('id-ID')} segmen
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">
            Rata-Rata TCS Kota
          </p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-slate-900 tabular-nums">
            {summary.avg_city_tcs.toFixed(3)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {summary.cool_segments.toLocaleString('id-ID')} segmen sudah teduh
            (&gt;0.65)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">
            Suhu Terasa Rata-Rata / Maks
          </p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-orange-700 tabular-nums">
            {summary.avg_apparent_temp}°C{' '}
            <span className="text-sm font-semibold text-slate-400">
              / {summary.max_apparent_temp}°C
            </span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {summary.peak_heat_hour === null
              ? 'Prakiraan per jam belum tersedia'
              : `Jam puncak terik sekitar ${summary.peak_heat_hour}:00 WIB`}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">
            Kandidat Intervensi Terbaik
          </p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-[#0E7C86] tabular-nums">
            {simulations.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Segmen hasil pemodelan ({scenarioModelLabel})
          </p>
        </div>
      </div>

      {/* Multi-Scenario Hourly TCS Curve (Recharts) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Kurva Harian Kenyamanan Termal (06:00 – 21:00 WIB)
            </h3>
            <p className="text-xs text-slate-500">
              Prakiraan cuaca per jam, dibandingkan dengan skenario penambahan
              kanopi pohon dan <em>cool pavement</em>.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-[#0E7C86]">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{scenarioModelLabel}</span>
          </span>
        </div>

        <div className="h-68 w-full">
          {hourly_trend.length === 0 ? (
            <p className="flex h-full items-center justify-center text-xs text-slate-500">
              Prakiraan per jam belum tersedia. Jalankan pembaruan data.
            </p>
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={hourly_trend}
              margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#64748B' }}
                stroke="#CBD5E1"
              />
              <YAxis
                domain={[0.3, 1.0]}
                tick={{ fontSize: 11, fill: '#64748B' }}
                stroke="#CBD5E1"
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  borderColor: '#E2E8F0',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Line
                type="monotone"
                dataKey="tcs_current"
                name="TCS Eksisting"
                stroke="#D9532F"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="tcs_green_scenario"
                name="Skenario Penghijauan"
                stroke="#1F8A5B"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="tcs_cool_scenario"
                name="Skenario Cool Pavement"
                stroke="#0E7C86"
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
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSubView('hotzones')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                subView === 'hotzones'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Flame className="h-3.5 w-3.5 text-orange-600" />
              <span>50 Zona Terpanas ({hot_zones.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('simulations')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                subView === 'simulations'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Trees className="h-3.5 w-3.5 text-emerald-600" />
              <span>Dampak Penghijauan Tertinggi ({simulations.length})</span>
            </button>
          </div>
        </div>

        {subView === 'hotzones' ? (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="hotzones-caption"
            className="table-wrapper"
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
              <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    Segmen Jalan
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    Tipe
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    Suhu Terasa
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    Rasio Teduh
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    TCS Saat Ini
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    Skenario Hijau
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hot_zones.map((z) => {
                  const grade = getTcsGrade(z.current_tcs);
                  return (
                    <tr key={z.segment_id} className="hover:bg-slate-50/80">
                      <th
                        scope="row"
                        className="px-3.5 py-2.5 font-semibold text-slate-900"
                      >
                        <div>{z.street_name}</div>
                        <div className="font-mono text-[10px] font-normal text-slate-400">
                          ID #{z.segment_id}
                        </div>
                      </th>
                      <td className="px-3.5 py-2.5 text-slate-600">
                        {z.highway_type}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono font-semibold text-orange-700 tabular-nums">
                        {z.apparent_temp.toFixed(1)}°C
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-600 tabular-nums">
                        {Math.round(z.shade_ratio * 100)}%
                      </td>
                      <td className="px-3.5 py-2.5 font-mono tabular-nums">
                        <span
                          className="rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
                          style={{ backgroundColor: grade.color }}
                        >
                          {z.current_tcs.toFixed(3)}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono tabular-nums">
                        <span className="font-bold text-emerald-700">
                          {z.predicted_tcs_green.toFixed(3)}
                        </span>
                        <span className="ml-1.5 inline-flex items-center text-[10px] font-semibold text-emerald-600">
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
            className="table-wrapper"
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
              <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    Nama Jalan / Segmen
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    TCS Awal
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    Penghijauan
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    Cool Pavement
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5">
                    Gain Hijau
                  </th>
                  <th className="border-b border-slate-200 px-3.5 py-2.5 text-right">
                    Peta 3D
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {simulations.map((sim) => {
                  const center = extractGeometryCenter(sim.geometry);
                  return (
                    <tr key={sim.segment_id} className="hover:bg-slate-50/80">
                      <th
                        scope="row"
                        className="px-3.5 py-2.5 font-semibold text-slate-900"
                      >
                        {sim.street_name}
                      </th>
                      <td className="px-3.5 py-2.5 font-mono text-slate-600 tabular-nums">
                        {sim.current_tcs.toFixed(3)}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono font-bold text-emerald-700 tabular-nums">
                        {sim.predicted_tcs_green.toFixed(3)}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[#0E7C86] tabular-nums">
                        {sim.predicted_tcs_cool.toFixed(3)}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono font-bold text-emerald-600 tabular-nums">
                        +{sim.tcs_improvement_green.toFixed(3)}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        {center && (
                          <button
                            type="button"
                            onClick={() => onFlyToMap(center, sim.street_name)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-teal-50 hover:text-[#0E7C86]"
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
