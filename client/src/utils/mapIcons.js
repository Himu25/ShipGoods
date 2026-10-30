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

/**
 * Top-down sedan for live tracking, nose pointing north; the marker
 * rotates `.sg-live-car` via the CSS var --h. "bot" is the violet
 * showcase robotaxi with a roof sensor; "standard" is the black sedan.
 */
function liveCarSvg(variant) {
  const bot = variant === "bot";
  const id = `sg-car-${variant}`;
  const body = bot
    ? ["#4c1d95", "#8b5cf6", "#4c1d95"]
    : ["#050506", "#3a3a40", "#050506"];
  const roof = bot ? "#6d28d9" : "#1c1c20";
  return `
    <svg width="40" height="48" viewBox="0 0 40 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${id}-body" x1="6" y1="0" x2="34" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${body[0]}"/>
          <stop offset="0.5" stop-color="${body[1]}"/>
          <stop offset="1" stop-color="${body[2]}"/>
        </linearGradient>
        <linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e2e8f0"/>
          <stop offset="1" stop-color="#475569"/>
        </linearGradient>
        <radialGradient id="${id}-sensor" cx="0.5" cy="0.4" r="0.6">
          <stop offset="0" stop-color="#ecfeff"/>
          <stop offset="0.55" stop-color="#22d3ee"/>
          <stop offset="1" stop-color="#0e7490"/>
        </radialGradient>
      </defs>
      <!-- body: slightly narrower nose, wider rear -->
      <path d="M12.5 6.5C13.5 3 16.4 1.5 20 1.5s6.5 1.5 7.5 5l2 7.5c.7 2.6 1 5.2 1 7.8V38c0 4.6-3 8.5-10.5 8.5S9.5 42.6 9.5 38V21.8c0-2.6.3-5.2 1-7.8l2-7.5z" fill="url(#${id}-body)"/>
      <!-- hood sheen -->
      <path d="M16 5c1-1.6 2.4-2.2 4-2.2s3 .6 4 2.2l-1 6h-6l-1-6z" fill="#fff" opacity="${bot ? 0.18 : 0.1}"/>
      <!-- windshield -->
      <path d="M12.6 15.2c4.6-1.7 10.2-1.7 14.8 0l-1.6 6.6c-3.8-.9-7.8-.9-11.6 0l-1.6-6.6z" fill="url(#${id}-glass)"/>
      <!-- roof -->
      <rect x="13.6" y="21.6" width="12.8" height="13.2" rx="3.2" fill="${roof}"/>
      <rect x="14.6" y="22.4" width="5" height="11.6" rx="2.4" fill="#fff" opacity="0.07"/>
      <!-- side windows -->
      <path d="M11.4 22.2l2 .6v11.6l-2 1.2V22.2z" fill="#94a3b8" opacity="0.75"/>
      <path d="M28.6 22.2l-2 .6v11.6l2 1.2V22.2z" fill="#94a3b8" opacity="0.75"/>
      <!-- rear window -->
      <path d="M13.8 35.6c4.1.9 8.3.9 12.4 0l1 4.4c-4.8 1.3-9.6 1.3-14.4 0l1-4.4z" fill="url(#${id}-glass)" opacity="0.85"/>
      <!-- mirrors -->
      <path d="M9.6 16.2l-2.6.8c-.6.2-.8.8-.5 1.3l.6.9 2.5-.6V16.2z" fill="${body[0]}"/>
      <path d="M30.4 16.2l2.6.8c.6.2.8.8.5 1.3l-.6.9-2.5-.6V16.2z" fill="${body[0]}"/>
      <!-- headlights -->
      <path d="M13.2 5.6c.8-1 1.8-1.4 3-1.4l-.6 2.6-2.8.4.4-1.6z" fill="#fefce8"/>
      <path d="M26.8 5.6c-.8-1-1.8-1.4-3-1.4l.6 2.6 2.8.4-.4-1.6z" fill="#fefce8"/>
      <!-- taillights -->
      <rect x="11" y="43.2" width="5" height="1.6" rx=".8" fill="#ef4444"/>
      <rect x="24" y="43.2" width="5" height="1.6" rx=".8" fill="#ef4444"/>
      ${
        bot
          ? `<!-- roof sensor (robotaxi lidar) -->
      <circle cx="20" cy="28.2" r="3.5" fill="#0f172a" opacity="0.55"/>
      <circle cx="20" cy="28.2" r="2.7" fill="url(#${id}-sensor)"/>
      <circle cx="19.2" cy="27.4" r=".8" fill="#fff" opacity="0.9"/>`
          : ""
      }
    </svg>`;
}

function liveCarIcon(variant) {
  const bot = variant === "bot";
  return divIcon(
    `
    <div class="sg-live-car${bot ? " sg-live-car--bot" : ""}">
      ${bot ? '<span class="sg-live-car__halo"></span>' : ""}
      <div class="sg-live-car__shadow"></div>
      <div class="sg-live-car__body">${liveCarSvg(variant)}</div>
      ${bot ? '<span class="sg-live-car__badge" title="ShipGoods demo bot">🤖</span>' : ""}
    </div>`,
    [56, 56],
    [28, 28]
  );
}

export const liveDriverIcon = liveCarIcon("standard");
export const liveBotIcon = liveCarIcon("bot");

/** @deprecated use liveDriverIcon + CSS rotation */
export function getMovingDriverIcon() {
  return liveDriverIcon;
}

export const currentLocationIcon = divIcon(currentSvg, [28, 28], [14, 14]);

// Dark route with a white casing reads cleanly on the light basemap.
export const ROUTE_LINE_STYLES = [
  { color: "#ffffff", opacity: 1, weight: 9, lineCap: "round", lineJoin: "round" },
  { color: "#111827", opacity: 0.92, weight: 5, lineCap: "round", lineJoin: "round" },
];
export const BOT_ROUTE_LINE_STYLES = [
  { color: "#ffffff", opacity: 1, weight: 9, lineCap: "round", lineJoin: "round" },
  { color: "#7c3aed", opacity: 0.95, weight: 5, lineCap: "round", lineJoin: "round" },
];

// CARTO Voyager: light, low-noise basemap (OSM data, free with attribution).
export const MAP_TILE = {
  url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

export const DEFAULT_CENTER = [28.6654, 77.4391];
export const CURRENT_LOCATION_ZOOM = 15;

export const INDIA_BOUNDS = [
  [6.5, 68.0],
  [35.7, 97.5],
];

export const isInIndia = (lat, lng) =>
  lat >= 6.5 && lat <= 35.7 && lng >= 68.0 && lng <= 97.5;
