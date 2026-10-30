"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marker } from "react-leaflet";
import { useSocket } from "@/context/SocketContext";
import BaseMap from "../map/BaseMap";
import { RemainingRoute, SmoothMarker, useRoadRoute } from "../map/LiveLayers";
import { bearingDegrees, toLatLng } from "@/utils/geo";
import {
  pickupIcon,
  dropoffIcon,
  liveDriverIcon,
  liveBotIcon,
  BOT_ROUTE_LINE_STYLES,
  DEFAULT_CENTER,
  ROUTE_LINE_STYLES,
} from "@/utils/mapIcons";

const TERMINAL_STATUSES = ["completed", "cancelled"];
const STALE_AFTER_MS = 15000; // no signal (push or poll reply) in 15s -> flag it
const JITTER_DEGREES = 0.00002; // ~2m; smaller moves are GPS noise

function statusText({ hasPos, lost, goingToDropoff, arrived, driverName }) {
  const who = driverName || "Driver";
  if (!hasPos) return "Waiting for driver location…";
  if (lost) return "Lost contact with driver — showing last known position";
  if (goingToDropoff) return `${who} is on the way to drop-off`;
  if (arrived) return `${who} has arrived at your pickup`;
  return `${who} is on the way to your pickup`;
}

const DriverTracking = ({ booking }) => {
  const [driverPos, setDriverPos] = useState(null);
  const [serverStale, setServerStale] = useState(false);
  const [noSignal, setNoSignal] = useState(false);
  const [rerouteTick, setRerouteTick] = useState(0);
  const prevLoc = useRef(null);
  const lastSeenAt = useRef(null);
  const carPosRef = useRef(null);
  const socket = useSocket();
  const isBot = booking?.driverId?.demo === "bot";
  const requestReroute = useCallback(() => setRerouteTick((n) => n + 1), []);

  const pickup = useMemo(() => toLatLng(booking?.src?.coordinates), [booking?.src?.coordinates]);
  const dropoff = useMemo(() => toLatLng(booking?.destn?.coordinates), [booking?.destn?.coordinates]);

  const goingToDropoff = booking?.status === "collected";
  const arrived = booking?.status === "arrived";
  const target = goingToDropoff ? dropoff : pickup;
  const phaseKey = `${booking?._id || "b"}-${goingToDropoff ? "drop" : "pick"}`;

  // Fetched once per phase and on re-route, never per GPS tick.
  const driverLatLng = driverPos ? [driverPos.latitude, driverPos.longitude] : null;
  const route = useRoadRoute(driverLatLng, target, `${phaseKey}|${rerouteTick}`);

  useEffect(() => {
    if (!socket || !booking?.driverId?._id) return;
    // Don't keep polling/listening once the trip is actually over — the
    // driver may already be en route to (or mid-tracking for) their next
    // rider, and we'd otherwise keep showing that unrelated movement here.
    if (TERMINAL_STATUSES.includes(booking?.status)) return;

    const driverId = booking.driverId._id;
    socket.emit("requestDriverLocation", driverId);

    const handleLocationUpdate = (location) => {
      if (typeof location?.latitude !== "number" || typeof location?.longitude !== "number") {
        return;
      }

      // Record "we heard something" before the jitter filter below can
      // bail out early — a stationary driver still counts as live signal,
      // only a driver app that stops sending anything at all should trip
      // the no-signal warning.
      lastSeenAt.current = Date.now();
      setServerStale(!!location.stale);

      const prev = prevLoc.current;
      if (
        prev &&
        Math.abs(prev.latitude - location.latitude) < JITTER_DEGREES &&
        Math.abs(prev.longitude - location.longitude) < JITTER_DEGREES
      ) {
        return;
      }

      let heading = location.heading;
      if (typeof heading !== "number" || Number.isNaN(heading)) {
        heading = prev
          ? bearingDegrees(prev.latitude, prev.longitude, location.latitude, location.longitude)
          : 0;
      }

      const next = { latitude: location.latitude, longitude: location.longitude, heading };
      prevLoc.current = next;
      setDriverPos(next);
    };

    socket.on("locationUpdate", handleLocationUpdate);
    const intervalId = setInterval(() => socket.emit("requestDriverLocation", driverId), 2000);

    // A frozen marker and a dead feed look identical without this — check
    // periodically whether *anything* has arrived recently (push or poll
    // reply) regardless of the TTL-driven `stale` flag the server sends.
    const watchdogId = setInterval(() => {
      setNoSignal(!!lastSeenAt.current && Date.now() - lastSeenAt.current > STALE_AFTER_MS);
    }, 5000);

    return () => {
      clearInterval(intervalId);
      clearInterval(watchdogId);
      socket.off("locationUpdate", handleLocationUpdate);
    };
  }, [socket, booking?.driverId?._id, booking?.status]);

  // Frame the trip at most three times per phase: target, +driver, +road.
  const fitPoints = useMemo(() => {
    const pts = [];
    if (target) pts.push(target);
    if (driverLatLng) pts.push(driverLatLng);
    if (route?.points?.length > 2) {
      const step = Math.max(1, Math.floor(route.points.length / 20));
      for (let i = 0; i < route.points.length; i += step) pts.push(route.points[i]);
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, !!driverLatLng, route]);
  const fitKey = `${phaseKey}|${driverPos ? 1 : 0}|${route ? 1 : 0}`;

  const lost = serverStale || noSignal;

  return (
    <div className="h-full min-h-[70vh] relative">
      <BaseMap
        center={target || DEFAULT_CENTER}
        zoom={13}
        fitPoints={fitPoints}
        fitKey={fitKey}
        fitPadding={80}
        fitMaxZoom={16}
      >
        {!arrived && (
          <RemainingRoute
            route={route?.points}
            posRef={carPosRef}
            styles={isBot ? BOT_ROUTE_LINE_STYLES : ROUTE_LINE_STYLES}
            onOffRoute={requestReroute}
          />
        )}

        <SmoothMarker
          target={driverPos}
          icon={isBot ? liveBotIcon : liveDriverIcon}
          posRef={carPosRef}
        />

        {!goingToDropoff && pickup && <Marker position={pickup} icon={pickupIcon} />}
        {goingToDropoff && dropoff && <Marker position={dropoff} icon={dropoffIcon} />}
      </BaseMap>

      <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4 z-[500]">
        <div className={`sg-map-pill${lost ? " sg-map-pill--warn" : ""}`}>
          <span
            className="sg-map-pill__dot"
            style={isBot && !lost ? { "--dot": "#7c3aed" } : undefined}
          />
          {statusText({
            hasPos: !!driverPos,
            lost,
            goingToDropoff,
            arrived,
            driverName: booking?.driverId?.name?.split(" ")[0],
          })}
        </div>
      </div>
    </div>
  );
};

export default DriverTracking;
