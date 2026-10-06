"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import { toast } from "react-hot-toast";
import { useRouter, usePathname } from "next/navigation";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
const OFFER_SEC = 30;
const OSRM = "https://router.project-osrm.org/route/v1/driving";

function formatDuration(durationInSeconds = 0) {
  const minutes = Math.max(1, Math.round(Number(durationInSeconds) / 60));
  return `${minutes} min`;
}

function formatPrice(price = 0) {
  return `₹${Number(price).toFixed(0)}`;
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

/** Walk meters along an OSRM road path (same idea as the earlier auto-driver). */
function advanceAlongRoad(path, pathIndex, lat, lng, metersPerTick) {
  let remaining = metersPerTick;
  let i = pathIndex;
  let curLat = lat;
  let curLng = lng;
  let heading = 0;

  while (remaining > 0 && i < path.length) {
    const target = path[i];
    const dist = haversineMeters(curLat, curLng, target.lat, target.lng);
    heading = bearingDegrees(curLat, curLng, target.lat, target.lng);

    if (dist <= remaining || dist < 0.5) {
      remaining -= dist;
      curLat = target.lat;
      curLng = target.lng;
      i += 1;
      continue;
    }

    const ratio = remaining / dist;
    curLat = curLat + (target.lat - curLat) * ratio;
    curLng = curLng + (target.lng - curLng) * ratio;
    remaining = 0;
  }

  return {
    lat: curLat,
    lng: curLng,
    pathIndex: i,
    heading,
    arrived: i >= path.length,
  };
}

async function fetchRoad(lat1, lng1, lat2, lng2) {
  try {
    const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok") return null;
    return data.routes[0].geometry.coordinates.map(([lng, lat]) => ({
      lat,
      lng,
    }));
  } catch {
    return null;
  }
}

/**
 * Professional trip offer card (Uber-style): bottom sheet, fare, ETA,
 * pickup/drop, countdown bar, Accept / dismiss — not a phone dialer.
 */
function TripOfferCard({
  booking,
  secondsLeft,
  onAccept,
  onReject,
  accepting,
}) {
  const progress = Math.max(0, (secondsLeft / OFFER_SEC) * 100);

  return (
    <div className="sg-offer" role="dialog" aria-label="New trip offer">
      <div className="sg-offer__scrim" />
      <div className="sg-offer__sheet">
        <div
          className="sg-offer__progress"
          style={{ width: `${progress}%` }}
          aria-hidden
        />

        <div className="sg-offer__top">
          <button
            type="button"
            className="sg-offer__dismiss"
            onClick={onReject}
            disabled={accepting}
            aria-label="Decline trip"
          >
            ✕
          </button>
          <div className="sg-offer__brand">
            <span className="sg-offer__brand-mark">SG</span>
            <div>
              <p className="sg-offer__brand-title">ShipGoods</p>
              <p className="sg-offer__brand-sub">New trip offer · {secondsLeft}s</p>
            </div>
          </div>
        </div>

        <div className="sg-offer__fare">
          <span className="sg-offer__fare-amount">
            {formatPrice(booking?.price)}
          </span>
          <span className="sg-offer__fare-meta">
            {Number(booking?.distance || 0).toFixed(1)} km ·{" "}
            {formatDuration(booking?.duration)}
          </span>
        </div>

        <div className="sg-offer__route">
          <div className="sg-offer__leg">
            <span className="sg-offer__dot sg-offer__dot--a" />
            <div>
              <p className="sg-offer__leg-label">Pickup</p>
              <p className="sg-offer__leg-text">
                {booking?.srcText || "Pickup location"}
              </p>
            </div>
          </div>
          <div className="sg-offer__rail" aria-hidden />
          <div className="sg-offer__leg">
            <span className="sg-offer__dot sg-offer__dot--b" />
            <div>
              <p className="sg-offer__leg-label">Drop-off</p>
              <p className="sg-offer__leg-text">
                {booking?.destnText || "Drop location"}
              </p>
            </div>
          </div>
        </div>

        {booking?.userName && (
          <p className="sg-offer__rider">
            Rider <strong>{booking.userName}</strong>
          </p>
        )}

        <button
          type="button"
          className="sg-offer__accept"
          onClick={onAccept}
          disabled={accepting}
        >
          {accepting ? "Accepting…" : "Accept trip"}
        </button>
      </div>
    </div>
  );
}

const DriverDashboard = ({ driverId, token }) => {
  const [online, setOnline] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(OFFER_SEC);
  const [accepting, setAccepting] = useState(false);
  const [enRoute, setEnRoute] = useState(false);
  const socketRef = useRef(null);
  const acceptLock = useRef(false);
  const driveTimer = useRef(null);
  const router = useRouter();
  const pathname = usePathname();

  const goOnline = useCallback(async () => {
    if (!token) {
      toast.error("Missing auth token — please log in again");
      return;
    }
    try {
      if (!socketRef.current) {
        const socket = io(SOCKET_URL, {
          // websocket-only: a long-lived single connection, so it never
          // needs load-balancer sticky sessions the way the polling
          // fallback (a sequence of separate HTTP requests) would.
          transports: ["websocket"],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 800,
          // Verified server-side (socket.io `io.use` middleware) — the
          // server derives the real driverId from this token rather than
          // trusting whatever id a client claims in driverConnected.
          auth: { token },
        });
        socketRef.current = socket;

        const register = () => {
          socket.emit("driverConnected", driverId);
          console.log("Driver registered", driverId, socket.id);
        };

        socket.on("connect", register);
        socket.io.on("reconnect", register);

        socket.on("disconnect", () => {
          console.warn("Driver socket disconnected — will reconnect");
        });

        socket.on("connect_error", (err) => {
          console.error("Driver socket error", err.message);
        });

        socket.on("pickupRequested", (bookingData) => {
          console.log("Trip offer received", bookingData?._id);
          setIncoming((current) => current || bookingData);
          acceptLock.current = false;
          setAccepting(false);
        });

        if (socket.connected) register();
      } else {
        if (!socketRef.current.connected) {
          socketRef.current.connect();
        } else {
          socketRef.current.emit("driverConnected", driverId);
        }
      }
    } catch (err) {
      console.error("goOnline failed", err);
      toast.error("Could not go online");
      return;
    }

    setOnline(true);
    toast.success("You’re online");
  }, [driverId, token]);

  // Keep Redis socket mapping fresh while online
  useEffect(() => {
    if (!online || !driverId) return;
    const beat = setInterval(() => {
      const s = socketRef.current;
      if (s?.connected) {
        s.emit("driverConnected", driverId);
      } else {
        s?.connect();
      }
    }, 4000);
    return () => clearInterval(beat);
  }, [online, driverId]);

  // Auto-online on driver jobs + live-driver pages
  useEffect(() => {
    if (!driverId || online) return;
    const onDriverSurface =
      pathname?.includes("/live-driver") || pathname?.includes("/driver/jobs");
    if (!onDriverSurface) return;
    const t = setTimeout(() => {
      goOnline();
    }, 300);
    return () => clearTimeout(t);
  }, [pathname, driverId, online, goOnline]);

  // Poll pending bookings so offers still show if socket delivery misses
  useEffect(() => {
    if (!online || enRoute || incoming) return;

    const pull = async () => {
      try {
        const res = await axios.get(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/pending`
        );
        const next = res.data?.bookings?.[0];
        if (next?._id) {
          setIncoming(next);
          acceptLock.current = false;
          setAccepting(false);
        }
      } catch (err) {
        console.warn("Pending poll failed", err.message);
      }
    };

    pull();
    const id = setInterval(pull, 3000);
    return () => clearInterval(id);
  }, [online, enRoute, incoming]);

  /** Drive along real roads to pickup (OSRM path + smooth ticks). */
  const startDriveToPickup = useCallback(
    async (booking) => {
      const destLat = Number(booking?.src?.coordinates?.[0]);
      const destLng = Number(booking?.src?.coordinates?.[1]);
      if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return;

      // Start a short drive away so movement is visible on the map
      let lat = destLat + 0.0055;
      let lng = destLng + 0.0045;

      let road = await fetchRoad(lat, lng, destLat, destLng);
      if (!road?.length) {
        road = [
          { lat, lng },
          { lat: destLat, lng: destLng },
        ];
      } else if (haversineMeters(lat, lng, road[0].lat, road[0].lng) > 40) {
        road = [{ lat, lng }, ...road];
      }

      setEnRoute(true);
      let pathIndex = 0;
      const TICK_MS = 400;
      const SPEED_MPS = 8.5;
      const metersPerTick = SPEED_MPS * (TICK_MS / 1000);

      const publish = (la, ln, heading) => {
        socketRef.current?.emit("driverLocationUpdate", {
          driverId,
          latitude: la,
          longitude: ln,
          heading,
        });
      };

      const firstHeading = bearingDegrees(
        road[0].lat,
        road[0].lng,
        road[Math.min(1, road.length - 1)].lat,
        road[Math.min(1, road.length - 1)].lng
      );
      publish(road[0].lat, road[0].lng, firstHeading);
      lat = road[0].lat;
      lng = road[0].lng;

      if (driveTimer.current) clearInterval(driveTimer.current);
      driveTimer.current = setInterval(() => {
        const next = advanceAlongRoad(
          road,
          pathIndex,
          lat,
          lng,
          metersPerTick
        );
        pathIndex = next.pathIndex;
        lat = next.lat;
        lng = next.lng;

        const remaining = haversineMeters(lat, lng, destLat, destLng);
        publish(lat, lng, next.heading);

        if (next.arrived || remaining <= 28) {
          clearInterval(driveTimer.current);
          publish(destLat, destLng, next.heading);
          setEnRoute(false);
          // Free driver again so they stay in nearby list for the next request
          axios
            .post(
              `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/free-driver`,
              { driverId }
            )
            .catch(() => {});
          toast.success("Arrived at pickup");
        }
      }, TICK_MS);
    },
    [driverId]
  );

  const acceptBooking = useCallback(
    async (bookingDetails) => {
      if (!bookingDetails || acceptLock.current) return;
      acceptLock.current = true;
      setAccepting(true);

      const userId =
        bookingDetails.userId?._id ||
        bookingDetails.userId ||
        bookingDetails.user?._id;

      try {
        await axios.post(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/accept`,
          {
            bookingId: bookingDetails._id,
            driverId,
          }
        );

        socketRef.current?.emit("acceptBooking", {
          driverId,
          bookingId: bookingDetails._id,
          userId: userId?.toString?.() || userId,
        });

        toast.success("Trip accepted");
        setIncoming(null);
        setAccepting(false);
        acceptLock.current = false;

        // Always simulate road movement so customer tracking works in this demo
        await startDriveToPickup(bookingDetails);
      } catch (error) {
        console.error("Accept failed:", error);
        toast.error(
          error.response?.data?.message || "Failed to accept trip."
        );
        acceptLock.current = false;
        setAccepting(false);
        setIncoming(null);
      }
    },
    [driverId, startDriveToPickup]
  );

  const rejectBooking = useCallback(
    (bookingDetails) => {
      socketRef.current?.emit("rejectBooking", {
        driverId,
        bookingId: bookingDetails?._id,
        userId:
          bookingDetails?.userId?._id ||
          bookingDetails?.userId ||
          bookingDetails?.user?._id,
      });
      setIncoming(null);
      setSecondsLeft(OFFER_SEC);
      acceptLock.current = false;
      toast("Trip declined");
    },
    [driverId]
  );

  useEffect(() => {
    if (!incoming) {
      setSecondsLeft(OFFER_SEC);
      return;
    }
    setSecondsLeft(OFFER_SEC);
  }, [incoming]);

  useEffect(() => {
    if (!incoming || accepting) return;
    if (secondsLeft <= 0) {
      acceptBooking(incoming);
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [incoming, secondsLeft, accepting, acceptBooking]);

  useEffect(() => {
    return () => {
      if (driveTimer.current) clearInterval(driveTimer.current);
      socketRef.current?.disconnect();
    };
  }, []);

  return (
    <div className="sg-driver-home">
      {!online ? (
        <div className="sg-driver-home__gate">
          <div className="sg-driver-home__card">
            <p className="sg-driver-home__eyebrow">ShipGoods Driver</p>
            <h1>Go online for trips</h1>
            <p>
              Trip offers appear as a request card with fare and route. You have{" "}
              {OFFER_SEC} seconds to accept — or it accepts automatically.
            </p>
            <button
              type="button"
              className="sg-driver-home__go"
              onClick={goOnline}
            >
              Go online
            </button>
            <p className="sg-driver-home__id">ID {driverId}</p>
          </div>
        </div>
      ) : (
        <div className="sg-driver-home__idle">
          <div
            className={`sg-driver-home__pulse ${enRoute ? "sg-driver-home__pulse--busy" : ""}`}
          />
          <h2>{enRoute ? "En route to pickup" : "Online"}</h2>
          <p>
            {enRoute
              ? "Sharing live location with the customer."
              : "Listening for nearby trip offers."}
          </p>
          <p className="sg-driver-home__id">ID {driverId}</p>
        </div>
      )}

      {incoming && (
        <TripOfferCard
          booking={incoming}
          secondsLeft={secondsLeft}
          accepting={accepting}
          onAccept={() => acceptBooking(incoming)}
          onReject={() => rejectBooking(incoming)}
        />
      )}
    </div>
  );
};

export default DriverDashboard;
