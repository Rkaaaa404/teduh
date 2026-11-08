'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WeatherSnapshot } from '@/types';
import { getCurrentWibSolarHour, SURABAYA_CENTER } from '@/utils/geoMath';

interface OpenMeteoPayload {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    uv_index?: number;
    weather_code?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    apparent_temperature?: number[];
    relative_humidity_2m?: number[];
    uv_index?: number[];
    weather_code?: number[];
  };
}

const OPEN_METEO_SURABAYA_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${SURABAYA_CENTER.lat}&longitude=${SURABAYA_CENTER.lng}` +
  `&current=temperature_2m,apparent_temperature,relative_humidity_2m,uv_index,weather_code` +
  `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,uv_index,weather_code` +
  `&forecast_days=1&timezone=Asia%2FJakarta`;

/**
 * Mengambil data meteorologi aktual + kurva per jam hari ini (Open-Meteo Surabaya)
 * dalam satu request terpusat (refresh tiap 10 menit), tanpa duplikasi panggilan antar komponen.
 */
export function useSurabayaWeather(selectedSolarHour: number): {
  weather: WeatherSnapshot | null;
  loading: boolean;
} {
  const [payload, setPayload] = useState<OpenMeteoPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const loadWeather = async () => {
      try {
        const res = await fetch(OPEN_METEO_SURABAYA_URL, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json: OpenMeteoPayload = await res.json();
        if (active) {
          setPayload(json);
        }
      } catch {
        // Biarkan weather = null jika offline (tanpa data dummy)
      } finally {
        if (active) setLoading(false);
      }
    };

    loadWeather();
    const timer = window.setInterval(loadWeather, 10 * 60 * 1000);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const weather = useMemo<WeatherSnapshot | null>(() => {
    if (!payload?.current) return null;

    const nowHour = getCurrentWibSolarHour();
    const isNearNow = Math.abs(selectedSolarHour - nowHour) <= 0.6;

    if (!isNearNow && payload.hourly?.time && payload.hourly.temperature_2m) {
      const targetHourIdx = Math.max(
        0,
        Math.min(23, Math.round(selectedSolarHour))
      );
      const temp = payload.hourly.temperature_2m[targetHourIdx];
      const appTemp = payload.hourly.apparent_temperature?.[targetHourIdx];
      const hum = payload.hourly.relative_humidity_2m?.[targetHourIdx];
      const uv = payload.hourly.uv_index?.[targetHourIdx];
      const code = payload.hourly.weather_code?.[targetHourIdx];

      if (typeof temp === 'number') {
        return {
          temperature: Math.round(temp * 10) / 10,
          apparentTemperature: Math.round((appTemp ?? temp) * 10) / 10,
          humidity: Math.round(hum ?? 70),
          uvIndex: Math.round((uv ?? 0) * 10) / 10,
          weatherCode: code ?? 0,
          isForecast: true,
          hourLabel: `${targetHourIdx.toString().padStart(2, '0')}:00 WIB`,
        };
      }
    }

    const c = payload.current;
    if (typeof c.temperature_2m !== 'number') return null;

    return {
      temperature: Math.round(c.temperature_2m * 10) / 10,
      apparentTemperature:
        Math.round((c.apparent_temperature ?? c.temperature_2m) * 10) / 10,
      humidity: Math.round(c.relative_humidity_2m ?? 70),
      uvIndex: Math.round((c.uv_index ?? 0) * 10) / 10,
      weatherCode: c.weather_code ?? 0,
      isForecast: false,
      hourLabel: 'Saat ini',
    };
  }, [payload, selectedSolarHour]);

  return { weather, loading };
}

