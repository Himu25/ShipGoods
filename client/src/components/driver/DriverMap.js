"use client";
import React, { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import L from "leaflet";
import "leaflet-routing-machine";
import { Steps, Button, message, Popconfirm } from "antd";
import axios from "axios";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";
import MapResizeFix from "../MapResizeFix";
import {
  pickupIcon,
  dropoffIcon,
  driverIcon,
  DEFAULT_CENTER,
  MAP_TILE,
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

function DriverRouting({ currentLocation, pickupLocation, dropoffLocation, status }) {
  const map = useMap();
  const controlRef = useRef(null);

  useEffect(() => {
    if (!currentLocation || !pickupLocation || !dropoffLocation) return;

    let waypoints = [];
    if (status === "accepted" || status === "arrived") {
      waypoints = [
        L.latLng(currentLocation.lat, currentLocation.lng),
        L.latLng(pickupLocation.lat, pickupLocation.lng),
      ];
    } else if (status === "collected") {
      waypoints = [
        L.latLng(currentLocation.lat, currentLocation.lng),
        L.latLng(dropoffLocation.lat, dropoffLocation.lng),
      ];
    }

    if (controlRef.current) {
      map.removeControl(controlRef.current);
      controlRef.current = null;
    }

    if (waypoints.length < 2) return;

    const control = L.Routing.control({
      waypoints,
      routeWhileDragging: false,
      addWaypoints: false,
      draggableWaypoints: false,
      show: false,
      createMarker: () => null,
      lineOptions: { styles: ROUTE_LINE_STYLES },
    }).addTo(map);

    control.on("routesfound", (e) => {
      map.fitBounds(L.latLngBounds(e.routes[0].coordinates), {
        padding: [40, 40],
      });
    });

    controlRef.current = control;
    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [map, currentLocation, pickupLocation, dropoffLocation, status]);

  return null;
}

const DriverMap = ({ booking, token }) => {
  const [currentStatus, setCurrentStatus] = useState(0);
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropoffLocation, setDropoffLocation] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const socketRef = useRef(null);

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
        const { latitude, longitude } = position.coords;
        setCurrentLocation({ lat: latitude, lng: longitude });
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
        `http://localhost:3000/api/booking/update-status/${booking._id}`,
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
        `http://localhost:3000/api/booking/update-status/${booking._id}`,
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
        <MapContainer
          center={
            currentLocation
              ? [currentLocation.lat, currentLocation.lng]
              : DEFAULT_CENTER
          }
          zoom={13}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
          className="h-full w-full sg-map"
        >
          <TileLayer url={MAP_TILE.url} attribution={MAP_TILE.attribution} />
          <MapResizeFix />
          <DriverRouting
            currentLocation={currentLocation}
            pickupLocation={pickupLocation}
            dropoffLocation={dropoffLocation}
            status={statusKey}
          />
          {currentLocation && (
            <Marker
              position={[currentLocation.lat, currentLocation.lng]}
              icon={driverIcon}
            />
          )}
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
        </MapContainer>
      </div>
    </div>
  );
};

export default DriverMap;
