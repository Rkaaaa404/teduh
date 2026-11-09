'use client';

import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { AlertCircle, ExternalLink, Video, X } from 'lucide-react';
import type { CCTVCamera } from '@/types';

interface CCTVModalProps {
  camera: CCTVCamera | null;
  corridorCameras: CCTVCamera[];
  onSelectCamera: (cam: CCTVCamera) => void;
  onClose: () => void;
}

export const CCTVModal: React.FC<CCTVModalProps> = ({
  camera,
  corridorCameras,
  onSelectCamera,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streamState, setStreamState] = useState<'loading' | 'playing' | 'error'>(
    'loading'
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!camera || !video) return;

    setStreamState('loading');
    let hls: Hls | null = null;
    const streamSource = camera.stream_url.replace(
      'http://36.66.208.101:5000/hls',
      '/cctv-hls'
    );

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        manifestLoadingTimeOut: 9000,
      });
      hls.loadSource(streamSource);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStreamState('playing');
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setStreamState('error');
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamSource;
      video.addEventListener('loadedmetadata', () => {
        setStreamState('playing');
        video.play().catch(() => {});
      });
      video.addEventListener('error', () => setStreamState('error'));
    } else {
      setStreamState('error');
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [camera]);

  if (!camera) return null;

  return (
    <aside
      aria-label={`Pantauan langsung CCTV ${camera.name}`}
      className="hud-surface-dark pointer-events-auto absolute right-3 bottom-5 z-30 w-80 overflow-hidden rounded-2xl text-white sm:right-4 sm:w-88"
    >
      {/* PiP Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
          <Video className="h-3.5 w-3.5 shrink-0 text-teal-400" />
          <p className="truncate text-xs font-bold text-slate-100">
            {camera.name}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup jendela CCTV"
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Aspect-Ratio 16:9 HLS Video Container (Zero CLS) */}
      <div className="relative aspect-video w-full bg-slate-950">
        <video
          ref={videoRef}
          muted
          playsInline
          controls
          className="h-full w-full object-cover"
        />

        {streamState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-xs text-slate-300">
            <span>Menghubungkan stream Dishub Surabaya...</span>
          </div>
        )}

        {streamState === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/95 p-4 text-center text-xs text-slate-300">
            <AlertCircle className="h-5 w-5 text-amber-400" />
            <p className="leading-relaxed">
              Stream HLS kamera ini sedang tidak merespons atau diblokir oleh
              kebijakan HTTP/HTTPS browser.
            </p>
            <a
              href={camera.stream_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-teal-300 hover:bg-slate-700"
            >
              <span>Buka URL Stream Asli</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>

      {/* Footer Info & Corridor Camera Switcher */}
      <div className="space-y-2 px-3 py-2 text-[11px]">
        <div className="flex items-center justify-between text-slate-400">
          <span>ID: {camera.cctv_id}</span>
          <span className="font-mono tabular-nums">
            {Math.round(camera.distance_m)} m dari rute
          </span>
        </div>

        {corridorCameras.length > 1 && (
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {corridorCameras.map((item) => {
              const active = item.cctv_id === camera.cctv_id;
              return (
                <button
                  key={item.cctv_id}
                  type="button"
                  onClick={() => onSelectCamera(item)}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    active
                      ? 'bg-[#0E7C86] text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {item.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
