/**
 * TEDUH 3D Urban Style Engine for MapLibre GL JS v5
 *
 * Mengadopsi arsitektur multi-pass roadbed + warm limestone 3D building extrusion
 * bergaya F4Map / Apple Maps dari design-reference, tanpa objek Three.js fiktif
 * dan terhubung penuh ke layer GeoJSON faktual PostGIS (/api/segments/tcs & /temperature-heatmap).
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MapLayerMode } from '@/types';
import { calculateSurabayaSolarPosition } from '@/utils/geoMath';

export const OPENFREEMAP_LIBERTY_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

export const F4MAP_PALETTE = {
  landBackground: '#F4F2EC',
  parkGreen: '#7FA35C',
  parkOutline: '#6B8E4A',
  waterNavy: '#1E3246',
  sidewalkCasing: '#B8BCC2',
  asphaltRoadbed: '#5A5F68',
  laneMarkingWhite: '#F8FAFC',
  routeComfortable: '#0E7C86',
  routeShortest: '#2563EB',
};

export function applySurabaya3DUrbanStyle(
  map: MapLibreMap,
  solarHour: number,
  mode: MapLayerMode
): void {
  if (!map || !map.isStyleLoaded()) return;

  configureAtmosphereAndSky(map, solarHour);
  restyleLandAndHydrology(map, solarHour);
  injectMultiPassRoadNetwork(map);
  configure3DBuildings(map);
  initializeFactualDataLayers(map);
  updateMapSunLighting(map, solarHour);
  syncMapLayerMode(map, mode);
}

export function configureAtmosphereAndSky(
  map: MapLibreMap,
  solarHour: number
): void {
  const { isNight, isGoldenHour } = calculateSurabayaSolarPosition(solarHour);

  const skyColor = isNight ? '#0B1329' : isGoldenHour ? '#F59E0B' : '#BFD8EE';
  const horizonColor = isNight
    ? '#1E293B'
    : isGoldenHour
      ? '#FCD34D'
      : '#F3EEE4';
  const fogColor = isNight ? '#0F172A' : isGoldenHour ? '#FDE68A' : '#F3EEE4';

  const anyMap = map as unknown as {
    setSky?: (spec: Record<string, unknown>) => void;
    setFog?: (spec: Record<string, unknown>) => void;
  };

  try {
    if (typeof anyMap.setSky === 'function') {
      anyMap.setSky({
        'sky-color': skyColor,
        'horizon-color': horizonColor,
        'sky-horizon-blend': 0.45,
      });
    }
    if (typeof anyMap.setFog === 'function') {
      anyMap.setFog({
        range: [-1, 10],
        color: fogColor,
        'horizon-blend': 0.25,
      });
    }
    if (map.getLayer('background')) {
      map.setPaintProperty(
        'background',
        'background-color',
        isNight ? '#0B111E' : isGoldenHour ? '#F7F0E6' : F4MAP_PALETTE.landBackground
      );
    }
  } catch {
    // Abaikan jika spesifikasi sky/fog berbeda antar driver GPU
  }
}

export function updateMapSunLighting(
  map: MapLibreMap,
  solarHour: number
): void {
  if (!map || !map.isStyleLoaded()) return;

  const { azimuthDeg, zenithDeg, isNight, isGoldenHour } =
    calculateSurabayaSolarPosition(solarHour);

  const lightColor = isNight ? '#94A3B8' : isGoldenHour ? '#FEF3C7' : '#FFFFFF';
  const intensity = isNight ? 0.28 : isGoldenHour ? 0.52 : 0.46;
  const clampedPolar = Math.max(22, Math.min(zenithDeg, 58));

  try {
    map.setLight({
      anchor: 'map',
      position: [1.35, azimuthDeg, clampedPolar],
      color: lightColor,
      intensity,
    });

    const buildingLayerId = map.getLayer('building-3d')
      ? 'building-3d'
      : map.getLayer('3d-buildings')
        ? '3d-buildings'
        : map.getLayer('teduh-3d-buildings')
          ? 'teduh-3d-buildings'
          : null;

    if (buildingLayerId) {
      if (isNight) {
        map.setPaintProperty(buildingLayerId, 'fill-extrusion-color', [
          'match',
          ['%', ['coalesce', ['id'], 1], 6],
          0,
          '#1E293B',
          1,
          '#FDE68A',
          2,
          '#273449',
          3,
          '#E0F2FE',
          4,
          '#172030',
          '#2D3748',
        ]);
      } else {
        map.setPaintProperty(buildingLayerId, 'fill-extrusion-color', [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'render_height'], 8],
          0,
          '#EAE7E0',
          14,
          '#DFDCD4',
          30,
          '#D5D1C8',
          60,
          '#C6C2B8',
        ]);
      }
    }
  } catch {
    // Abaikan jika style belum siap penuh
  }
}

function restyleLandAndHydrology(map: MapLibreMap, solarHour: number): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  const { isNight } = calculateSurabayaSolarPosition(solarHour);

  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();

    if (layer.type === 'background') {
      try {
        map.setPaintProperty(
          layer.id,
          'background-color',
          isNight ? '#0B111E' : F4MAP_PALETTE.landBackground
        );
      } catch {}
    }

    if (
      id.includes('water') ||
      id.includes('river') ||
      id.includes('canal') ||
      id.includes('ocean')
    ) {
      try {
        if (layer.type === 'fill') {
          map.setPaintProperty(layer.id, 'fill-color', F4MAP_PALETTE.waterNavy);
          map.setPaintProperty(layer.id, 'fill-opacity', 0.94);
        } else if (layer.type === 'line') {
          map.setPaintProperty(layer.id, 'line-color', F4MAP_PALETTE.waterNavy);
        }
      } catch {}
    }

    if (
      id.includes('park') ||
      id.includes('grass') ||
      id.includes('wood') ||
      id.includes('forest') ||
      id.includes('garden') ||
      id.includes('green')
    ) {
      try {
        if (layer.type === 'fill') {
          map.setPaintProperty(layer.id, 'fill-color', F4MAP_PALETTE.parkGreen);
          map.setPaintProperty(layer.id, 'fill-opacity', 0.85);
          map.setPaintProperty(
            layer.id,
            'fill-outline-color',
            F4MAP_PALETTE.parkOutline
          );
        }
      } catch {}
    }
  }
}

function findFirstSymbolLayerId(map: MapLibreMap): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  for (const l of layers) {
    if (l.type === 'symbol') return l.id;
  }
  return undefined;
}

function findBuildingExtrusionLayerId(map: MapLibreMap): string | undefined {
  if (map.getLayer('building-3d')) return 'building-3d';
  if (map.getLayer('3d-buildings')) return '3d-buildings';
  if (map.getLayer('teduh-3d-buildings')) return 'teduh-3d-buildings';
  return undefined;
}

function injectMultiPassRoadNetwork(map: MapLibreMap): void {
  if (!map.getSource('openmaptiles') || map.getLayer('f4map-sidewalk-casing')) {
    return;
  }

  const beforeId = findBuildingExtrusionLayerId(map) ?? findFirstSymbolLayerId(map);

  try {
    map.addLayer(
      {
        id: 'f4map-sidewalk-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['all', ['!=', 'class', 'rail'], ['!=', 'class', 'transit']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': F4MAP_PALETTE.sidewalkCasing,
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            13,
            2.6,
            15,
            7.5,
            17,
            17,
            19,
            32,
          ],
          'line-opacity': 0.94,
        },
      },
      beforeId
    );

    map.addLayer(
      {
        id: 'f4map-asphalt-roadbed',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['all', ['!=', 'class', 'rail'], ['!=', 'class', 'transit']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': F4MAP_PALETTE.asphaltRoadbed,
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            13,
            1.8,
            15,
            5.5,
            17,
            12.5,
            19,
            24,
          ],
        },
      },
      beforeId
    );

    map.addLayer(
      {
        id: 'f4map-lane-markings',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: [
          'in',
          'class',
          'primary',
          'secondary',
          'tertiary',
          'trunk',
          'motorway',
        ],
        minzoom: 14.5,
        layout: { 'line-cap': 'butt', 'line-join': 'miter' },
        paint: {
          'line-color': F4MAP_PALETTE.laneMarkingWhite,
          'line-dasharray': [2, 3],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14.5,
            0.8,
            16.5,
            1.5,
            19,
            2.8,
          ],
          'line-opacity': 0.85,
        },
      },
      beforeId
    );
  } catch {
    // Abaikan jika source-layer transportation tidak tersedia
  }
}

function configure3DBuildings(map: MapLibreMap): void {
  if (map.getLayer('building')) {
    try {
      map.setPaintProperty('building', 'fill-outline-color', 'rgba(0,0,0,0)');
      map.setPaintProperty('building', 'fill-color', '#EAE7E0');
    } catch {}
  }

  const existing3d = map.getLayer('building-3d')
    ? 'building-3d'
    : map.getLayer('3d-buildings')
      ? '3d-buildings'
      : null;

  if (existing3d) {
    try {
      map.setPaintProperty(existing3d, 'fill-extrusion-height', [
        'interpolate',
        ['linear'],
        ['zoom'],
        13.2,
        0,
        14.2,
        [
          'case',
          ['has', 'render_height'],
          ['max', ['get', 'render_height'], 4.2],
          ['has', 'levels'],
          ['*', ['get', 'levels'], 3.5],
          6.5,
        ],
      ]);
      map.setPaintProperty(existing3d, 'fill-extrusion-base', [
        'coalesce',
        ['get', 'render_min_height'],
        0,
      ]);
      map.setPaintProperty(existing3d, 'fill-extrusion-vertical-gradient', true);
      map.setPaintProperty(existing3d, 'fill-extrusion-opacity', 0.94);
      return;
    } catch {}
  }

  if (map.getSource('openmaptiles') && !map.getLayer('teduh-3d-buildings')) {
    try {
      map.addLayer(
        {
          id: 'teduh-3d-buildings',
          source: 'openmaptiles',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 13.2,
          paint: {
            'fill-extrusion-color': '#DFDCD4',
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13.2,
              0,
              14.2,
              ['coalesce', ['get', 'render_height'], 6.5],
            ],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.94,
            'fill-extrusion-vertical-gradient': true,
          },
        },
        findFirstSymbolLayerId(map)
      );
    } catch {}
  }
}

export function initializeFactualDataLayers(map: MapLibreMap): void {
  const beforeSymbol = findFirstSymbolLayerId(map);
  const beforeBuildings = findBuildingExtrusionLayerId(map) ?? beforeSymbol;

  // 1. Layer Segmen Kenyamanan Termal (TCS) dari PostGIS /api/segments/tcs
  if (!map.getSource('teduh-tcs-segments')) {
    map.addSource('teduh-tcs-segments', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer(
      {
        id: 'teduh-tcs-casing',
        type: 'line',
        source: 'teduh-tcs-segments',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#FFFFFF',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            2.2,
            15,
            5.5,
            18,
            10,
          ],
          'line-opacity': 0.55,
        },
      },
      beforeBuildings
    );

    map.addLayer(
      {
        id: 'teduh-tcs-line',
        type: 'line',
        source: 'teduh-tcs-segments',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'step',
            ['coalesce', ['get', 'tcs_value'], 0.5],
            '#B42318', // < 0.35 Panas Ekstrem
            0.35,
            '#D9532F', // 0.35 - 0.49 Panas Terik
            0.5,
            '#D9822B', // 0.50 - 0.69 Cukup Hangat
            0.7,
            '#1F8A5B', // >= 0.70 Teduh & Nyaman
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            1.4,
            15,
            3.8,
            18,
            7.2,
          ],
          'line-opacity': 0.9,
        },
      },
      beforeBuildings
    );
  }

  // 2. Layer Heatmap Suhu Apparent (UHI) dari PostGIS /api/dashboard/temperature-heatmap
  if (!map.getSource('teduh-uhi-temp')) {
    map.addSource('teduh-uhi-temp', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer(
      {
        id: 'teduh-uhi-heatmap',
        type: 'heatmap',
        source: 'teduh-uhi-temp',
        maxzoom: 18,
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'temp'], 31],
            28,
            0.15,
            32,
            0.45,
            35,
            0.8,
            38,
            1.0,
          ],
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            0.8,
            16,
            2.2,
          ],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(37, 99, 235, 0)',
            0.2,
            'rgba(14, 165, 233, 0.55)',
            0.45,
            'rgba(34, 197, 94, 0.68)',
            0.7,
            'rgba(245, 158, 11, 0.82)',
            0.9,
            'rgba(239, 68, 68, 0.9)',
            1,
            'rgba(153, 27, 27, 0.96)',
          ],
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            14,
            15,
            28,
            17,
            40,
          ],
          'heatmap-opacity': 0.82,
        },
      },
      beforeBuildings
    );

    map.addLayer(
      {
        id: 'teduh-uhi-points',
        type: 'circle',
        source: 'teduh-uhi-temp',
        minzoom: 15,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            3,
            18,
            7,
          ],
          'circle-color': [
            'step',
            ['coalesce', ['get', 'temp'], 32],
            '#0EA5E9',
            31,
            '#22C55E',
            33.5,
            '#F59E0B',
            35.5,
            '#EF4444',
            37.5,
            '#991B1B',
          ],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 1,
          'circle-opacity': 0.9,
        },
      },
      beforeSymbol
    );
  }

  // 3. Layer Rute Alternatif (Dashed Comparison Ribbon)
  if (!map.getSource('teduh-route-alt')) {
    map.addSource('teduh-route-alt', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer(
      {
        id: 'teduh-route-alt-line',
        type: 'line',
        source: 'teduh-route-alt',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#64748B',
          'line-dasharray': [2, 2.2],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            2.5,
            15,
            4.5,
            18,
            7.5,
          ],
          'line-opacity': 0.78,
        },
      },
      beforeSymbol
    );
  }

  // 4. Layer Rute Utama Terpilih (White Crisp Casing + Brand Core)
  if (!map.getSource('teduh-route-active')) {
    map.addSource('teduh-route-active', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer(
      {
        id: 'teduh-route-casing',
        type: 'line',
        source: 'teduh-route-active',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#FFFFFF',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            5.5,
            15,
            9,
            18,
            14,
          ],
          'line-opacity': 0.98,
        },
      },
      beforeSymbol
    );

    map.addLayer(
      {
        id: 'teduh-route-core',
        type: 'line',
        source: 'teduh-route-active',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], F4MAP_PALETTE.routeComfortable],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            3.2,
            15,
            5.6,
            18,
            9.5,
          ],
          'line-opacity': 1,
        },
      },
      beforeSymbol
    );
  }
}

export function syncMapLayerMode(map: MapLibreMap, mode: MapLayerMode): void {
  if (!map || !map.isStyleLoaded()) return;

  const tcsVis = mode === 'tcs' ? 'visible' : 'none';
  const uhiVis = mode === 'uhi' ? 'visible' : 'none';

  for (const id of ['teduh-tcs-casing', 'teduh-tcs-line']) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', tcsVis);
    }
  }
  for (const id of ['teduh-uhi-heatmap', 'teduh-uhi-points']) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', uhiVis);
    }
  }
}

export function syncEcoModeLayers(
  map: MapLibreMap,
  ecoMode: boolean,
  solarHour: number
): void {
  if (!map || !map.isStyleLoaded()) return;

  const buildingLayerId = findBuildingExtrusionLayerId(map);
  const vis = ecoMode ? 'none' : 'visible';

  try {
    if (buildingLayerId && map.getLayer(buildingLayerId)) {
      map.setLayoutProperty(buildingLayerId, 'visibility', vis);
    }
    if (map.getLayer('f4map-lane-markings')) {
      map.setLayoutProperty('f4map-lane-markings', 'visibility', vis);
    }

    const anyMap = map as unknown as {
      setFog?: (spec: Record<string, unknown> | null) => void;
    };

    if (ecoMode) {
      if (typeof anyMap.setFog === 'function') {
        anyMap.setFog(null);
      }
    } else {
      configureAtmosphereAndSky(map, solarHour);
      updateMapSunLighting(map, solarHour);
    }
  } catch {
    // Abaikan variasi kapabilitas GPU
  }
}

