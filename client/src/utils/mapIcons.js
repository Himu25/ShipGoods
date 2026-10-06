import L from "leaflet";

const pinSvg = (fill, letter, filterId) => `
  <svg width="40" height="52" viewBox="0 0 40 52" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="${filterId}" x="-20%" y="-10%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.35"/>
      </filter>
    </defs>
    <g filter="url(#${filterId})">
      <path d="M20 0C9.5 0 1 8.5 1 19c0 14.2 17.2 31.4 17.9 32.1a1.5 1.5 0 0 0 2.2 0C21.8 50.4 39 33.2 39 19 39 8.5 30.5 0 20 0z" fill="${fill}"/>
      <circle cx="20" cy="19" r="10" fill="white" fill-opacity="0.95"/>
      <text x="20" y="23.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="${fill}">${letter}</text>
    </g>
  </svg>
`;

const currentSvg = `
  <div class="sg-current">
    <span class="sg-current__pulse"></span>
    <span class="sg-current__dot"></span>
  </div>
`;

function divIcon(html, size, anchor) {
  return L.divIcon({
    className: "sg-marker",
    html,
    iconSize: size,
    iconAnchor: anchor,
    popupAnchor: [0, -anchor[1] + 8],
  });
}

export const pickupIcon = divIcon(
  pinSvg("#16a34a", "A", "sg-pin-a"),
  [40, 52],
  [20, 52]
);
export const dropoffIcon = divIcon(
  pinSvg("#dc2626", "B", "sg-pin-b"),
  [40, 52],
  [20, 52]
);

/**
 * Premium Uber-style top-down vehicle icons.
 * Soft oval shadow + dark glossy body + glass + lights (no circle badge).
 */
function uberMarker(type, filterId) {
  const art = {
    car: `
      <ellipse cx="32" cy="58" rx="14" ry="4.5" fill="#000" opacity="0.2"/>
      <defs>
        <linearGradient id="${filterId}-body" x1="18" y1="8" x2="46" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#3f3f46"/>
          <stop offset="45%" stop-color="#18181b"/>
          <stop offset="100%" stop-color="#09090b"/>
        </linearGradient>
        <linearGradient id="${filterId}-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f1f5f9"/>
          <stop offset="100%" stop-color="#94a3b8"/>
        </linearGradient>
      </defs>
      <!-- body -->
      <path d="M22 16c0-5.2 4.2-9.5 10-9.5s10 4.3 10 9.5v28c0 5.2-4.2 9.5-10 9.5s-10-4.3-10-9.5V16z" fill="url(#${filterId}-body)"/>
      <!-- left gloss -->
      <path d="M23.5 17c0.5-4 3.2-7 8-7 .4 0 .8 0 1.2.05-3.2.6-5.2 3-5.2 6.5v26c0 2.8 1.2 5.1 3.1 6.3-.5.15-1 .2-1.6.2-4.5 0-7.5-3-7.5-7.05V17z" fill="#fff" opacity="0.12"/>
      <!-- windshield -->
      <rect x="25" y="19" width="14" height="10" rx="2.8" fill="url(#${filterId}-glass)"/>
      <rect x="25" y="19" width="14" height="2.5" rx="1.2" fill="#64748b" opacity="0.35"/>
      <!-- rear window -->
      <rect x="25.5" y="37" width="13" height="7.5" rx="2.2" fill="url(#${filterId}-glass)" opacity="0.9"/>
      <!-- mirrors -->
      <rect x="18.5" y="27" width="3.5" height="6.5" rx="1.5" fill="#18181b"/>
      <rect x="42" y="27" width="3.5" height="6.5" rx="1.5" fill="#18181b"/>
      <!-- headlights -->
      <rect x="24.5" y="9.5" width="4" height="2.4" rx="1.2" fill="#fef08a"/>
      <rect x="35.5" y="9.5" width="4" height="2.4" rx="1.2" fill="#fef08a"/>
      <!-- taillights -->
      <rect x="24.8" y="50.5" width="3.6" height="2" rx="0.9" fill="#f43f5e"/>
      <rect x="35.6" y="50.5" width="3.6" height="2" rx="0.9" fill="#f43f5e"/>
      <!-- roof line -->
      <rect x="28" y="31.5" width="8" height="2" rx="1" fill="#fff" opacity="0.08"/>
    `,
    truck: `
      <ellipse cx="32" cy="58" rx="15" ry="4.2" fill="#000" opacity="0.2"/>
      <defs>
        <linearGradient id="${filterId}-body" x1="16" y1="6" x2="48" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#3f3f46"/>
          <stop offset="100%" stop-color="#09090b"/>
        </linearGradient>
        <linearGradient id="${filterId}-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f1f5f9"/>
          <stop offset="100%" stop-color="#94a3b8"/>
        </linearGradient>
      </defs>
      <rect x="19" y="6" width="26" height="26" rx="3.5" fill="url(#${filterId}-body)"/>
      <rect x="21" y="8.5" width="22" height="21" rx="2" fill="#fff" opacity="0.06"/>
      <path d="M20 34h24c3 0 5.5 2.5 5.5 5.5v10c0 3-2.5 5.5-5.5 5.5H20c-3 0-5.5-2.5-5.5-5.5v-10c0-3 2.5-5.5 5.5-5.5z" fill="url(#${filterId}-body)"/>
      <rect x="23.5" y="37" width="17" height="9" rx="2.5" fill="url(#${filterId}-glass)"/>
      <rect x="23" y="51.5" width="4" height="2" rx="1" fill="#fef08a"/>
      <rect x="37" y="51.5" width="4" height="2" rx="1" fill="#fef08a"/>
    `,
    bus: `
      <ellipse cx="32" cy="58" rx="15" ry="4.2" fill="#000" opacity="0.18"/>
      <defs>
        <linearGradient id="${filterId}-body" x1="16" y1="5" x2="48" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#312e81"/>
          <stop offset="100%" stop-color="#1e1b4b"/>
        </linearGradient>
        <linearGradient id="${filterId}-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e2e8f0"/>
          <stop offset="100%" stop-color="#94a3b8"/>
        </linearGradient>
      </defs>
      <rect x="18" y="6" width="28" height="48" rx="7" fill="url(#${filterId}-body)"/>
      <path d="M20 8h8v44h-8c-1.5 0-2.8-1.5-2.8-3.5V11.5c0-2 1.3-3.5 2.8-3.5z" fill="#fff" opacity="0.1"/>
      <rect x="22" y="11" width="8" height="7" rx="1.8" fill="url(#${filterId}-glass)"/>
      <rect x="34" y="11" width="8" height="7" rx="1.8" fill="url(#${filterId}-glass)"/>
      <rect x="22" y="22" width="8" height="7" rx="1.8" fill="url(#${filterId}-glass)"/>
      <rect x="34" y="22" width="8" height="7" rx="1.8" fill="url(#${filterId}-glass)"/>
      <rect x="22" y="33" width="8" height="7" rx="1.8" fill="url(#${filterId}-glass)"/>
      <rect x="34" y="33" width="8" height="7" rx="1.8" fill="url(#${filterId}-glass)"/>
      <rect x="24" y="46" width="16" height="3" rx="1.2" fill="#000" opacity="0.2"/>
    `,
    motorcycle: `
      <ellipse cx="32" cy="56" rx="11" ry="3.5" fill="#000" opacity="0.18"/>
      <defs>
        <linearGradient id="${filterId}-body" x1="20" y1="8" x2="44" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#3f3f46"/>
          <stop offset="100%" stop-color="#09090b"/>
        </linearGradient>
      </defs>
      <circle cx="32" cy="16" r="8" fill="none" stroke="url(#${filterId}-body)" stroke-width="4"/>
      <circle cx="32" cy="44" r="9" fill="none" stroke="url(#${filterId}-body)" stroke-width="4"/>
      <circle cx="32" cy="16" r="2.5" fill="#18181b"/>
      <circle cx="32" cy="44" r="2.8" fill="#18181b"/>
      <path d="M32 24.5v15.5M32 29l8-5.5M27 36.5h11" stroke="#18181b" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="28.5" y="27.5" width="7" height="4.5" rx="1.2" fill="#cbd5e1"/>
    `,
  };

  return `
  <div class="sg-vehicle-marker sg-uber-marker">
    <svg width="56" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="${filterId}" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity="0.3"/>
        </filter>
      </defs>
      <g filter="url(#${filterId})">${art[type]}</g>
    </svg>
  </div>`;
}

export const vehicleTypeIcons = {
  car: divIcon(uberMarker("car", "sg-uber-car"), [56, 64], [28, 32]),
  truck: divIcon(uberMarker("truck", "sg-uber-truck"), [56, 64], [28, 32]),
  bus: divIcon(uberMarker("bus", "sg-uber-bus"), [56, 64], [28, 32]),
  motorcycle: divIcon(uberMarker("motorcycle", "sg-uber-bike"), [56, 64], [28, 32]),
};

export const getVehicleIcon = (type) =>
  vehicleTypeIcons[type] || vehicleTypeIcons.car;

export const driverIcon = vehicleTypeIcons.car;

/** Static live-tracking icon — rotate via CSS --h on `.sg-live-car__body` */
export const liveDriverIcon = divIcon(
  `
  <div class="sg-live-car">
    <div class="sg-live-car__shadow"></div>
    <div class="sg-live-car__body">
      <svg width="44" height="44" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sg-live-body" x1="32" y1="6" x2="32" y2="58" gradientUnits="userSpaceOnUse">
            <stop stop-color="#2a2a2e"/>
            <stop offset="0.45" stop-color="#111114"/>
            <stop offset="1" stop-color="#050506"/>
          </linearGradient>
          <linearGradient id="sg-live-glass" x1="32" y1="14" x2="32" y2="28" gradientUnits="userSpaceOnUse">
            <stop stop-color="#dbeafe"/>
            <stop offset="1" stop-color="#64748b"/>
          </linearGradient>
          <linearGradient id="sg-live-rear" x1="32" y1="36" x2="32" y2="48" gradientUnits="userSpaceOnUse">
            <stop stop-color="#94a3b8"/>
            <stop offset="1" stop-color="#475569"/>
          </linearGradient>
        </defs>
        <!-- body (nose = top / north) -->
        <path d="M22 14c0-4.4 4.5-8 10-8s10 3.6 10 8v32c0 4.4-4.5 8-10 8s-10-3.6-10-8V14z" fill="url(#sg-live-body)"/>
        <path d="M23.2 15c.4-3.6 3.4-6.2 8.8-6.2.5 0 1 0 1.4.05-3 .55-4.8 2.6-4.8 5.7v30c0 2.4 1 4.4 2.6 5.5-.4.1-.9.15-1.4.15-4.2 0-6.6-2.6-6.6-6.2V15z" fill="#fff" opacity=".1"/>
        <!-- windshield -->
        <rect x="25" y="16" width="14" height="11" rx="2.6" fill="url(#sg-live-glass)"/>
        <rect x="25" y="16" width="14" height="2.2" rx="1" fill="#334155" opacity=".35"/>
        <!-- roof -->
        <rect x="27.5" y="29" width="9" height="5" rx="1.2" fill="#fff" opacity=".06"/>
        <!-- rear window -->
        <rect x="25.5" y="36.5" width="13" height="8" rx="2.2" fill="url(#sg-live-rear)" opacity=".9"/>
        <!-- mirrors -->
        <rect x="18.5" y="26" width="3.8" height="7" rx="1.6" fill="#0a0a0b"/>
        <rect x="41.7" y="26" width="3.8" height="7" rx="1.6" fill="#0a0a0b"/>
        <!-- headlights -->
        <rect x="24.5" y="8.2" width="4.2" height="2.6" rx="1.2" fill="#fef08a"/>
        <rect x="35.3" y="8.2" width="4.2" height="2.6" rx="1.2" fill="#fef08a"/>
        <!-- taillights -->
        <rect x="24.8" y="51.5" width="3.8" height="2.2" rx="1" fill="#fb7185"/>
        <rect x="35.4" y="51.5" width="3.8" height="2.2" rx="1" fill="#fb7185"/>
      </svg>
    </div>
  </div>`,
  [52, 52],
  [26, 26]
);

/** @deprecated use liveDriverIcon + CSS rotation */
export function getMovingDriverIcon() {
  return liveDriverIcon;
}

export const currentLocationIcon = divIcon(currentSvg, [28, 28], [14, 14]);

export const ROUTE_LINE_STYLES = [
  { color: "#1d4ed8", opacity: 0.2, weight: 10 },
  { color: "#3b82f6", opacity: 0.95, weight: 5 },
];

export const MAP_TILE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  attribution:
    "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom",
};

export const DEFAULT_CENTER = [28.6654, 77.4391];
export const CURRENT_LOCATION_ZOOM = 15;

export const INDIA_BOUNDS = [
  [6.5, 68.0],
  [35.7, 97.5],
];

export const isInIndia = (lat, lng) =>
  lat >= 6.5 && lat <= 35.7 && lng >= 68.0 && lng <= 97.5;
