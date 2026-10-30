"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import { MAP_ATTRIBUTION, loadMapStyle } from "./mapTheme";

// Basemap: OpenFreeMap vector tiles (free, no API key, no request limits).
// Raster fallback, used only without WebGL or if the style fails to load.
const RASTER_FALLBACK = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

// Half-step zoom feels smoother than whole levels; vector tiles stay sharp.
const MAP_OPTIONS = {
  zoomControl: false,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 110,
  scrollWheelZoom: true,
  minZoom: 4,
  maxZoom: 19,
};

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function VectorBasemap({ onFail }) {
  const map = useMap();

  useEffect(() => {
    let layer = null;
    let cancelled = false;

    loadMapStyle()
      .then((style) => {
        if (cancelled) return;
        // updateInterval 16 keeps the GL canvas in step with Leaflet while
        // panning (the 32ms default visibly lags); padding renders a margin
        // around the view so fast drags don't reveal blank edges.
        layer = L.maplibreGL({ style, updateInterval: 16, padding: 0.3, attributionControl: false });
        layer.addTo(map);
        map.attributionControl?.addAttribution(MAP_ATTRIBUTION);
      })
      .catch(() => {
        if (!cancelled) onFail();
      });

    return () => {
      cancelled = true;
      if (layer) {
        map.attributionControl?.removeAttribution(MAP_ATTRIBUTION);
        map.removeLayer(layer);
      }
    };
  }, [map, onFail]);

  return null;
}

function Basemap() {
  const [vector, setVector] = useState(hasWebGL);
  const fallBack = useRef(() => setVector(false)).current;

  if (vector) return <VectorBasemap onFail={fallBack} />;
  return (
    <TileLayer
      url={RASTER_FALLBACK.url}
      attribution={RASTER_FALLBACK.attribution}
      keepBuffer={4}
      updateWhenZooming={false}
    />
  );
}

/** Keeps Leaflet's size in step with flex/grid layouts and window resizes. */
function SizeSync() {
  const map = useMap();

  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    });
    observer.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

function fitView(map, points, { padding, maxZoom, singleZoom, animate }) {
  if (!points?.length) return;
  if (points.length === 1) {
    map.setView(points[0], singleZoom, { animate });
  } else {
    map.fitBounds(L.latLngBounds(points), { padding: [padding, padding], maxZoom, animate });
  }
}

/**
 * Fits the view only when `fitKey` changes, never on every position
 * update: refitting on each GPS tick is what made the maps jump. The
 * first fit is instant, later ones animate. After the user drags the
 * map, a re-centre button brings the fitted view back.
 */
function ViewFitter({ points, fitKey, padding, maxZoom, singleZoom }) {
  const map = useMap();
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const fittedOnce = useRef(false);
  const [moved, setMoved] = useState(false);
  const buttonRef = useRef(null);
  const options = { padding, maxZoom, singleZoom };

  useEffect(() => {
    if (!fitKey || !pointsRef.current?.length) return;
    fitView(map, pointsRef.current, { ...options, animate: fittedOnce.current });
    fittedOnce.current = true;
    setMoved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);

  useEffect(() => {
    const onDrag = () => setMoved(true);
    map.on("dragstart", onDrag);
    return () => map.off("dragstart", onDrag);
  }, [map]);

  useEffect(() => {
    if (buttonRef.current) L.DomEvent.disableClickPropagation(buttonRef.current);
  }, []);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Re-centre map"
      title="Re-centre"
      className={`sg-map-fab${moved ? "" : " is-hidden"}`}
      onClick={() => {
        fitView(map, pointsRef.current, { ...options, animate: true });
        setMoved(false);
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    </button>
  );
}

/**
 * The one map shell every ShipGoods map uses: premium vector basemap,
 * smooth zoom, responsive sizing, floating controls and a view that
 * fits `fitPoints` whenever `fitKey` changes.
 */
export default function BaseMap({
  center,
  zoom = 13,
  className = "",
  children,
  fitPoints,
  fitKey,
  fitPadding = 72,
  fitMaxZoom = 16,
  singleZoom = 15,
  ...options
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      {...MAP_OPTIONS}
      {...options}
      className={`sg-map h-full w-full ${className}`}
      style={{ height: "100%", width: "100%" }}
    >
      <Basemap />
      <SizeSync />
      <ZoomControl position="bottomright" />
      <ViewFitter
        points={fitPoints}
        fitKey={fitKey}
        padding={fitPadding}
        maxZoom={fitMaxZoom}
        singleZoom={singleZoom}
      />
      {children}
    </MapContainer>
  );
}
