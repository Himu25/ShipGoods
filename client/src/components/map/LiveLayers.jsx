"use client";

import { useEffect, useRef, useState } from "react";
import { Marker, Polyline } from "react-leaflet";
import {
  bearingDegrees,
  easeInOut,
  fetchRoadRoute,
  haversineMeters,
  lerp,
  lerpAngle,
  projectOnRoute,
} from "@/utils/geo";

const JUMP_SNAP_METERS = 400; // a jump bigger than this snaps instead of gliding
const MIN_GLIDE_MS = 500;
const MAX_GLIDE_MS = 3000;
const TURN_MS = 450; // heading settles faster than position, so turns look crisp
const OFF_ROUTE_METERS = 60; // further than this from the line -> re-route
const REROUTE_THROTTLE_MS = 10000;

/**
 * Road route from `from` to `to` ([lat, lng]); refetched when the target
 * or `refreshKey` changes, not on every move of `from`. Returns
 * { points, distanceKm, durationMin } or null while loading.
 */
export function useRoadRoute(from, to, refreshKey = "") {
  const [state, setState] = useState(null);
  const fromRef = useRef(from);
  fromRef.current = from;
  const ready = !!(from && to);
  const toKey = to ? `${to[0]},${to[1]}` : "";

  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    fetchRoadRoute(fromRef.current, to, controller.signal)
      .then((route) => setState({ toKey, route }))
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, toKey, refreshKey]);

  // A route to a previous target is never shown for the new one.
  return ready && state?.toKey === toKey ? state.route : null;
}

/** A static route drawn as stacked polylines (shadow, casing, core). */
export function RouteLine({ points, styles }) {
  if (!points || points.length < 2) return null;
  return styles.map((style, i) => (
    <Polyline key={i} positions={points} pathOptions={style} />
  ));
}

/**
 * Vehicle marker that glides between position updates. Each glide lasts
 * as long as the gap since the previous update, so a steady feed gives
 * continuous motion instead of move-stop-move. `target` is
 * { latitude, longitude, heading? }; posRef receives the animated position.
 */
export function SmoothMarker({ target, icon, posRef }) {
  const markerRef = useRef(null);
  const state = useRef(null);
  const initialPos = useRef(null);

  if (target && !initialPos.current) {
    initialPos.current = [target.latitude, target.longitude];
  }

  useEffect(() => {
    if (!target) return;
    const now = performance.now();
    const cur = state.current;

    if (!cur) {
      const heading = target.heading ?? 0;
      state.current = {
        lat: target.latitude, lng: target.longitude, heading,
        fromLat: target.latitude, fromLng: target.longitude, fromHeading: heading,
        toLat: target.latitude, toLng: target.longitude, toHeading: heading,
        start: now, duration: 0, lastUpdate: now, applied: false,
      };
      return;
    }

    if (
      Math.abs(cur.toLat - target.latitude) < 1e-7 &&
      Math.abs(cur.toLng - target.longitude) < 1e-7
    ) {
      if (typeof target.heading === "number") cur.toHeading = target.heading;
      return;
    }

    const heading =
      typeof target.heading === "number"
        ? target.heading
        : bearingDegrees(cur.lat, cur.lng, target.latitude, target.longitude);

    // A jump this big in one tick isn't the driver moving — it's bad data
    // (a reconnect gap, a GPS glitch, a swapped lat/lng). Snap straight to
    // it instead of gliding, so a data bug looks like what it is.
    const snap =
      haversineMeters(cur.lat, cur.lng, target.latitude, target.longitude) > JUMP_SNAP_METERS;
    const gap = now - cur.lastUpdate;

    state.current = {
      ...cur,
      fromLat: cur.lat, fromLng: cur.lng, fromHeading: cur.heading,
      toLat: target.latitude, toLng: target.longitude, toHeading: heading,
      start: now,
      duration: snap ? 0 : Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, gap)),
      lastUpdate: now,
      applied: false,
    };
  }, [target?.latitude, target?.longitude, target?.heading]);

  useEffect(() => {
    let raf;
    let carEl = null;
    const tick = (now) => {
      const s = state.current;
      const marker = markerRef.current;
      if (s && marker && !s.applied) {
        const elapsed = now - s.start;
        // Linear position keeps chained glides at a constant speed.
        const t = s.duration <= 0 ? 1 : Math.min(1, elapsed / s.duration);
        const turn = s.duration <= 0 ? 1 : easeInOut(Math.min(1, elapsed / Math.min(TURN_MS, s.duration)));
        s.lat = lerp(s.fromLat, s.toLat, t);
        s.lng = lerp(s.fromLng, s.toLng, t);
        s.heading = lerpAngle(s.fromHeading, s.toHeading, turn);
        marker.setLatLng([s.lat, s.lng]);
        if (posRef) posRef.current = { lat: s.lat, lng: s.lng };
        if (!carEl?.isConnected) carEl = marker.getElement()?.querySelector(".sg-veh");
        carEl?.style.setProperty("--h", `${s.heading}deg`);
        s.applied = t >= 1 && turn >= 1;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [posRef]);

  if (!initialPos.current) return null;
  return (
    <Marker
      ref={markerRef}
      position={initialPos.current}
      icon={icon}
      interactive={false}
      keyboard={false}
      zIndexOffset={1000}
    />
  );
}

/**
 * Draws only the road still ahead of the car: every frame the line starts
 * at the car's animated position, so nothing trails behind it (as in ride
 * apps). Calls onOffRoute when the car leaves the line.
 */
export function RemainingRoute({ route, posRef, styles, onOffRoute }) {
  const lineRefs = useRef([]);
  // Survives route changes, so a fresh route can't re-trigger at once.
  const lastReroute = useRef(0);

  useEffect(() => {
    let hint = 0;
    let lastDrawn = null;
    let raf;
    const tick = () => {
      const pos = posRef.current;
      // Redraw only when the car actually moved (not 60x/s while parked).
      const moved =
        pos &&
        (!lastDrawn ||
          Math.abs(lastDrawn.lat - pos.lat) > 1e-6 ||
          Math.abs(lastDrawn.lng - pos.lng) > 1e-6);
      if (moved && route?.length > 1) {
        lastDrawn = pos;
        const hit = projectOnRoute(route, pos.lat, pos.lng, hint);
        hint = hit.index;
        const ahead = [[pos.lat, pos.lng], hit.point, ...route.slice(hit.index + 1)];
        lineRefs.current.forEach((line) => line?.setLatLngs(ahead));
        if (hit.dist > OFF_ROUTE_METERS && Date.now() - lastReroute.current > REROUTE_THROTTLE_MS) {
          lastReroute.current = Date.now();
          onOffRoute?.();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [route, posRef, onOffRoute]);

  if (!route || route.length < 2) return null;
  return styles.map((style, i) => (
    <Polyline
      key={i}
      ref={(el) => (lineRefs.current[i] = el)}
      positions={route}
      pathOptions={style}
    />
  ));
}
