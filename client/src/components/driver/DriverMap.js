"use client";
import React, { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import L from "leaflet";
import "leaflet-routing-machine";
import { Steps, Button, message, Popconfirm } from "antd";
import axios from "axios";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";

const { Step } = Steps;

const validStatuses = ["pending", "accepted", "collected", "completed"];

const DriverMap = ({ booking }) => {
  const [currentStatus, setCurrentStatus] = useState(0);
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropoffLocation, setDropoffLocation] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [routeControl, setRouteControl] = useState(null);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef(null);
  const router = useRouter();

  const customMarkerIcon = new L.Icon({
    iconUrl: "https://img.icons8.com/color/48/marker.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
  });

  useEffect(() => {
    const socket = io("http://localhost:3000");
    socket.on("connect", () => {
      console.log("Connected to socket server");
      socket.emit("driverConnected", booking.driverId._id);
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
    });

    return () => {
      socket.disconnect();
    };
  }, [booking.driverId]);

  // Fetch booking details and handle location updates
  useEffect(() => {
    if (booking) {
      const { src, destn, status, driverId } = booking;
      setCurrentStatus(validStatuses.indexOf(status));

      if (src?.coordinates && destn?.coordinates) {
        setPickupLocation({ lat: src.coordinates[0], lng: src.coordinates[1] });
        setDropoffLocation({
          lat: destn.coordinates[0],
          lng: destn.coordinates[1],
        });
      }

      if (navigator.geolocation) {
        const watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            setCurrentLocation({ lat: latitude, lng: longitude });

            // Emit driver location update
            console.log("Emitting driverLocationUpdate", {
              driverId: driverId._id,
              latitude,
              longitude,
            });
            const socket = io("http://localhost:3000");
            socket.emit("driverLocationUpdate", {
              driverId: driverId._id,
              latitude,
              longitude,
            });
          },
          (error) => console.error("Error getting current location", error),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );

        return () => navigator.geolocation.clearWatch(watchId);
      }
    }
  }, [booking]);

  // Update route when locations or status changes
  useEffect(() => {
    if (
      mapRef.current &&
      currentLocation &&
      pickupLocation &&
      dropoffLocation
    ) {
      const map = mapRef.current;
      if (routeControl) {
        try {
          map.removeControl(routeControl);
        } catch (err) {
          console.error("Error removing route control:", err);
        }
      }

      const waypoints = getWaypoints();

      const newRouteControl = L.Routing.control({
        waypoints,
        routeWhileDragging: true,
        createMarker: () => null,
      }).addTo(map);

      newRouteControl.on("routesfound", (e) => {
        const bounds = L.latLngBounds(e.routes[0].coordinates);
        map.fitBounds(bounds);
      });

      setRouteControl(newRouteControl);
    }
  }, [currentLocation, pickupLocation, dropoffLocation, currentStatus]);

  const getWaypoints = () => {
    if (validStatuses[currentStatus] === "accepted") {
      return [
        L.latLng(currentLocation.lat, currentLocation.lng),
        L.latLng(pickupLocation.lat, pickupLocation.lng),
      ];
    } else if (validStatuses[currentStatus] === "collected") {
      return [
        L.latLng(currentLocation.lat, currentLocation.lng),
        L.latLng(dropoffLocation.lat, dropoffLocation.lng),
      ];
    }
    return [];
  };

  // Update booking status
  const updateBookingStatus = async () => {
    setLoading(true);
    const nextStatus = validStatuses[currentStatus + 1];

    try {
      await axios.put(
        `http://localhost:3000/api/booking/update-status/${booking._id}`,
        { status: nextStatus }
      );

      // Emit status update
      console.log("Emitting updateBookingStatus", {
        bookingId: booking._id,
        newStatus: nextStatus,
        userId: booking.userId,
      });
      const socket = io("http://localhost:3000");
      socket.emit("updateBookingStatus", {
        bookingId: booking._id,
        newStatus: nextStatus,
        userId: booking.userId,
      });

      message.success("Booking status updated successfully!");

      if (nextStatus === "completed") {
        router.push("/driver/jobs");
      } else {
        setCurrentStatus(currentStatus + 1);
      }
    } catch (error) {
      message.error("Error updating booking status");
    } finally {
      setLoading(false);
    }
  };

  // Cancel booking
  const cancelBooking = async () => {
    try {
      await axios.put(
        `http://localhost:3000/api/booking/update-status/${booking._id}`,
        { status: "cancelled" }
      );
      const socket = io("http://localhost:3000");
      socket.emit("updateBookingStatus", {
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
  const buttonLabel = currentStatus === 1 ? "Mark Collected" : "Mark Complete";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-screen">
      <div className="col-span-1 bg-white p-6 rounded-lg flex flex-col">
        <h2 className="text-xl font-semibold mb-4">Update Booking Status</h2>
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

        {currentStatus < 2 && (
          <Popconfirm
            title="Are you sure you want to cancel this booking?"
            onConfirm={cancelBooking}
            okText="Yes"
            cancelText="No"
          >
            <Button type="dashed" className="mt-2">
              Cancel Booking
            </Button>
          </Popconfirm>
        )}
      </div>

      <div className="col-span-2">
        <MapContainer
          center={
            currentLocation
              ? [currentLocation.lat, currentLocation.lng]
              : [51.505, -0.09]
          }
          zoom={13}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
          ref={mapRef}
          className="rounded-lg shadow-lg"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {currentLocation && (
            <Marker
              key="current-location"
              position={[currentLocation.lat, currentLocation.lng]}
              icon={customMarkerIcon}
            />
          )}
          {pickupLocation && currentStatus >= 1 && (
            <Marker
              key="pickup-location"
              position={[pickupLocation.lat, pickupLocation.lng]}
              icon={customMarkerIcon}
            />
          )}
          {dropoffLocation && currentStatus >= 2 && (
            <Marker
              key="dropoff-location"
              position={[dropoffLocation.lat, dropoffLocation.lng]}
              icon={customMarkerIcon}
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
};

export default DriverMap;
