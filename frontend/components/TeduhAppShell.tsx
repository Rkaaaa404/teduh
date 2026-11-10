'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type {
  CCTVCamera,
  Coordinate,
  HeatTolerance,
  MapAlert,
  MapLayerMode,
  PlacePoint,
  RoutePreferenceType,
  RouteResponse,
} from '@/types';
import {
  checkBackendHealth,
  fetchActiveMapAlerts,
  fetchPendingReports,
  fetchRoute,
  fetchRouteCorridorCCTVs,
  reverseGeocodeSurabaya,
} from '@/services/api';
import {
  buildTodayWibDate,
  distanceToPolylineMeters,
  getCurrentWibSolarHour,
  haversineDistanceMeters,
  isWithinSurabayaBounds,
  SURABAYA_CENTER,
} from '@/utils/geoMath';
import { useSurabayaWeather } from '@/hooks/useSurabayaWeather';
import {
  MapView,
  type MapPickTarget,
  type MapViewHandle,
} from '@/components/MapView';
import { Navbar } from '@/components/Navbar';
import { SearchPanel } from '@/components/SearchPanel';
import { RoutePanel } from '@/components/RoutePanel';
import { NavigationOverlay } from '@/components/NavigationOverlay';
import { TCSLegend } from '@/components/TCSLegend';
import { CameraCompassControl } from '@/components/map/CameraCompassControl';
import { TimeScrubberBar } from '@/components/map/TimeScrubberBar';
import { IncidentReportModal } from '@/components/IncidentReportModal';
import { AlertDetailPopover } from '@/components/AlertDetailPopover';
import { ProximityValidationToast } from '@/components/ProximityValidationToast';
import { PostJourneyFeedbackModal } from '@/components/PostJourneyFeedbackModal';

// Code-split heavy secondary bundles (Recharts analytics + HLS.js video player)
// so initial map load parses minimum JavaScript!
const GovernmentDashboard = dynamic(
  () =>
    import('@/components/GovernmentDashboard').then(
      (mod) => mod.GovernmentDashboard
    ),
  { ssr: false }
);

const CCTVModal = dynamic(
  () => import('@/components/CCTVModal').then((mod) => mod.CCTVModal),
  { ssr: false }
);

interface TeduhAppShellProps {
  initialPanel?: 'map' | 'dashboard';
}

const ECO_STORAGE_KEY = 'teduh_eco_mode';

function findNearbyUnvalidatedAlert(
  userLocation: Coordinate | null,
  alerts: MapAlert[],
  dismissedIds: string[]
): { alert: MapAlert; distanceMeters: number } | null {
  if (!userLocation) return null;
  for (const alert of alerts) {
    if (dismissedIds.includes(alert.id)) continue;
    const dist = haversineDistanceMeters(userLocation, {
      lat: alert.lat,
      lng: alert.lon,
    });
    if (dist <= 80) {
      return { alert, distanceMeters: dist };
    }
  }
  return null;
}

export const TeduhAppShell: React.FC<TeduhAppShellProps> = ({
  initialPanel = 'map',
}) => {
  const mapHandleRef = useRef<MapViewHandle | null>(null);
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);

  // Global Spatial & UI State (Hydration-safe deterministic defaults for SSR)
  const [activePanel, setActivePanel] = useState<'map' | 'dashboard'>(
    initialPanel
  );
  const [layerMode, setLayerMode] = useState<MapLayerMode>('tcs');
  const [solarHour, setSolarHour] = useState<number>(12);
  const [ecoMode, setEcoMode] = useState<boolean>(false);

  // Sync client-only URL query, localStorage, and live WIB solar hour after hydration
  useEffect(() => {
    const syncTimer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('panel') === 'pemkot') {
        setActivePanel('dashboard');
      }
      if (window.localStorage.getItem(ECO_STORAGE_KEY) === '1') {
        setEcoMode(true);
      }
      setSolarHour(getCurrentWibSolarHour());
    }, 0);
    return () => window.clearTimeout(syncTimer);
  }, []);

  // Backend & Community State
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<MapAlert[]>([]);
  const [pendingReportsCount, setPendingReportsCount] = useState<number>(0);
  const [segmentCount, setSegmentCount] = useState<number>(0);
  const [loadingSegments, setLoadingSegments] = useState<boolean>(false);

  // Routing & Navigation State
  const [origin, setOrigin] = useState<PlacePoint | null>(null);
  const [destination, setDestination] = useState<PlacePoint | null>(null);
  const [tolerance, setTolerance] = useState<HeatTolerance>('medium');
  const [pickTarget, setPickTarget] = useState<MapPickTarget>(null);
  const [routeData, setRouteData] = useState<RouteResponse | null>(null);
  const [selectedRouteType, setSelectedRouteType] =
    useState<RoutePreferenceType>('most_comfortable');
  const [previewRouteType, setPreviewRouteType] =
    useState<RoutePreferenceType | null>(null);
  const [loadingRoute, setLoadingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState<boolean>(false);
  const [navAnchor, setNavAnchor] = useState<PlacePoint | null>(null);
  const [liveGpsOnRoute, setLiveGpsOnRoute] = useState<Coordinate | null>(null);

  // Geolocation, CCTV, & Modals
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [locatingGps, setLocatingGps] = useState<boolean>(false);
  const [corridorCameras, setCorridorCameras] = useState<CCTVCamera[]>([]);
  const [activeCCTV, setActiveCCTV] = useState<CCTVCamera | null>(null);

  const [reportModalOpen, setReportModalOpen] = useState<boolean>(false);
  const [reportCoord, setReportCoord] = useState<Coordinate>(SURABAYA_CENTER);
  const [selectedAlert, setSelectedAlert] = useState<MapAlert | null>(null);
  const [dismissedProximityIds, setDismissedProximityIds] = useState<string[]>(
    []
  );
  const [feedbackModalOpen, setFeedbackModalOpen] = useState<boolean>(false);

  const { weather } = useSurabayaWeather(solarHour);

  const handleToggleEcoMode = useCallback(() => {
    setEcoMode((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ECO_STORAGE_KEY, next ? '1' : '0');
      }
      return next;
    });
  }, []);

  const handleSegmentMetaChange = useCallback(
    (count: number, loading: boolean) => {
      setSegmentCount((prev) => (loading || prev === count ? prev : count));
      setLoadingSegments((prev) => (prev === loading ? prev : loading));
    },
    []
  );

  const handlePanelSwitch = useCallback((panel: 'map' | 'dashboard') => {
    setActivePanel(panel);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (panel === 'dashboard') {
        url.searchParams.set('panel', 'pemkot');
      } else {
        url.searchParams.delete('panel');
      }
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Poll Backend Health + Active Alerts + Pending Reports Count
  // Pauses automatically when browser tab is hidden to conserve battery & CPU!
  const refreshSystemSignals = useCallback(async (signal?: AbortSignal) => {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return;
    }
    const isUp = await checkBackendHealth(signal);
    if (signal?.aborted) return;
    setBackendOnline(isUp);
    if (!isUp) return;

    const [alerts, pending] = await Promise.all([
      fetchActiveMapAlerts(signal).catch(() => []),
      fetchPendingReports(signal).catch(() => []),
    ]);
    if (signal?.aborted) return;
    setActiveAlerts(alerts);
    setPendingReportsCount(pending.length);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const initialTimer = window.setTimeout(() => {
      void refreshSystemSignals(ctrl.signal);
    }, 0);
    const interval = window.setInterval(() => {
      void refreshSystemSignals();
    }, 30_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshSystemSignals();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      ctrl.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshSystemSignals]);

  // Derived active route & cameras when both points are present
  const visibleRouteData = origin && destination ? routeData : null;
  const visibleCorridorCameras = useMemo(
    () => (origin && destination && routeData ? corridorCameras : []),
    [origin, destination, routeData, corridorCameras]
  );

  // Calculate Route + Sample Corridor CCTVs
  const executeRouteCalculation = useCallback(
    async (signal?: AbortSignal) => {
      if (!origin || !destination) return;
      if (
        !isWithinSurabayaBounds(origin) ||
        !isWithinSurabayaBounds(destination)
      ) {
        setRouteError(
          'Titik keberangkatan dan tujuan harus berada di dalam wilayah Kota Surabaya.'
        );
        return;
      }

      setLoadingRoute(true);
      setRouteError(null);
      try {
        const departureIso = buildTodayWibDate(solarHour).toISOString();
        const result = await fetchRoute(
          origin,
          destination,
          tolerance,
          departureIso,
          signal
        );
        if (signal?.aborted) return;

        setRouteData(result);
        setPreviewRouteType(null);
        const recType =
          result.heat_budget.recommended_route === 'shortest'
            ? 'shortest'
            : 'most_comfortable';
        setSelectedRouteType(recType);

        const primaryRoute =
          result.routes.find((r) => r.type === recType) ?? result.routes[0];
        if (primaryRoute && primaryRoute.geometry.coordinates.length > 0) {
          const cams = await fetchRouteCorridorCCTVs(
            primaryRoute.geometry,
            signal
          );
          if (!signal?.aborted) setCorridorCameras(cams);
        } else {
          setCorridorCameras([]);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setRouteError(
            err instanceof Error
              ? err.message
              : 'Gagal menghitung rute. Pastikan layanan FastAPI berjalan.'
          );
        }
      } finally {
        if (!signal?.aborted) setLoadingRoute(false);
      }
    },
    [origin, destination, tolerance, solarHour]
  );

  useEffect(() => {
    if (!origin || !destination) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      void executeRouteCalculation(ctrl.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, tolerance]);

  // Refresh Corridor CCTVs when user switches between Ternyaman vs Tercepat
  useEffect(() => {
    if (!visibleRouteData) return;
    const chosen = visibleRouteData.routes.find(
      (r) => r.type === selectedRouteType
    );
    if (!chosen || chosen.geometry.coordinates.length === 0) return;

    const ctrl = new AbortController();
    fetchRouteCorridorCCTVs(chosen.geometry, ctrl.signal)
      .then((cams) => {
        if (!ctrl.signal.aborted) setCorridorCameras(cams);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [visibleRouteData, selectedRouteType]);

  // Browser GPS Locate Helper
  const handleLocateUser = useCallback((assignAsOrigin = false) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setRouteError('Perangkat atau browser ini tidak mendukung Geolocation.');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coord: Coordinate = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        setUserLocation(coord);
        setLocatingGps(false);

        if (isWithinSurabayaBounds(coord)) {
          mapHandleRef.current?.flyToCoordinate(coord, 16.5);
          if (assignAsOrigin) {
            const label = await reverseGeocodeSurabaya(coord.lat, coord.lng);
            setOrigin({ ...coord, label: `GPS: ${label}` });
          }
        } else if (assignAsOrigin) {
          setRouteError(
            'Lokasi GPS Anda saat ini berada di luar wilayah layanan Surabaya — silakan pilih titik di peta.'
          );
        }
      },
      () => {
        setLocatingGps(false);
        if (assignAsOrigin) {
          setRouteError(
            'Izin lokasi ditolak. Gunakan pencarian atau klik langsung di peta.'
          );
        }
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const activeRouteObj = useMemo(() => {
    if (!visibleRouteData || visibleRouteData.routes.length === 0) return null;
    return (
      visibleRouteData.routes.find((r) => r.type === selectedRouteType) ??
      visibleRouteData.routes[0]
    );
  }, [visibleRouteData, selectedRouteType]);

  // Continuous GPS Tracking + <=30m Destination Arrival Callback during Active Walking Navigation
  // Strictly filters out stale / inaccurate / off-corridor laptop IP geolocation so navigation
  // never snaps back to a previous test location!
  useEffect(() => {
    if (
      !isNavigating ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation
    ) {
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const ageMs = Math.abs(Date.now() - (pos.timestamp || Date.now()));
        const accuracyM = pos.coords.accuracy ?? 999;
        if (ageMs > 15_000 || accuracyM > 65) {
          return;
        }

        const nextLoc: Coordinate = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };

        const distFromCorridor = distanceToPolylineMeters(
          nextLoc,
          activeRouteObj?.geometry
        );
        if (distFromCorridor > 150) {
          return;
        }

        setLiveGpsOnRoute(nextLoc);
        setUserLocation(nextLoc);

        if (destination && haversineDistanceMeters(nextLoc, destination) <= 30) {
          setIsNavigating(false);
          setFeedbackModalOpen(true);
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isNavigating, destination, activeRouteObj]);

  // Pure Derived <=80m Proximity Alert Prompt
  const proximityPrompt = useMemo(
    () =>
      findNearbyUnvalidatedAlert(
        userLocation,
        activeAlerts,
        dismissedProximityIds
      ),
    [userLocation, activeAlerts, dismissedProximityIds]
  );

  // Helper to assign a manual Origin A while clearing any stale GPS location from earlier tests
  const assignManualOrigin = useCallback((point: PlacePoint | null) => {
    setOrigin(point);
    setNavAnchor(point);
    setLiveGpsOnRoute(null);
    setUserLocation(null);
  }, []);

  // Map Coordinate Click Handler
  const handleMapCoordinatePick = useCallback(
    async (coord: Coordinate) => {
      if (pickTarget === 'incident') {
        setReportCoord(coord);
        setPickTarget(null);
        setReportModalOpen(true);
        return;
      }

      if (!isWithinSurabayaBounds(coord)) {
        setRouteError(
          'Titik yang diklik berada di luar batas jaringan Kota Surabaya.'
        );
        return;
      }

      setRouteError(null);

      if (pickTarget === 'origin') {
        setPickTarget(null);
        const label = await reverseGeocodeSurabaya(coord.lat, coord.lng);
        assignManualOrigin({ ...coord, label });
        return;
      }

      if (pickTarget === 'destination') {
        setPickTarget(null);
        const label = await reverseGeocodeSurabaya(coord.lat, coord.lng);
        setDestination({ ...coord, label });
        return;
      }

      if (!isNavigating && activePanel === 'map') {
        if (!origin) {
          const label = await reverseGeocodeSurabaya(coord.lat, coord.lng);
          assignManualOrigin({ ...coord, label });
        } else if (!destination) {
          const label = await reverseGeocodeSurabaya(coord.lat, coord.lng);
          setDestination({ ...coord, label });
        }
      }
    },
    [
      pickTarget,
      isNavigating,
      activePanel,
      origin,
      destination,
      assignManualOrigin,
    ]
  );

  const openReportAtCurrentContext = useCallback(() => {
    if (userLocation && isWithinSurabayaBounds(userLocation)) {
      setReportCoord(userLocation);
    } else if (origin && isWithinSurabayaBounds(origin)) {
      setReportCoord(origin);
    } else if (mapInstance) {
      const c = mapInstance.getCenter();
      setReportCoord({
        lat: Number(c.lat.toFixed(6)),
        lng: Number(c.lng.toFixed(6)),
      });
    } else {
      setReportCoord(SURABAYA_CENTER);
    }
    setReportModalOpen(true);
  }, [userLocation, origin, mapInstance]);

  const handleStartNavigation = useCallback(() => {
    if (!origin || !destination || !activeRouteObj || loadingRoute) return;
    setPreviewRouteType(null);
    setNavAnchor(origin);
    setLiveGpsOnRoute(null);
    if (
      userLocation &&
      distanceToPolylineMeters(userLocation, activeRouteObj.geometry) > 150
    ) {
      setUserLocation(null);
    }
    setIsNavigating(true);
  }, [origin, destination, activeRouteObj, loadingRoute, userLocation]);

  const activeNavPosition: Coordinate | null = isNavigating
    ? (liveGpsOnRoute ?? navAnchor ?? origin)
    : null;
  const isSimulatedGps = !liveGpsOnRoute;

  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-[#F4F2EC]">
      <MapView
        ref={mapHandleRef}
        origin={origin}
        destination={destination}
        userLocation={userLocation}
        navPosition={activeNavPosition}
        routeData={visibleRouteData}
        selectedRouteType={selectedRouteType}
        previewRouteType={previewRouteType}
        cctvCameras={visibleCorridorCameras}
        activeAlerts={activeAlerts}
        layerMode={layerMode}
        solarHour={solarHour}
        ecoMode={ecoMode}
        isNavigating={isNavigating}
        pickTarget={pickTarget}
        onMapReady={setMapInstance}
        onMapCoordinatePick={handleMapCoordinatePick}
        onSelectCCTV={setActiveCCTV}
        onSelectAlert={setSelectedAlert}
        onSegmentMetaChange={handleSegmentMetaChange}
      />

      <Navbar
        activePanel={activePanel}
        onChangePanel={handlePanelSwitch}
        pendingReportsCount={pendingReportsCount}
        backendOnline={backendOnline}
        onOpenReportModal={openReportAtCurrentContext}
      />

      <SearchPanel
        origin={origin}
        destination={destination}
        tolerance={tolerance}
        pickTarget={pickTarget}
        loadingRoute={loadingRoute}
        errorMessage={routeError}
        hidden={isNavigating}
        onSelectOrigin={assignManualOrigin}
        onSelectDestination={setDestination}
        onSwapPoints={() => {
          const prevOrigin = origin;
          assignManualOrigin(destination);
          setDestination(prevOrigin);
        }}
        onClearAll={() => {
          assignManualOrigin(null);
          setDestination(null);
          setRouteData(null);
          setPreviewRouteType(null);
          setRouteError(null);
          setCorridorCameras([]);
          setActiveCCTV(null);
        }}
        onToleranceChange={setTolerance}
        onPickTargetChange={setPickTarget}
        onUseMyGpsForOrigin={() => handleLocateUser(true)}
        onSubmitRoute={() => void executeRouteCalculation()}
      />

      {pickTarget === 'incident' && (
        <div className="hud-surface-dark pointer-events-auto absolute top-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-xs font-semibold text-white">
          <span>Klik tepat pada titik kendala di peta</span>
          <button
            type="button"
            onClick={() => {
              setPickTarget(null);
              setReportModalOpen(true);
            }}
            className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] hover:bg-white/25"
          >
            Batal
          </button>
        </div>
      )}

      <CameraCompassControl
        map={mapInstance}
        weather={weather}
        ecoMode={ecoMode}
        onToggleEcoMode={handleToggleEcoMode}
        onLocateMe={() => handleLocateUser(false)}
        locating={locatingGps}
      />

      <RoutePanel
        routeData={visibleRouteData}
        selectedRouteType={selectedRouteType}
        previewRouteType={previewRouteType}
        loadingRoute={loadingRoute}
        cctvCameras={visibleCorridorCameras}
        hidden={isNavigating}
        onSelectRouteType={setSelectedRouteType}
        onPreviewRouteType={setPreviewRouteType}
        onStartNavigation={handleStartNavigation}
        onOpenCCTV={setActiveCCTV}
        onOpenIncidentModal={openReportAtCurrentContext}
      />

      <TimeScrubberBar
        solarHour={solarHour}
        onSolarHourChange={setSolarHour}
        hidden={isNavigating}
      />

      {isNavigating && activeRouteObj && destination && (
        <NavigationOverlay
          activeRoute={activeRouteObj}
          origin={navAnchor ?? origin}
          destination={destination}
          navPosition={activeNavPosition}
          isSimulatedGps={isSimulatedGps}
          onOpenReportModal={openReportAtCurrentContext}
          onFinishNavigation={() => {
            setIsNavigating(false);
            setFeedbackModalOpen(true);
          }}
        />
      )}

      <TCSLegend
        mode={layerMode}
        onModeChange={setLayerMode}
        segmentCount={segmentCount}
        loadingSegments={loadingSegments}
        offsetForPip={Boolean(activeCCTV)}
      />

      {activeCCTV && (
        <CCTVModal
          camera={activeCCTV}
          corridorCameras={visibleCorridorCameras}
          onSelectCamera={setActiveCCTV}
          onClose={() => setActiveCCTV(null)}
        />
      )}

      <AlertDetailPopover
        alert={selectedAlert}
        userLocation={userLocation}
        onClose={() => setSelectedAlert(null)}
        onValidated={() => void refreshSystemSignals()}
      />

      {proximityPrompt && (
        <ProximityValidationToast
          alert={proximityPrompt.alert}
          distanceMeters={proximityPrompt.distanceMeters}
          onDismiss={() =>
            setDismissedProximityIds((prev) => [
              ...prev,
              proximityPrompt.alert.id,
            ])
          }
          onValidated={() => {
            setDismissedProximityIds((prev) => [
              ...prev,
              proximityPrompt.alert.id,
            ]);
            void refreshSystemSignals();
          }}
        />
      )}

      <IncidentReportModal
        open={reportModalOpen}
        coordinate={reportCoord}
        onClose={() => setReportModalOpen(false)}
        onPickCoordinateOnMap={() => {
          setReportModalOpen(false);
          setPickTarget('incident');
        }}
        onSubmitted={() => void refreshSystemSignals()}
      />

      <PostJourneyFeedbackModal
        open={feedbackModalOpen}
        predictedTcs={activeRouteObj?.avg_tcs ?? null}
        onClose={() => setFeedbackModalOpen(false)}
        onRequestIncidentReport={openReportAtCurrentContext}
      />

      {activePanel === 'dashboard' && (
        <GovernmentDashboard
          open={true}
          onClose={() => handlePanelSwitch('map')}
          onFlyToMap={(coord) => {
            handlePanelSwitch('map');
            mapHandleRef.current?.flyToCoordinate(coord, 17.4);
          }}
          onModerationMutated={() => void refreshSystemSignals()}
        />
      )}
    </main>
  );
};
