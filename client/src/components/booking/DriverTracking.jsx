"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { MapContainer, Marker, TileLayer, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useSocket } from "@/context/SocketContext";
import MapResizeFix from "../MapResizeFix";
import {
  pickupIcon,
  dropoffIcon,
  liveDriverIcon,
  DEFAULT_CENTER,
  MAP_TILE,
  ROUTE_LINE_STYLES,
} from "@/utils/mapIcons";

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const GLIDE_MS = 900;
const TERMINAL_STATUSES = ["completed", "cancelled"];
const JUMP_SNAP_METERS = 400; // a jump bigger than this snaps instead of gliding
const STALE_AFTER_MS = 15000; // no signal (push or poll reply) in 15s -> flag it

function toLatLng(coords) {
  if (!coords || coords.length < 2) return null;
  return [Number(coords[0]), Number(coords[1])];
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingDegrees(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(from, to, t) {
  let diff = ((to - from + 540) % 360) - 180;
  return (from + diff * t + 360) % 360;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

async function fetchRoadPolyline(from, to) {
  if (!from || !to) return null;
  const [lat1, lng1] = from;
  const [lat2, lng2] = to;
  try {
    const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates) {
      return [from, to];
    }
    return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  } catch {
    return [from, to];
  }
}

/**
 * Fit once per trip phase. Positions read from refs so GPS ticks
 * never re-trigger fitBounds (that was the float bug).
 */
function StableTripView({ driverPos, target, routePoints, phaseKey }) {
  const map = useMap();
  const fittedForPhase = useRef(null);
  const driverRef = useRef(driverPos);
  const targetRef = useRef(target);
  const routeRef = useRef(routePoints);
  driverRef.current = driverPos;
  targetRef.current = target;
  routeRef.current = routePoints;

  const ready = !!(driverPos && target);

  useEffect(() => {
    if (!ready) return;
    if (fittedForPhase.current === phaseKey) return;

    const d = driverRef.current;
    const t = targetRef.current;
    if (!d || !t) return;

    const pts = [
      [d.latitude, d.longitude],
      [t[0], t[1]],
    ];
    const route = routeRef.current;
    if (route?.length > 2) {
      const step = Math.max(1, Math.floor(route.length / 20));
      for (let i = 0; i < route.length; i += step) pts.push(route[i]);
    }

    fittedForPhase.current = phaseKey;
    const id = requestAnimationFrame(() => {
      try {
        map.fitBounds(L.latLngBounds(pts), {
          padding: [80, 80],
          maxZoom: 13,
          animate: false,
        });
      } catch {
        /* ignore */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [map, phaseKey, ready]);

  return null;
}

function SmoothDriverMarker({ target }) {
  const markerRef = useRef(null);
  const state = useRef(null);
  const rafRef = useRef(0);
  const initialPos = useRef(null);

  if (target && !initialPos.current) {
    initialPos.current = [target.latitude, target.longitude];
  }

  useEffect(() => {
    if (!target) return;

    const now = performance.now();
    const cur = state.current;

    if (!cur) {
      state.current = {
        lat: target.latitude,
        lng: target.longitude,
        heading: target.heading ?? 0,
        fromLat: target.latitude,
        fromLng: target.longitude,
        fromHeading: target.heading ?? 0,
        toLat: target.latitude,
        toLng: target.longitude,
        toHeading: target.heading ?? 0,
        start: now,
        duration: 0,
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

    let heading = target.heading;
    if (typeof heading !== "number") {
      heading = bearingDegrees(
        cur.lat,
        cur.lng,
        target.latitude,
        target.longitude
      );
    }

    // A jump this big in one tick isn't the driver moving — it's bad data
    // (a reconnect gap, a GPS glitch, a swapped lat/lng). Snap straight to
    // it instead of smoothly gliding, so a data bug looks like what it is
    // (the marker jumping) rather than masquerading as a 400km/h car.
    const jumpMeters = haversineMeters(
      cur.lat,
      cur.lng,
      target.latitude,
      target.longitude
    );
    const snap = jumpMeters > JUMP_SNAP_METERS;

    state.current = {
      ...cur,
      fromLat: cur.lat,
      fromLng: cur.lng,
      fromHeading: cur.heading,
      toLat: target.latitude,
      toLng: target.longitude,
      toHeading: heading,
      start: now,
      duration: snap ? 0 : GLIDE_MS,
    };
  }, [target?.latitude, target?.longitude, target?.heading]);

  useEffect(() => {
    const tick = (now) => {
      const s = state.current;
      const marker = markerRef.current;
      if (s && marker) {
        const t =
          s.duration <= 0
            ? 1
            : easeInOut(Math.min(1, (now - s.start) / s.duration));
        s.lat = lerp(s.fromLat, s.toLat, t);
        s.lng = lerp(s.fromLng, s.toLng, t);
        s.heading = lerpAngle(s.fromHeading, s.toHeading, t);
        marker.setLatLng([s.lat, s.lng]);
        const el = marker.getElement?.();
        const car = el?.querySelector?.(".sg-live-car");
        if (car) car.style.setProperty("--h", `${s.heading}deg`);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  if (!initialPos.current) return null;

  return (
    <Marker
      ref={markerRef}
      position={initialPos.current}
      icon={liveDriverIcon}
      zIndexOffset={1000}
    />
  );
}

const DriverTracking = ({ booking }) => {
  const [driverLocation, setDriverLocation] = useState(null);
  const [displayPos, setDisplayPos] = useState(null);
  const [approachRoute, setApproachRoute] = useState(null);
  const [serverStale, setServerStale] = useState(false);
  const [noSignal, setNoSignal] = useState(false);
  const prevLoc = useRef(null);
  const lastSeenAt = useRef(null);
  const routeFetchedFor = useRef("");
  const socket = useSocket();

  const pickup = useMemo(
    () => toLatLng(booking?.src?.coordinates),
    [booking?.src?.coordinates]
  );
  const dropoff = useMemo(
    () => toLatLng(booking?.destn?.coordinates),
    [booking?.destn?.coordinates]
  );

  const goingToDropoff = booking?.status === "collected";
  const arrived = booking?.status === "arrived";
  const target = goingToDropoff ? dropoff : pickup;
  const phaseKey = `${booking?._id || "b"}-${goingToDropoff ? "drop" : "pick"}`;

  // Fetch road once per phase (not on every GPS tick — that caused map float)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!driverLocation || !target) return;
      const key = `${phaseKey}|${driverLocation.latitude.toFixed(3)},${driverLocation.longitude.toFixed(3)}`;
      // Only refetch if we never fetched, or driver moved a lot (~1km+)
      const prev = routeFetchedFor.current;
      if (prev.startsWith(phaseKey)) {
        const prevCoord = prev.split("|")[1];
        const [plat, plng] = (prevCoord || "0,0").split(",").map(Number);
        const moved =
          Math.abs(plat - driverLocation.latitude) > 0.008 ||
          Math.abs(plng - driverLocation.longitude) > 0.008;
        if (!moved) return;
      }

      const from = [driverLocation.latitude, driverLocation.longitude];
      const route = await fetchRoadPolyline(from, target);
      if (!cancelled) {
        routeFetchedFor.current = key;
        setApproachRoute(route);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    phaseKey,
    target?.[0],
    target?.[1],
    driverLocation?.latitude,
    driverLocation?.longitude,
  ]);

  useEffect(() => {
    if (!socket || !booking?.driverId?._id) return;
    // Don't keep polling/listening once the trip is actually over — the
    // driver may already be en route to (or mid-tracking for) their next
    // rider, and we'd otherwise keep showing that unrelated movement here.
    if (TERMINAL_STATUSES.includes(booking?.status)) return;

    const driverId = booking.driverId._id;
    socket.emit("requestDriverLocation", driverId);

    const handleLocationUpdate = (location) => {
      if (
        typeof location?.latitude !== "number" ||
        typeof location?.longitude !== "number"
      ) {
        return;
      }

      // Record "we heard something" before the jitter filter below can
      // bail out early — a stationary driver still counts as live signal,
      // only a driver app that stops sending anything at all should trip
      // the no-signal warning.
      lastSeenAt.current = Date.now();
      setServerStale(!!location.stale);

      let heading = location.heading;
      if (
        (typeof heading !== "number" || Number.isNaN(heading)) &&
        prevLoc.current
      ) {
        const moved =
          Math.abs(prevLoc.current.latitude - location.latitude) > 1e-6 ||
          Math.abs(prevLoc.current.longitude - location.longitude) > 1e-6;
        if (moved) {
          heading = bearingDegrees(
            prevLoc.current.latitude,
            prevLoc.current.longitude,
            location.latitude,
            location.longitude
          );
        } else {
          heading = prevLoc.current.heading ?? 0;
        }
      }
      if (typeof heading !== "number" || Number.isNaN(heading)) heading = 0;

      // Ignore tiny jitter that can shake the marker / route
      if (
        prevLoc.current &&
        Math.abs(prevLoc.current.latitude - location.latitude) < 0.00002 &&
        Math.abs(prevLoc.current.longitude - location.longitude) < 0.00002
      ) {
        return;
      }

      const next = {
        latitude: location.latitude,
        longitude: location.longitude,
        heading,
      };
      prevLoc.current = next;
      setDriverLocation(next);
      setDisplayPos(next);
    };

    socket.on("locationUpdate", handleLocationUpdate);
    const intervalId = setInterval(() => {
      socket.emit("requestDriverLocation", driverId);
    }, 2000);

    // A frozen marker and a dead feed look identical without this — check
    // periodically whether *anything* has arrived recently (push or poll
    // reply) regardless of the TTL-driven `stale` flag the server sends.
    const watchdogId = setInterval(() => {
      setNoSignal(
        !!lastSeenAt.current && Date.now() - lastSeenAt.current > STALE_AFTER_MS
      );
    }, 5000);

    return () => {
      clearInterval(intervalId);
      clearInterval(watchdogId);
      socket.off("locationUpdate", handleLocationUpdate);
    };
  }, [socket, booking?.driverId?._id, booking?.status]);

  const mapCenter = target || DEFAULT_CENTER;

  return (
    <div className="h-full min-h-[70vh] relative">
      <MapContainer
        center={mapCenter}
        zoom={12}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        className="h-full w-full sg-map"
      >
        <TileLayer url={MAP_TILE.url} attribution={MAP_TILE.attribution} />
        <MapResizeFix />

        {displayPos && target && (
          <StableTripView
            driverPos={displayPos}
            target={target}
            routePoints={approachRoute}
            phaseKey={phaseKey}
          />
        )}

        {approachRoute?.length > 1 &&
          ROUTE_LINE_STYLES.map((style, i) => (
            <Polyline
              key={`approach-${i}`}
              positions={approachRoute}
              pathOptions={style}
            />
          ))}

        <SmoothDriverMarker target={displayPos} />

        {!goingToDropoff && pickup && (
          <Marker position={pickup} icon={pickupIcon} />
        )}
        {goingToDropoff && dropoff && (
          <Marker position={dropoff} icon={dropoffIcon} />
        )}
      </MapContainer>

      <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center z-[500]">
        <div className="rounded-full bg-white/95 shadow-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">
          {!displayPos
            ? "Waiting for driver location…"
            : serverStale || noSignal
              ? "Lost contact with driver — showing last known position"
              : goingToDropoff
                ? "Driver en route to drop-off"
                : arrived
                  ? "Driver has arrived at pickup"
                  : "Driver en route to pickup"}
        </div>
      </div>
    </div>
  );
};

export default DriverTracking;
