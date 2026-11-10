'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type Marker,
} from 'maplibre-gl';
import type {
  CCTVCamera,
  Coordinate,
  MapAlert,
  MapLayerMode,
  PlacePoint,
  RouteResponse,
  RoutePreferenceType,
} from '@/types';
import {
  fetchTemperatureHeatmap,
  fetchThermalSegments,
} from '@/services/api';
import {
  applySurabaya3DUrbanStyle,
  configureAtmosphereAndSky,
  ensureRouteLayers,
  F4MAP_PALETTE,
  OPENFREEMAP_LIBERTY_STYLE,
  syncEcoModeLayers,
  syncMapLayerMode,
  updateMapSunLighting,
} from '@/components/map/mapStyleSurabaya3D';
import {
  computeInitialRouteBearing,
  routesAreIdentical,
  SURABAYA_CENTER,
} from '@/utils/geoMath';

export type MapPickTarget = 'origin' | 'destination' | 'incident' | null;

export interface MapViewHandle {
  getMap: () => MapLibreMap | null;
  flyToCoordinate: (coord: Coordinate, zoom?: number) => void;
}

interface MapViewProps {
  origin: PlacePoint | null;
  destination: PlacePoint | null;
  userLocation: Coordinate | null;
  navPosition?: Coordinate | null;
  routeData: RouteResponse | null;
  selectedRouteType: RoutePreferenceType;
  previewRouteType?: RoutePreferenceType | null;
  cctvCameras: CCTVCamera[];
  activeAlerts: MapAlert[];
  layerMode: MapLayerMode;
  solarHour: number;
  ecoMode?: boolean;
  isNavigating: boolean;
  pickTarget: MapPickTarget;
  onMapReady?: (map: MapLibreMap) => void;
  onMapCoordinatePick: (coord: Coordinate) => void;
  onSelectCCTV: (camera: CCTVCamera) => void;
  onSelectAlert: (alert: MapAlert) => void;
  onSegmentMetaChange?: (count: number, loading: boolean) => void;
}

function getSeverityHex(severity?: string | null): string {
  switch ((severity ?? '').toUpperCase()) {
    case 'CRITICAL':
      return '#B42318';
    case 'HIGH':
      return '#D9532F';
    case 'LOW':
      return '#0E7C86';
    default:
      return '#D9822B';
  }
}

function getOptimalPixelRatio(eco: boolean): number {
  if (eco || typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, 1.5);
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  {
    origin,
    destination,
    userLocation,
    navPosition,
    routeData,
    selectedRouteType,
    previewRouteType = null,
    cctvCameras,
    activeAlerts,
    layerMode,
    solarHour,
    ecoMode = false,
    isNavigating,
    pickTarget,
    onMapReady,
    onMapCoordinatePick,
    onSelectCCTV,
    onSelectAlert,
    onSegmentMetaChange,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleReadyRef = useRef<boolean>(false);
  const [styleReady, setStyleReady] = useState<boolean>(false);
  const uhiLoadedRef = useRef<boolean>(false);
  const lastFetchKeyRef = useRef<string>('');
  const lastFittedRouteKeyRef = useRef<string>('');

  const originMarkerRef = useRef<Marker | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const cctvMarkersRef = useRef<Marker[]>([]);
  const alertMarkersRef = useRef<Marker[]>([]);

  const pickCallbackRef = useRef(onMapCoordinatePick);
  const onMapReadyRef = useRef(onMapReady);
  const onSegmentMetaChangeRef = useRef(onSegmentMetaChange);
  const onSelectCCTVRef = useRef(onSelectCCTV);
  const onSelectAlertRef = useRef(onSelectAlert);
  const layerModeRef = useRef(layerMode);
  const solarHourRef = useRef(solarHour);
  const ecoModeRef = useRef(ecoMode);
  const prevEcoModeRef = useRef(ecoMode);

  useEffect(() => {
    pickCallbackRef.current = onMapCoordinatePick;
  }, [onMapCoordinatePick]);

  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  useEffect(() => {
    onSegmentMetaChangeRef.current = onSegmentMetaChange;
  }, [onSegmentMetaChange]);

  useEffect(() => {
    onSelectCCTVRef.current = onSelectCCTV;
  }, [onSelectCCTV]);

  useEffect(() => {
    onSelectAlertRef.current = onSelectAlert;
  }, [onSelectAlert]);

  useEffect(() => {
    layerModeRef.current = layerMode;
  }, [layerMode]);

  useEffect(() => {
    solarHourRef.current = solarHour;
  }, [solarHour]);

  useEffect(() => {
    ecoModeRef.current = ecoMode;
  }, [ecoMode]);

  useImperativeHandle(ref, () => ({
    getMap: () => mapRef.current,
    flyToCoordinate: (coord: Coordinate, zoom = 17.2) => {
      mapRef.current?.flyTo({
        center: [coord.lng, coord.lat],
        zoom,
        pitch: ecoModeRef.current ? 0 : 56,
        duration: 1100,
      });
    },
  }));

  const loadViewportSegments = useCallback(
    async (map: MapLibreMap, signal?: AbortSignal) => {
      if (!styleReadyRef.current) return;
      const bounds = map.getBounds();
      const zoom = Number(map.getZoom().toFixed(1));
      const isEco = ecoModeRef.current;

      const fetchKey = [
        bounds.getWest().toFixed(3),
        bounds.getSouth().toFixed(3),
        bounds.getEast().toFixed(3),
        bounds.getNorth().toFixed(3),
        zoom.toFixed(1),
        isEco ? 'eco' : 'std',
      ].join(':');

      if (fetchKey === lastFetchKeyRef.current) {
        return;
      }

      onSegmentMetaChangeRef.current?.(0, true);
      try {
        const segments = await fetchThermalSegments(
          {
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth(),
            zoom,
            limit: isEco ? 900 : undefined,
          },
          signal
        );
        if (signal?.aborted) return;
        lastFetchKeyRef.current = fetchKey;

        const src = map.getSource('teduh-tcs-segments') as
          | GeoJSONSource
          | undefined;
        if (src) {
          src.setData({
            type: 'FeatureCollection',
            features: segments.map((s) => ({
              type: 'Feature' as const,
              geometry: s.geometry,
              properties: {
                segment_id: s.segment_id,
                tcs_value: s.tcs_value,
              },
            })),
          });
        }
        onSegmentMetaChangeRef.current?.(segments.length, false);
      } catch {
        if (!signal?.aborted) {
          onSegmentMetaChangeRef.current?.(0, false);
        }
      }
    },
    []
  );

  const loadViewportRef = useRef(loadViewportSegments);
  useEffect(() => {
    loadViewportRef.current = loadViewportSegments;
  }, [loadViewportSegments]);

  // Initialize MapLibre Instance strictly once — callbacks are accessed via stable refs
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let moveDebounceTimer: number | undefined;
    let activeAbort: AbortController | null = null;

    const initialEco = ecoModeRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPENFREEMAP_LIBERTY_STYLE,
      center: [SURABAYA_CENTER.lng, SURABAYA_CENTER.lat],
      zoom: 14.5,
      pitch: initialEco ? 0 : 52,
      bearing: initialEco ? 0 : -12,
      maxPitch: 75,
      minZoom: 11.2,
      pixelRatio: getOptimalPixelRatio(initialEco),
      fadeDuration: initialEco ? 0 : 220,
      maxBounds: [
        [112.52, -7.4],
        [112.92, -7.16],
      ],
      attributionControl: { compact: true },
    });

    mapRef.current = map;

    const scheduleViewportFetch = () => {
      if (moveDebounceTimer) window.clearTimeout(moveDebounceTimer);
      moveDebounceTimer = window.setTimeout(() => {
        activeAbort?.abort();
        activeAbort = new AbortController();
        void loadViewportRef.current(map, activeAbort.signal);
      }, 320);
    };

    map.on('load', () => {
      styleReadyRef.current = true;
      applySurabaya3DUrbanStyle(
        map,
        solarHourRef.current,
        layerModeRef.current
      );
      if (ecoModeRef.current) {
        syncEcoModeLayers(map, true, solarHourRef.current);
      }
      setStyleReady(true);
      onMapReadyRef.current?.(map);
      scheduleViewportFetch();
    });

    map.on('moveend', scheduleViewportFetch);

    map.on('click', (e) => {
      pickCallbackRef.current({
        lat: Number(e.lngLat.lat.toFixed(6)),
        lng: Number(e.lngLat.lng.toFixed(6)),
      });
    });

    return () => {
      if (moveDebounceTimer) window.clearTimeout(moveDebounceTimer);
      activeAbort?.abort();
      styleReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync Eco Mode only when `ecoMode` actually toggles after mount
  useEffect(() => {
    if (prevEcoModeRef.current === ecoMode) return;
    prevEcoModeRef.current = ecoMode;

    const map = mapRef.current;
    if (!map) return;

    const anyMap = map as unknown as {
      setPixelRatio?: (ratio: number) => void;
    };
    if (typeof anyMap.setPixelRatio === 'function') {
      anyMap.setPixelRatio(getOptimalPixelRatio(ecoMode));
    }

    if (styleReadyRef.current) {
      syncEcoModeLayers(map, ecoMode, solarHourRef.current);
      map.easeTo({
        pitch: ecoMode ? 0 : Math.max(map.getPitch(), 52),
        duration: 450,
      });
      void loadViewportRef.current(map);
    }
  }, [ecoMode]);

  // Cursor style when picking point on map
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = pickTarget ? 'crosshair' : '';
  }, [pickTarget]);

  // Sync Solar Hour Lighting & Sky Atmosphere
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    if (!ecoModeRef.current) {
      configureAtmosphereAndSky(map, solarHour);
    }
    updateMapSunLighting(map, solarHour);
  }, [solarHour]);

  // Sync Layer Mode & Lazy-load UHI Heatmap GeoJSON when needed
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    syncMapLayerMode(map, layerMode);

    if (layerMode === 'uhi' && !uhiLoadedRef.current) {
      const ctrl = new AbortController();
      fetchTemperatureHeatmap(ctrl.signal)
        .then((geojson) => {
          const src = map.getSource('teduh-uhi-temp') as
            | GeoJSONSource
            | undefined;
          if (src) {
            src.setData(geojson);
            uhiLoadedRef.current = true;
          }
        })
        .catch(() => {
          // Biarkan kosong tanpa data dummy apabila API tidak aktif
        });
      return () => ctrl.abort();
    }
  }, [layerMode, styleReady]);

  // Sync Active & Alternative Route Ribbons + Auto Fit Bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    ensureRouteLayers(map);

    const activeSrc = map.getSource('teduh-route-active') as
      | GeoJSONSource
      | undefined;
    const altSrc = map.getSource('teduh-route-alt') as
      | GeoJSONSource
      | undefined;
    if (!activeSrc || !altSrc) return;

    if (!routeData || routeData.routes.length === 0) {
      activeSrc.setData({ type: 'FeatureCollection', features: [] });
      altSrc.setData({ type: 'FeatureCollection', features: [] });
      lastFittedRouteKeyRef.current = '';
      return;
    }

    const displayedType = previewRouteType ?? selectedRouteType;
    const selected =
      routeData.routes.find((r) => r.type === displayedType) ??
      routeData.routes.find((r) => r.type === selectedRouteType) ??
      routeData.routes[0];
    const alt = routeData.routes.find((r) => r !== selected);

    const activeColor =
      selected.type === 'most_comfortable'
        ? F4MAP_PALETTE.routeComfortable
        : F4MAP_PALETTE.routeShortest;
    const altColor =
      alt?.type === 'most_comfortable'
        ? F4MAP_PALETTE.routeComfortable
        : F4MAP_PALETTE.routeShortest;

    const isIdentical = routesAreIdentical(selected.geometry, alt?.geometry);

    activeSrc.setData({
      type: 'FeatureCollection',
      features:
        selected.geometry.coordinates.length > 0
          ? [
              {
                type: 'Feature',
                geometry: selected.geometry,
                properties: { color: activeColor },
              },
            ]
          : [],
    });

    altSrc.setData({
      type: 'FeatureCollection',
      features:
        alt && alt.geometry.coordinates.length > 0 && !isIdentical
          ? [
              {
                type: 'Feature',
                geometry: alt.geometry,
                properties: { color: altColor },
              },
            ]
          : [],
    });

    // Auto fit bounds when routeData or committed selectedRouteType changes (not on hover preview)
    const firstCoord = selected.geometry.coordinates[0];
    const lastCoord =
      selected.geometry.coordinates[selected.geometry.coordinates.length - 1];
    const fitKey = firstCoord && lastCoord
      ? `${firstCoord[0].toFixed(5)},${firstCoord[1].toFixed(5)}->${lastCoord[0].toFixed(5)},${lastCoord[1].toFixed(5)}:${selectedRouteType}`
      : '';

    if (
      selected.geometry.coordinates.length >= 2 &&
      !isNavigating &&
      !previewRouteType &&
      fitKey !== lastFittedRouteKeyRef.current
    ) {
      lastFittedRouteKeyRef.current = fitKey;
      const bounds = new maplibregl.LngLatBounds();
      for (const [lng, lat] of selected.geometry.coordinates) {
        bounds.extend([lng, lat]);
      }
      if (alt && alt.geometry.coordinates.length >= 2) {
        for (const [lng, lat] of alt.geometry.coordinates) {
          bounds.extend([lng, lat]);
        }
      }
      const isMobile =
        typeof window !== 'undefined' && window.innerWidth < 640;
      map.fitBounds(bounds, {
        padding: isMobile
          ? { top: 88, bottom: 220, left: 40, right: 40 }
          : { top: 96, bottom: 140, left: 396, right: 96 },
        pitch: ecoModeRef.current ? 0 : 52,
        maxZoom: 16.8,
        duration: 850,
      });
    }
  }, [
    routeData,
    selectedRouteType,
    previewRouteType,
    isNavigating,
    styleReady,
  ]);

  // Follow active navigation anchor (always starting at current Origin A unless verified on-route GPS)
  useEffect(() => {
    const map = mapRef.current;
    const targetPos = navPosition ?? origin;
    if (!map || !isNavigating || !targetPos) return;

    const chosenRoute =
      routeData?.routes.find((r) => r.type === selectedRouteType) ??
      routeData?.routes[0];
    const heading = computeInitialRouteBearing(
      chosenRoute?.geometry,
      origin,
      destination
    );

    map.easeTo({
      center: [targetPos.lng, targetPos.lat],
      zoom: Math.max(map.getZoom(), 17.4),
      pitch: ecoModeRef.current ? 0 : 62,
      bearing: ecoModeRef.current ? 0 : heading,
      duration: 850,
    });
  }, [
    isNavigating,
    navPosition,
    origin,
    destination,
    routeData,
    selectedRouteType,
  ]);

  // Origin Marker (A)
  useEffect(() => {
    originMarkerRef.current?.remove();
    originMarkerRef.current = null;
    const map = mapRef.current;
    if (!map || !origin) return;

    const el = document.createElement('div');
    el.className =
      'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#0E7C86] font-mono text-xs font-bold text-white shadow-lg';
    el.textContent = 'A';
    el.title = `Titik asal: ${origin.label}`;

    originMarkerRef.current = new maplibregl.Marker({
      element: el,
      anchor: 'center',
    })
      .setLngLat([origin.lng, origin.lat])
      .addTo(map);
  }, [origin]);

  // Destination Marker (B)
  useEffect(() => {
    destMarkerRef.current?.remove();
    destMarkerRef.current = null;
    const map = mapRef.current;
    if (!map || !destination) return;

    const el = document.createElement('div');
    el.className =
      'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#B42318] font-mono text-xs font-bold text-white shadow-lg';
    el.textContent = 'B';
    el.title = `Tujuan: ${destination.label}`;

    destMarkerRef.current = new maplibregl.Marker({
      element: el,
      anchor: 'center',
    })
      .setLngLat([destination.lng, destination.lat])
      .addTo(map);
  }, [destination]);

  // Live User GPS Puck
  useEffect(() => {
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    const map = mapRef.current;
    if (!map || !userLocation) return;

    const el = document.createElement('div');
    el.className =
      'relative flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/25';
    const core = document.createElement('span');
    core.className =
      'h-3.5 w-3.5 rounded-full border-2 border-white bg-sky-600 shadow-md';
    el.appendChild(core);

    userMarkerRef.current = new maplibregl.Marker({
      element: el,
      anchor: 'center',
    })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(map);
  }, [userLocation]);

  // CCTV Dishub Markers along Route Corridor
  useEffect(() => {
    for (const m of cctvMarkersRef.current) m.remove();
    cctvMarkersRef.current = [];

    const map = mapRef.current;
    if (!map || cctvCameras.length === 0) return;

    cctvMarkersRef.current = cctvCameras.map((cam) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = `Pantau CCTV: ${cam.name}`;
      btn.setAttribute('aria-label', `Pantau CCTV ${cam.name}`);
      btn.className =
        'flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/95 px-2 py-1 text-[10px] font-semibold text-white shadow-md transition-transform hover:scale-105 cursor-pointer';
      btn.innerHTML = `<span style="width:6px;height:6px;border-radius:9999px;background:#22c55e;display:inline-block"></span><span>CCTV</span>`;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onSelectCCTVRef.current(cam);
      });

      return new maplibregl.Marker({ element: btn, anchor: 'bottom' })
        .setLngLat([cam.lng, cam.lat])
        .addTo(map);
    });
  }, [cctvCameras]);

  // Active TEDUH-Eye Community Map Alert Markers
  useEffect(() => {
    for (const m of alertMarkersRef.current) m.remove();
    alertMarkersRef.current = [];

    const map = mapRef.current;
    if (!map || activeAlerts.length === 0) return;

    alertMarkersRef.current = activeAlerts.map((alert) => {
      const hex = getSeverityHex(alert.severity);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = `${alert.category}: ${alert.description}`;
      btn.setAttribute('aria-label', `Peringatan jalur: ${alert.description}`);
      btn.className =
        'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-extrabold text-white shadow-lg transition-transform hover:scale-110 cursor-pointer';
      btn.style.backgroundColor = hex;
      btn.textContent = '!';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onSelectAlertRef.current(alert);
      });

      return new maplibregl.Marker({ element: btn, anchor: 'center' })
        .setLngLat([alert.lon, alert.lat])
        .addTo(map);
    });
  }, [activeAlerts]);

  return (
    <div
      ref={containerRef}
      suppressHydrationWarning
      className="relative h-full w-full select-none"
      aria-label="Kanvas Peta Kota Surabaya 3D"
    />
  );
});
