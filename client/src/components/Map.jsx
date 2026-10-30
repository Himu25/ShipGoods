"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marker, Popup } from "react-leaflet";
import axios from "axios";
import { AutoComplete, Select, Checkbox, DatePicker, Spin } from "antd";
import {
  EnvironmentOutlined,
  AimOutlined,
  CarOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import NearByCard from "./NearByCard";
import BaseMap from "./map/BaseMap";
import { RouteLine, useRoadRoute } from "./map/LiveLayers";
import {
  pickupIcon,
  dropoffIcon,
  currentLocationIcon,
  getVehicleIcon,
  DEFAULT_CENTER,
  CURRENT_LOCATION_ZOOM,
  INDIA_BOUNDS,
  isInIndia,
  ROUTE_LINE_STYLES,
} from "@/utils/mapIcons";

const { Option } = Select;

/** Stable pseudo-heading per driver, so parked cars face varied ways. */
function headingFor(id = "") {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

const latLngKey = (p) => (p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : "");

const LeafletMap = () => {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropoffLocation, setDropoffLocation] = useState(null);
  const [suggestionsPickup, setSuggestionsPickup] = useState([]);
  const [suggestionsDropoff, setSuggestionsDropoff] = useState([]);
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

  const pickupLatLng = useMemo(
    () => pickupLocation && [pickupLocation.lat, pickupLocation.lng],
    [pickupLocation]
  );
  const dropoffLatLng = useMemo(
    () => dropoffLocation && [dropoffLocation.lat, dropoffLocation.lng],
    [dropoffLocation]
  );
  const route = useRoadRoute(pickupLatLng, dropoffLatLng, latLngKey(pickupLocation));
  const routeDetails = {
    distance: route?.distanceKm != null ? route.distanceKm.toFixed(2) : 0,
    duration: route?.durationMin != null ? route.durationMin.toFixed(2) : 0,
  };

  const driverPoints = useMemo(
    () =>
      nearbyDrivers
        .map((d) => d.currentLocation?.coordinates)
        .filter((c) => c?.length >= 2)
        .map(([lng, lat]) => [lat, lng]),
    [nearbyDrivers]
  );

  // Frame the trip once it has a road; otherwise pickup + nearby cars;
  // otherwise the user. GPS updates never refit (the key ignores them).
  const { fitPoints, fitKey } = useMemo(() => {
    if (route?.points?.length > 1) {
      return { fitPoints: route.points, fitKey: `route|${latLngKey(pickupLocation)}|${latLngKey(dropoffLocation)}` };
    }
    if (pickupLatLng) {
      return {
        fitPoints: [pickupLatLng, ...driverPoints],
        fitKey: `pickup|${latLngKey(pickupLocation)}|${nearbyDrivers.map((d) => d._id).join(",")}`,
      };
    }
    if (currentLocation) {
      return { fitPoints: [[currentLocation.lat, currentLocation.lng]], fitKey: "me" };
    }
    return { fitPoints: [], fitKey: "" };
  }, [route, pickupLatLng, pickupLocation, dropoffLocation, driverPoints, nearbyDrivers, currentLocation]);

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
                      {driver.demo === "bot" ? `🤖 ${driver.name}` : driver.name}
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
        <BaseMap
          center={DEFAULT_CENTER}
          zoom={CURRENT_LOCATION_ZOOM}
          minZoom={5}
          maxBounds={INDIA_BOUNDS}
          maxBoundsViscosity={1.0}
          fitPoints={fitPoints}
          fitKey={fitKey}
          fitPadding={64}
          fitMaxZoom={15}
          singleZoom={CURRENT_LOCATION_ZOOM}
        >
          <RouteLine points={route?.points} styles={ROUTE_LINE_STYLES} />
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
                icon={getVehicleIcon(type, headingFor(driver._id))}
              >
                <Popup>
                  <p className="m-0 font-semibold text-slate-900">
                    {driver.demo === "bot" ? `🤖 ${driver.name}` : driver.name}
                  </p>
                  <p className="m-0 mt-0.5 text-xs text-slate-500">
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                    {driver.vehicleDetails?.model ? ` · ${driver.vehicleDetails.model}` : ""}
                    {" · "}
                    {Number(driver.dist?.calculated ?? 0).toFixed(2)} km away
                  </p>
                </Popup>
              </Marker>
            );
          })}
        </BaseMap>

        {pickupLocation && nearbyDrivers.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4 z-[500]">
            <div className="sg-map-pill">
              <span className="sg-map-pill__dot" style={{ "--dot": "#10b981" }} />
              {nearbyDrivers.length} {carType}
              {nearbyDrivers.length === 1 ? "" : "s"} nearby
            </div>
          </div>
        )}

        {!currentLocation && !locating && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4 z-[500]">
            <div className="sg-map-pill sg-map-pill--warn">
              <span className="sg-map-pill__dot" />
              Allow location access to zoom to your position in India
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LeafletMap;
