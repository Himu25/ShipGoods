"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import L from "leaflet";
import "leaflet-routing-machine";
import axios from "axios";
import { AutoComplete, Select, Checkbox, DatePicker, Spin } from "antd";
import {
  EnvironmentOutlined,
  AimOutlined,
  CarOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import NearByCard from "./NearByCard";
import MapResizeFix from "./MapResizeFix";
import {
  pickupIcon,
  dropoffIcon,
  currentLocationIcon,
  getVehicleIcon,
  DEFAULT_CENTER,
  CURRENT_LOCATION_ZOOM,
  INDIA_BOUNDS,
  isInIndia,
  MAP_TILE,
  ROUTE_LINE_STYLES,
} from "@/utils/mapIcons";

const { Option } = Select;

function MapViewSync({ currentLocation, pickupLocation, nearbyDrivers }) {
  const map = useMap();
  const lastFitKey = useRef(null);

  useEffect(() => {
    const points = [];

    if (currentLocation) {
      points.push([currentLocation.lat, currentLocation.lng]);
    }
    if (pickupLocation) {
      points.push([pickupLocation.lat, pickupLocation.lng]);
    }

    (nearbyDrivers || []).forEach((driver) => {
      const coords = driver.currentLocation?.coordinates;
      if (coords?.length >= 2) {
        const [lng, lat] = coords;
        points.push([lat, lng]);
      }
    });

    if (points.length === 0) return;

    const key = [
      points.length,
      ...(nearbyDrivers || []).map((d) => d._id),
      currentLocation
        ? `${currentLocation.lat.toFixed(4)},${currentLocation.lng.toFixed(4)}`
        : "",
      pickupLocation
        ? `${pickupLocation.lat.toFixed(4)},${pickupLocation.lng.toFixed(4)}`
        : "",
    ].join("|");

    if (lastFitKey.current === key) return;
    lastFitKey.current = key;

    if (points.length === 1) {
      map.setView(points[0], CURRENT_LOCATION_ZOOM, { animate: true });
      return;
    }

    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, {
      padding: [56, 56],
      maxZoom: 15,
      animate: true,
    });
  }, [map, currentLocation, pickupLocation, nearbyDrivers]);

  return null;
}

function RoutingMachine({ pickup, dropoff, onRouteFound }) {
  const map = useMap();
  const controlRef = useRef(null);
  const onRouteFoundRef = useRef(onRouteFound);
  onRouteFoundRef.current = onRouteFound;

  useEffect(() => {
    if (!pickup || !dropoff) {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
      return;
    }

    if (controlRef.current) {
      map.removeControl(controlRef.current);
      controlRef.current = null;
    }

    const control = L.Routing.control({
      waypoints: [
        L.latLng(pickup.lat, pickup.lng),
        L.latLng(dropoff.lat, dropoff.lng),
      ],
      routeWhileDragging: false,
      addWaypoints: false,
      draggableWaypoints: false,
      fitRoute: false,
      show: false,
      createMarker: () => null,
      lineOptions: {
        styles: ROUTE_LINE_STYLES,
        extendToWaypoints: true,
        missingRouteTolerance: 0,
      },
    }).addTo(map);

    control.on("routesfound", (e) => {
      const route = e.routes[0];
      onRouteFoundRef.current?.({
        distance: (route.summary.totalDistance / 1000).toFixed(2),
        duration: (route.summary.totalTime / 60).toFixed(2),
      });
    });

    controlRef.current = control;

    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [map, pickup, dropoff]);

  return null;
}

const LeafletMap = () => {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropoffLocation, setDropoffLocation] = useState(null);
  const [suggestionsPickup, setSuggestionsPickup] = useState([]);
  const [suggestionsDropoff, setSuggestionsDropoff] = useState([]);
  const [routeDetails, setRouteDetails] = useState({
    distance: 0,
    duration: 0,
  });
  const [carType, setCarType] = useState("car");
  const [pickupText, setPickupText] = useState("");
  const [dropoffText, setDropoffText] = useState("");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(null);
  const [locating, setLocating] = useState(true);
  const [nearbyDrivers, setNearbyDrivers] = useState([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const searchTimers = useRef({ pickup: null, dropoff: null });

  const reverseGeocode = useCallback(async (lat, lng) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&countrycodes=in`,
        { headers: { Accept: "application/json" } }
      );
      const data = await res.json();
      return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }, []);

  const applyCurrentLocation = useCallback(
    async (latitude, longitude, setAsPickup = false) => {
      if (!isInIndia(latitude, longitude)) {
        setLocating(false);
        return;
      }
      const loc = { lat: latitude, lng: longitude };
      setCurrentLocation(loc);
      if (setAsPickup) {
        setPickupLocation(loc);
        setPickupText(await reverseGeocode(latitude, longitude));
      }
      setLocating(false);
    },
    [reverseGeocode]
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        applyCurrentLocation(latitude, longitude, true);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!isInIndia(latitude, longitude)) return;
        setCurrentLocation({ lat: latitude, lng: longitude });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (value, isPickup = true) => {
    const key = isPickup ? "pickup" : "dropoff";
    if (searchTimers.current[key]) clearTimeout(searchTimers.current[key]);

    if (!value?.trim()) {
      if (isPickup) setSuggestionsPickup([]);
      else setSuggestionsDropoff([]);
      return;
    }

    searchTimers.current[key] = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
            value
          )}&format=json&limit=6&countrycodes=in&viewbox=68.0,6.5,97.5,35.7&bounded=1`,
          { headers: { Accept: "application/json" } }
        );
        const data = await response.json();
        const options = data
          .filter((s) => isInIndia(parseFloat(s.lat), parseFloat(s.lon)))
          .map((suggestion) => ({
            value: suggestion.display_name,
            lat: suggestion.lat,
            lon: suggestion.lon,
          }));
        if (isPickup) setSuggestionsPickup(options);
        else setSuggestionsDropoff(options);
      } catch (err) {
        console.error("Location search failed:", err);
      }
    }, 350);
  };

  const handleSelect = (value, option, isPickup = true) => {
    const latLng = {
      lat: parseFloat(option.lat),
      lng: parseFloat(option.lon),
    };
    if (!isInIndia(latLng.lat, latLng.lng)) return;
    if (isPickup) {
      setPickupLocation(latLng);
      setPickupText(value);
    } else {
      setDropoffLocation(latLng);
      setDropoffText(value);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        applyCurrentLocation(latitude, longitude, true);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    if (!pickupLocation || !carType) {
      setNearbyDrivers([]);
      return;
    }

    let cancelled = false;
    const fetchNearby = async () => {
      setLoadingDrivers(true);
      try {
        const response = await axios.post(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/nearby-drivers`,
          {
            startLocation: {
              latitude: pickupLocation.lat,
              longitude: pickupLocation.lng,
            },
            vehicleType: carType,
          }
        );
        if (!cancelled) setNearbyDrivers(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        console.error("Error fetching nearby drivers:", err);
        if (!cancelled) setNearbyDrivers([]);
      } finally {
        if (!cancelled) setLoadingDrivers(false);
      }
    };

    fetchNearby();
    return () => {
      cancelled = true;
    };
  }, [pickupLocation, carType]);

  const mapCenter = useMemo(() => {
    if (currentLocation) return [currentLocation.lat, currentLocation.lng];
    return DEFAULT_CENTER;
  }, [currentLocation]);

  const vehicleLabel = carType.charAt(0).toUpperCase() + carType.slice(1);

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-var(--nav-height))] bg-slate-100 overflow-hidden">
      <aside className="lg:w-[380px] xl:w-[420px] w-full shrink-0 z-20 flex flex-col max-h-[48vh] lg:max-h-none bg-white border-r border-slate-200 shadow-[4px_0_24px_rgba(15,23,42,0.06)]">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 bg-gradient-to-br from-blue-50 via-white to-slate-50">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-1">
            New booking
          </p>
          <h2 className="text-xl font-bold text-slate-900">
            Where are we shipping?
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            India only — map stays zoomed to your current location.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                A
              </span>
              Pickup
            </label>
            <AutoComplete
              className="w-full sg-autocomplete"
              style={{ width: "100%" }}
              placeholder="Search pick-up in India"
              options={suggestionsPickup}
              value={pickupText}
              onChange={(v) => {
                setPickupText(v);
                handleSearch(v, true);
              }}
              onSearch={(value) => handleSearch(value, true)}
              onSelect={(value, option) => handleSelect(value, option, true)}
              size="large"
              allowClear
            />
            <button
              type="button"
              onClick={useMyLocation}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <AimOutlined />
              {locating ? "Detecting location…" : "Use my current location"}
            </button>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600 text-[10px] font-bold">
                B
              </span>
              Drop-off
            </label>
            <AutoComplete
              className="w-full sg-autocomplete"
              style={{ width: "100%" }}
              placeholder="Search drop-off in India"
              options={suggestionsDropoff}
              value={dropoffText}
              onChange={(v) => {
                setDropoffText(v);
                handleSearch(v, false);
              }}
              onSearch={(value) => handleSearch(value, false)}
              onSelect={(value, option) => handleSelect(value, option, false)}
              size="large"
              allowClear
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-1.5">
              <CarOutlined className="text-blue-600" />
              Vehicle type
            </label>
            <Select
              className="w-full"
              value={carType}
              onChange={setCarType}
              size="large"
            >
              <Option value="car">Car</Option>
              <Option value="truck">Truck</Option>
              <Option value="bus">Bus</Option>
              <Option value="motorcycle">Motorcycle</Option>
            </Select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <Checkbox
              checked={isScheduled}
              onChange={(e) => setIsScheduled(e.target.checked)}
            >
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                <ClockCircleOutlined />
                Schedule for later
              </span>
            </Checkbox>
            {isScheduled && (
              <DatePicker
                className="w-full mt-3"
                onChange={(date) => setScheduleDate(date ? date.toDate() : null)}
                showTime
                size="large"
              />
            )}
          </div>

          {pickupLocation && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-slate-800">
                  Nearby {vehicleLabel}s
                </p>
                {loadingDrivers ? (
                  <Spin size="small" />
                ) : (
                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    {nearbyDrivers.length} found
                  </span>
                )}
              </div>
              {!loadingDrivers && nearbyDrivers.length === 0 && (
                <p className="text-xs text-slate-500">
                  No {carType}s nearby. Try another vehicle type.
                </p>
              )}
              <ul className="space-y-2 max-h-36 overflow-y-auto">
                {nearbyDrivers.slice(0, 6).map((driver) => (
                  <li
                    key={driver._id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="font-medium text-slate-700 truncate">
                      {driver.name}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {Number(driver.dist?.calculated ?? 0).toFixed(2)} km
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pickupLocation && dropoffLocation && (
            <div className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-2.5 text-sm text-slate-700 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <EnvironmentOutlined className="text-blue-600" />
                {routeDetails.distance || "—"} km
              </span>
              <span className="text-slate-400">•</span>
              <span>~{routeDetails.duration || "—"} min</span>
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
              nearbyDrivers={nearbyDrivers}
              loadingDrivers={loadingDrivers}
            />
          )}
        </div>
      </aside>

      <div className="relative flex-1 min-h-[52vh] lg:min-h-0 z-0">
        <MapContainer
          center={mapCenter}
          zoom={CURRENT_LOCATION_ZOOM}
          minZoom={5}
          maxBounds={INDIA_BOUNDS}
          maxBoundsViscosity={1.0}
          scrollWheelZoom
          className="h-full w-full sg-map"
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url={MAP_TILE.url} attribution={MAP_TILE.attribution} />
          <MapResizeFix />
          <MapViewSync
            currentLocation={currentLocation}
            pickupLocation={pickupLocation}
            nearbyDrivers={nearbyDrivers}
          />
          <RoutingMachine
            pickup={pickupLocation}
            dropoff={dropoffLocation}
            onRouteFound={setRouteDetails}
          />
          {currentLocation && (
            <Marker
              position={[currentLocation.lat, currentLocation.lng]}
              icon={currentLocationIcon}
            />
          )}
          {pickupLocation && (
            <Marker
              position={[pickupLocation.lat, pickupLocation.lng]}
              icon={pickupIcon}
            />
          )}
          {dropoffLocation && (
            <Marker
              position={[dropoffLocation.lat, dropoffLocation.lng]}
              icon={dropoffIcon}
            />
          )}
          {nearbyDrivers.map((driver) => {
            const coords = driver.currentLocation?.coordinates;
            if (!coords || coords.length < 2) return null;
            const [lng, lat] = coords;
            const type = driver.vehicleDetails?.type || carType;
            return (
              <Marker
                key={driver._id}
                position={[lat, lng]}
                icon={getVehicleIcon(type)}
              >
                <Popup>
                  <strong>{driver.name}</strong>
                  <br />
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                  {driver.vehicleDetails?.model
                    ? ` · ${driver.vehicleDetails.model}`
                    : ""}
                  <br />
                  {Number(driver.dist?.calculated ?? 0).toFixed(2)} km away
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {pickupLocation && nearbyDrivers.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4 z-[500]">
            <div className="rounded-full bg-white/95 shadow-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">
              Showing {nearbyDrivers.length} nearby {carType}
              {nearbyDrivers.length === 1 ? "" : "s"} on map
            </div>
          </div>
        )}

        {!currentLocation && !locating && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4 z-[500]">
            <div className="rounded-full bg-white/95 shadow-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">
              Allow location access to zoom to your position in India
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LeafletMap;
