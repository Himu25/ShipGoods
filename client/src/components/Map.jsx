"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import L from "leaflet";
import "leaflet-routing-machine";
import { AutoComplete, Select, Checkbox, DatePicker } from "antd";
import NearByCard from "./NearByCard";

const { Option } = Select;

const LeafletMap = () => {
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropoffLocation, setDropoffLocation] = useState(null);
  const [suggestionsPickup, setSuggestionsPickup] = useState([]);
  const [suggestionsDropoff, setSuggestionsDropoff] = useState([]);
  const [routeControl, setRouteControl] = useState(null);
  const [routeDetails, setRouteDetails] = useState({
    distance: 0,
    duration: 0,
  });
  const [carType, setCarType] = useState("car");
  const [pickupText, setPickupText] = useState("");
  const [dropoffText, setDropoffText] = useState("");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(null);

  const mapRef = useRef(null);

  const customMarkerIcon = new L.Icon({
    iconUrl: "https://img.icons8.com/color/48/marker.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
  });

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const currentLocation = { lat: latitude, lng: longitude };
        setPickupLocation(currentLocation);
        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 13);
        }
      },
      (error) => {
        console.error("Error getting location: ", error);
      }
    );
  }, []);

  useEffect(() => {
    if (mapRef.current && pickupLocation && dropoffLocation) {
      const map = mapRef.current;
      if (routeControl) {
        map.removeControl(routeControl);
      }

      const newRouteControl = L.Routing.control({
        waypoints: [
          L.latLng(pickupLocation.lat, pickupLocation.lng),
          L.latLng(dropoffLocation.lat, dropoffLocation.lng),
        ],
        routeWhileDragging: true,
        createMarker: () => null,
      }).addTo(map);

      newRouteControl.on("routesfound", (e) => {
        const route = e.routes[0];
        const distanceInKm = (route.summary.totalDistance / 1000).toFixed(2);
        const timeInMinutes = (route.summary.totalTime / 60).toFixed(2);

        setRouteDetails({ distance: distanceInKm, duration: timeInMinutes });

        const bounds = L.latLngBounds(route.coordinates);
        map.fitBounds(bounds);
      });

      setRouteControl(newRouteControl);
    }
  }, [pickupLocation, dropoffLocation]);

  const handleSearch = async (value, isPickup = true) => {
    if (!value) {
      if (isPickup) setSuggestionsPickup([]);
      else setSuggestionsDropoff([]);
      return;
    }
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${value}&format=json`
    );
    const data = await response.json();
    const options = data.map((suggestion) => ({
      value: suggestion.display_name,
      lat: suggestion.lat,
      lon: suggestion.lon,
    }));
    if (isPickup) {
      setSuggestionsPickup(options);
    } else {
      setSuggestionsDropoff(options);
    }
  };

  const handleSelect = (value, option, isPickup = true) => {
    const latLng = {
      lat: parseFloat(option.lat),
      lng: parseFloat(option.lon),
    };
    if (isPickup) {
      setPickupLocation(latLng);
      setPickupText(value);
    } else {
      setDropoffLocation(latLng);
      setDropoffText(value);
    }
    mapRef.current?.setView([latLng.lat, latLng.lng], 13);
  };

  const handleCarTypeChange = (value) => {
    setCarType(value);
  };

  const handleScheduleChange = (e) => {
    setIsScheduled(e.target.checked);
  };

  const handleDateChange = (date, dateString) => {
    console.log("🚀 ~ handleDateChange ~ date, dateString:", new Date(date));
    setScheduleDate(new Date(date));
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-50">
      <div
        className="md:w-1/3 w-full p-6 bg-white shadow-lg relative z-20 overflow-y-auto"
        style={{ maxHeight: "100vh" }}
      >
        <h2 className="text-2xl font-semibold text-gray-700 mb-4">
          Select Locations
        </h2>
        <div className="mb-4">
          <AutoComplete
            style={{ width: "100%", fontSize: "16px" }}
            placeholder="Search Pick-up Location"
            options={suggestionsPickup}
            onSearch={(value) => handleSearch(value, true)}
            onSelect={(value, option) => handleSelect(value, option, true)}
            size="large"
          />
        </div>
        <div className="mb-4">
          <AutoComplete
            style={{ width: "100%", fontSize: "16px" }}
            placeholder="Search Drop-off Location"
            options={suggestionsDropoff}
            onSearch={(value) => handleSearch(value, false)}
            onSelect={(value, option) => handleSelect(value, option, false)}
            size="large"
          />
        </div>

        <div className="mb-4">
          <label className="block mb-2 text-gray-700 font-semibold">
            Select Vehicle Type:
          </label>
          <Select
            className="w-full"
            value={carType}
            onChange={handleCarTypeChange}
            size="large"
          >
            <Option value="car">Car</Option>
            <Option value="truck">Truck</Option>
            <Option value="bus">Bus</Option>
            <Option value="motorcycle">Motorcycle</Option>
          </Select>
        </div>

        <div className="mb-4">
          <Checkbox onChange={handleScheduleChange}>Scheduled Ride</Checkbox>
        </div>

        {isScheduled && (
          <div className="mb-4">
            <DatePicker
              className="w-full"
              onChange={handleDateChange}
              showTime
              size="large"
            />
          </div>
        )}
        {pickupLocation && dropoffLocation && (
          <NearByCard
            totalDis={routeDetails.distance}
            totalTime={routeDetails.duration}
            startCoordinates={pickupLocation}
            endCoordinates={dropoffLocation}
            srcText={pickupText}
            destnText={dropoffText}
            vehicleType={carType}
            scheduleDate={scheduleDate}
            isScheduled={isScheduled}
            scheduledTime={scheduleDate}
          />
        )}
      </div>
      <div className="md:w-2/3 w-full h-full relative">
        <MapContainer
          center={
            pickupLocation
              ? [pickupLocation.lat, pickupLocation.lng]
              : [51.505, -0.09]
          }
          zoom={13}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
          ref={(mapInstance) => {
            mapRef.current = mapInstance ? mapInstance : null;
          }}
          className="rounded-lg shadow-lg"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          {pickupLocation && (
            <Marker
              position={[pickupLocation.lat, pickupLocation.lng]}
              icon={customMarkerIcon}
            />
          )}
          {dropoffLocation && (
            <Marker
              position={[dropoffLocation.lat, dropoffLocation.lng]}
              icon={customMarkerIcon}
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
};

export default LeafletMap;
