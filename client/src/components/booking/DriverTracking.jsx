"use client";

import React, { useEffect, useState, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "leaflet-routing-machine";
import { useSocket } from "@/context/SocketContext";

const DriverZoom = ({ location, onFlyToComplete }) => {
  const map = useMap();

  useEffect(() => {
    if (location) {
      const currentCenter = map.getCenter();
      const currentZoom = map.getZoom(); // Get current zoom level

      const isSameLocation =
        currentCenter.lat === location.latitude &&
        currentCenter.lng === location.longitude;

      // Ensure map only moves when location changes, and don't reset zoom
      if (!isSameLocation) {
        // Use flyTo with current zoom to avoid fluctuation between zoom levels
        map.flyTo([location.latitude, location.longitude], currentZoom, {
          animate: true, // Keep animation for smoother transition, but zoom remains constant
        });

        // Trigger onFlyToComplete only once after the map has moved
        map.once("moveend", onFlyToComplete);
      }
    }
  }, [location, map, onFlyToComplete]);

  return null;
};

const DriverTracking = ({ booking }) => {
  const [driverLocation, setDriverLocation] = useState(null);
  const [flyToComplete, setFlyToComplete] = useState(false);
  const mapRef = useRef(null);
  const socket = useSocket();
  const routeControlRef = useRef(null);
  const prevWaypointsRef = useRef([]);

  const truckMarkerIcon = new L.Icon({
    iconUrl: "https://img.icons8.com/color/48/truck.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
  });

  const markerIcon = new L.Icon({
    iconUrl: "https://img.icons8.com/color/48/marker.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
  });

  // Only update routeControl if waypoints have changed
  useEffect(() => {
    if (!flyToComplete || !driverLocation || !mapRef.current) return;

    const mapInstance = mapRef.current;
    const { status, src, destn } = booking;

    const waypoints = [
      L.latLng(driverLocation.latitude, driverLocation.longitude),
      ...(status === "accepted"
        ? [L.latLng(src.coordinates[0], src.coordinates[1])]
        : []),
      ...(status === "collected"
        ? [L.latLng(destn.coordinates[0], destn.coordinates[1])]
        : []),
    ];

    // Check if waypoints have changed
    const areWaypointsDifferent =
      JSON.stringify(waypoints) !== JSON.stringify(prevWaypointsRef.current);

    if (areWaypointsDifferent) {
      // Remove previous routing control
      if (routeControlRef.current) {
        mapInstance.removeControl(routeControlRef.current);
      }

      routeControlRef.current = L.Routing.control({
        waypoints: waypoints,
        createMarker: () => null,
        lineOptions: {
          styles: [{ color: "blue", weight: 4 }],
        },
        routeWhileDragging: false,
        addWaypoints: false,
      }).addTo(mapInstance);

      // Update the previous waypoints reference
      prevWaypointsRef.current = waypoints;

      routeControlRef.current.on("routesfound", function () {
        const instructionsContainer = document.querySelector(
          ".leaflet-routing-container"
        );
        if (instructionsContainer) {
          instructionsContainer.style.display = "none";
        }
      });
    }
  }, [flyToComplete, driverLocation, booking]);

  // Fetch driver location periodically
  useEffect(() => {
    if (!socket || !booking?.driverId?._id) return;

    const driverId = booking.driverId._id;
    socket.emit("requestDriverLocation", driverId);

    const handleLocationUpdate = (location) => {
      // Only update if location has changed significantly
      setDriverLocation((prevLocation) => {
        const hasMoved =
          !prevLocation ||
          prevLocation.latitude !== location.latitude ||
          prevLocation.longitude !== location.longitude;

        return hasMoved
          ? { latitude: location.latitude, longitude: location.longitude }
          : prevLocation;
      });
    };

    socket.on("locationUpdate", handleLocationUpdate);

    const intervalId = setInterval(() => {
      socket.emit("requestDriverLocation", driverId);
    }, 5000);

    return () => {
      clearInterval(intervalId);
      socket.off("locationUpdate", handleLocationUpdate);
    };
  }, [socket, booking?.driverId?._id]);

  return (
    <div className="h-screen">
      <MapContainer
        center={
          driverLocation
            ? [driverLocation.latitude, driverLocation.longitude]
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

        {driverLocation && (
          <>
            <DriverZoom
              location={driverLocation}
              onFlyToComplete={() => setFlyToComplete(true)}
            />
            <Marker
              key="driver-location"
              position={[driverLocation.latitude, driverLocation.longitude]}
              icon={truckMarkerIcon}
            />
          </>
        )}

        {booking?.status === "accepted" && (
          <Marker
            key="start-location"
            position={[booking.src.coordinates[0], booking.src.coordinates[1]]}
            icon={markerIcon}
          />
        )}

        {booking?.status === "collected" && (
          <Marker
            key="end-location"
            position={[
              booking.destn.coordinates[0],
              booking.destn.coordinates[1],
            ]}
            icon={markerIcon}
          />
        )}
      </MapContainer>
    </div>
  );
};

export default DriverTracking;
