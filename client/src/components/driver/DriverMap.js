"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marker } from "react-leaflet";
import { Steps, Button, message, Popconfirm } from "antd";
import axios from "axios";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";
import BaseMap from "../map/BaseMap";
import { RemainingRoute, SmoothMarker, useRoadRoute } from "../map/LiveLayers";
import { bearingDegrees } from "@/utils/geo";
import {
  pickupIcon,
  dropoffIcon,
  liveDriverIcon,
  DEFAULT_CENTER,
  ROUTE_LINE_STYLES,
} from "@/utils/mapIcons";

const { Step } = Steps;

const validStatuses = [
  "pending",
  "accepted",
  "arrived",
  "collected",
  "completed",
];

const DriverMap = ({ booking, token }) => {
  const [currentStatus, setCurrentStatus] = useState(0);
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropoffLocation, setDropoffLocation] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rerouteTick, setRerouteTick] = useState(0);
  const router = useRouter();
  const socketRef = useRef(null);
  const carPosRef = useRef(null);
  const requestReroute = useCallback(() => setRerouteTick((n) => n + 1), []);

  useEffect(() => {
    if (!token) return undefined;
    const socket = io(
      process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000",
      {
        transports: ["websocket"],
        // Verified server-side — the server derives the real driverId
        // from this token instead of trusting the driverConnected argument.
        auth: { token },
      }
    );
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("driverConnected", booking.driverId._id);
    });
    socket.on("statusUpdated", ({ bookingId, newStatus }) => {
      if (String(bookingId) === String(booking._id) && newStatus) {
        const idx = validStatuses.indexOf(newStatus);
        if (idx >= 0) setCurrentStatus(idx);
      }
    });
    socket.on("userPickupUpdate", (payload) => {
      if (payload?.text) message.info(payload.text);
    });
    return () => socket.disconnect();
  }, [booking.driverId, token]);

  useEffect(() => {
    if (!booking) return;
    const { src, destn, status, driverId } = booking;
    setCurrentStatus(validStatuses.indexOf(status));

    if (src?.coordinates && destn?.coordinates) {
      setPickupLocation({ lat: src.coordinates[0], lng: src.coordinates[1] });
      setDropoffLocation({
        lat: destn.coordinates[0],
        lng: destn.coordinates[1],
      });
    }

    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, heading } = position.coords;
        // Phones only report heading while moving; otherwise derive it.
        setCurrentLocation((prev) => ({
          lat: latitude,
          lng: longitude,
          heading:
            typeof heading === "number" && !Number.isNaN(heading)
              ? heading
              : prev && (prev.lat !== latitude || prev.lng !== longitude)
                ? bearingDegrees(prev.lat, prev.lng, latitude, longitude)
                : prev?.heading ?? 0,
        }));
        socketRef.current?.emit("driverLocationUpdate", {
          driverId: driverId._id,
          latitude,
          longitude,
        });
      },
      (error) => console.error("Error getting current location", error),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [booking]);

  const updateBookingStatus = async () => {
    setLoading(true);
    let nextStatus = validStatuses[currentStatus + 1];
    if (nextStatus === "arrived") nextStatus = "collected";

    try {
      await axios.put(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/update-status/${booking._id}`,
        { status: nextStatus }
      );

      socketRef.current?.emit("updateBookingStatus", {
        bookingId: booking._id,
        newStatus: nextStatus,
        userId: booking.userId,
      });

      message.success("Booking status updated successfully!");

      if (nextStatus === "completed") {
        router.push("/driver/jobs");
      } else {
        setCurrentStatus(validStatuses.indexOf(nextStatus));
      }
    } catch (error) {
      message.error("Error updating booking status");
    } finally {
      setLoading(false);
    }
  };

  const cancelBooking = async () => {
    try {
      await axios.put(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/update-status/${booking._id}`,
        { status: "cancelled" }
      );
      socketRef.current?.emit("updateBookingStatus", {
        bookingId: booking._id,
        newStatus: "cancelled",
        userId: booking.userId,
      });

      message.success("Booking cancelled successfully!");
      router.push("/driver/jobs");
    } catch (error) {
      message.error("Error canceling the booking");
    }
  };

  const isButtonDisabled = currentStatus >= validStatuses.length - 1;
  const nextStatusLabel = validStatuses[currentStatus + 1];
  const buttonLabel =
    nextStatusLabel === "arrived" || nextStatusLabel === "collected"
      ? "Mark Collected"
      : "Mark Complete";
  const statusKey = validStatuses[currentStatus];
  const collectedIndex = validStatuses.indexOf("collected");

  // Route to pickup while heading there, to drop-off once collected.
  const target =
    statusKey === "accepted" || statusKey === "arrived"
      ? pickupLocation
      : statusKey === "collected"
        ? dropoffLocation
        : null;
  const targetLatLng = target ? [target.lat, target.lng] : null;
  const carLatLng = currentLocation ? [currentLocation.lat, currentLocation.lng] : null;
  const route = useRoadRoute(carLatLng, targetLatLng, `${statusKey}|${rerouteTick}`);
  const carTarget = useMemo(
    () =>
      currentLocation && {
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        heading: currentLocation.heading,
      },
    [currentLocation]
  );

  const fitPoints = useMemo(() => {
    const pts = route?.points?.length > 1 ? [...route.points] : [];
    if (carLatLng) pts.push(carLatLng);
    if (targetLatLng) pts.push(targetLatLng);
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, !!carLatLng, targetLatLng?.[0], targetLatLng?.[1]]);
  const fitKey = `${statusKey}|${carLatLng ? 1 : 0}|${route ? 1 : 0}`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-0 md:gap-4 h-[calc(100vh-var(--nav-height))] bg-slate-100 p-0 md:p-4">
      <div className="col-span-1 bg-white p-6 md:rounded-2xl md:shadow-sm border-b md:border border-slate-200 flex flex-col">
        <h2 className="text-xl font-semibold mb-4 text-slate-900">
          Update Booking Status
        </h2>
        <Steps direction="vertical" current={currentStatus}>
          {validStatuses.map((status, index) => (
            <Step
              key={index}
              title={status.charAt(0).toUpperCase() + status.slice(1)}
              disabled={index > currentStatus}
            />
          ))}
        </Steps>
        <Button
          type="primary"
          className="mt-4"
          onClick={updateBookingStatus}
          loading={loading}
          disabled={isButtonDisabled}
        >
          {buttonLabel}
        </Button>

        {currentStatus < collectedIndex && (
          <Popconfirm
            title="Are you sure you want to cancel this booking?"
            onConfirm={cancelBooking}
            okText="Yes"
            cancelText="No"
          >
            <Button type="dashed" className="mt-2" danger>
              Cancel Booking
            </Button>
          </Popconfirm>
        )}
      </div>

      <div className="col-span-2 relative min-h-[50vh] md:min-h-0 md:rounded-2xl overflow-hidden shadow-sm border border-slate-200">
        <BaseMap
          center={carLatLng || DEFAULT_CENTER}
          zoom={13}
          fitPoints={fitPoints}
          fitKey={fitKey}
          fitPadding={56}
        >
          {statusKey !== "arrived" && (
            <RemainingRoute
              route={route?.points}
              posRef={carPosRef}
              styles={ROUTE_LINE_STYLES}
              onOffRoute={requestReroute}
            />
          )}
          <SmoothMarker target={carTarget} icon={liveDriverIcon} posRef={carPosRef} />
          {pickupLocation && currentStatus >= 1 && (
            <Marker
              position={[pickupLocation.lat, pickupLocation.lng]}
              icon={pickupIcon}
            />
          )}
          {dropoffLocation && currentStatus >= collectedIndex && (
            <Marker
              position={[dropoffLocation.lat, dropoffLocation.lng]}
              icon={dropoffIcon}
            />
          )}
        </BaseMap>
      </div>
    </div>
  );
};

export default DriverMap;
