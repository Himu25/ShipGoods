import L from "leaflet";

/*
 * Marker art for every ShipGoods map. Everything is inline SVG inside a
 * Leaflet divIcon, so markers stay crisp at any zoom and need no image
 * assets. "3D" comes from shading, not WebGL: cylindrical gradients on
 * the bodies, glass and gloss highlights, and a drop shadow cast by a
 * fixed light source (the wrapper casts it, so it doesn't spin with the
 * vehicle). Styling lives in components/map/map.css.
 */

function divIcon(html, size, anchor, className = "sg-marker") {
  return L.divIcon({
    className,
    html,
    iconSize: size,
    iconAnchor: anchor,
    popupAnchor: [0, -anchor[1] + 6],
  });
}

const sideShade = (id, edge, mid, hi, x1, x2) => `
  <linearGradient id="${id}" x1="${x1}" y1="0" x2="${x2}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${edge}"/>
    <stop offset="0.28" stop-color="${mid}"/>
    <stop offset="0.5" stop-color="${hi}"/>
    <stop offset="0.72" stop-color="${mid}"/>
    <stop offset="1" stop-color="${edge}"/>
  </linearGradient>`;

const glass = (id) => `
  <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1e293b"/>
    <stop offset="1" stop-color="#64748b"/>
  </linearGradient>`;

// ── Location pins ──────────────────────────────────────────────────────

const PIN_PATH =
  "M22 2C11.5 2 3 10.3 3 20.6c0 13.4 15.6 29.3 17.6 31.3a2 2 0 0 0 2.8 0C25.4 49.9 41 34 41 20.6 41 10.3 32.5 2 22 2z";

function pinIcon(kind, [light, base, dark], label) {
  const id = `sg-pin-${kind}`;
  const svg = `
    <svg width="44" height="58" viewBox="0 0 44 58" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${id}-body" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stop-color="${light}"/>
          <stop offset="0.55" stop-color="${base}"/>
          <stop offset="1" stop-color="${dark}"/>
        </linearGradient>
        <radialGradient id="${id}-gloss" cx="0.34" cy="0.22" r="0.55">
          <stop offset="0" stop-color="#fff" stop-opacity="0.6"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="${id}-disk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset="1" stop-color="#e2e8f0"/>
        </linearGradient>
      </defs>
      <path d="${PIN_PATH}" fill="url(#${id}-body)"/>
      <path d="${PIN_PATH}" fill="url(#${id}-gloss)"/>
      <path d="${PIN_PATH}" fill="none" stroke="${dark}" stroke-opacity="0.55" stroke-width="1"/>
      <circle cx="22" cy="21.6" r="10.6" fill="#000" fill-opacity="0.2"/>
      <circle cx="22" cy="20.6" r="10.2" fill="url(#${id}-disk)"/>
      <text x="22" y="25" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif"
        font-size="13" font-weight="800" fill="${dark}">${label}</text>
    </svg>`;
  return divIcon(
    `<div class="sg-pin">
      <span class="sg-pin__shadow"></span>
      <div class="sg-pin__body">${svg}</div>
    </div>`,
    [44, 58],
    [22, 55]
  );
}

export const pickupIcon = pinIcon("a", ["#6ee7b7", "#10b981", "#047857"], "A");
export const dropoffIcon = pinIcon("b", ["#fda4af", "#f43f5e", "#be123c"], "B");

export const currentLocationIcon = divIcon(
  `<div class="sg-me">
    <span class="sg-me__pulse"></span>
    <span class="sg-me__dot"></span>
  </div>`,
  [36, 36],
  [18, 18]
);

// ── Vehicles (top-down, nose pointing north) ───────────────────────────

const CAR_BODY =
  "M9 3.2C12 1.6 20 1.6 23 3.2c3.6 1.8 5.2 5.8 5.8 10.8l.6 7v25c0 5.2-2.8 8.2-7.9 8.6h-11C5.4 54.2 2.6 51.2 2.6 46V21l.6-7C3.8 9 5.4 5 9 3.2z";

const CAR_PAINT = {
  graphite: { edge: "#07090d", mid: "#262b36", hi: "#4b5363", roof: "#1a1e27" },
  violet: { edge: "#2e1065", mid: "#6d28d9", hi: "#a78bfa", roof: "#4c1d95" },
};

function carSvg(paint, w, h) {
  const p = CAR_PAINT[paint];
  const id = `sg-car-${paint}`;
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 32 56" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${sideShade(`${id}-body`, p.edge, p.mid, p.hi, 2.6, 29.4)}
        ${sideShade(`${id}-roof`, p.roof, p.mid, p.hi, 7.8, 24.2)}
        ${glass(`${id}-glass`)}
      </defs>
      <path d="M2.8 17.2.6 18.2c-.5.3-.5 1.1 0 1.4l2.2 1zM29.2 17.2l2.2 1c.5.3.5 1.1 0 1.4l-2.2 1z" fill="${p.edge}"/>
      <path d="${CAR_BODY}" fill="url(#${id}-body)"/>
      <path d="M11 5c3-1 7-1 10 0l-1 8h-8z" fill="#fff" opacity="0.1"/>
      <path d="M5.6 16.5c6.4-2.9 14.4-2.9 20.8 0l-2.2 8.1c-5.4-1.6-11-1.6-16.4 0z" fill="url(#${id}-glass)"/>
      <path d="M9 17.6l4-1.8-1.4 7.6-2.4.6z" fill="#fff" opacity="0.22"/>
      <path d="M4 20l2.8 3.4V42l-2.4 3zM28 20l-2.8 3.4V42l2.4 3z" fill="url(#${id}-glass)" opacity="0.85"/>
      <rect x="7.8" y="24.6" width="16.4" height="16.6" rx="3.6" fill="url(#${id}-roof)"/>
      <rect x="9.6" y="26" width="5" height="13.6" rx="2.4" fill="#fff" opacity="0.1"/>
      <path d="M7.8 41.2c5.4 1.4 11 1.4 16.4 0l1.4 5.8c-6.2 1.8-13 1.8-19.2 0z" fill="url(#${id}-glass)" opacity="0.9"/>
      <path d="M5.4 6.6c1-1.6 2.4-2.6 4.2-3l-.6 3.2-3.8 1.6zM26.6 6.6c-1-1.6-2.4-2.6-4.2-3l.6 3.2 3.8 1.6z" fill="#fffbeb"/>
      <path d="M4.2 50.4l5.2 2-.2 1.6c-2.6-.3-4.2-1.4-5-3.6zM27.8 50.4l-5.2 2 .2 1.6c2.6-.3 4.2-1.4 5-3.6z" fill="#ef4444"/>
      <path d="${CAR_BODY}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="0.6"/>
    </svg>`;
}

function truckSvg(w, h) {
  const id = "sg-truck";
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 34 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${sideShade(`${id}-cab`, "#172554", "#1d4ed8", "#60a5fa", 4, 30)}
        ${sideShade(`${id}-box`, "#94a3b8", "#e2e8f0", "#ffffff", 2.5, 31.5)}
        ${glass(`${id}-glass`)}
      </defs>
      <rect x="1.6" y="7" width="3" height="4" rx="1" fill="#172554"/>
      <rect x="29.4" y="7" width="3" height="4" rx="1" fill="#172554"/>
      <rect x="4" y="2" width="26" height="18" rx="5" fill="url(#${id}-cab)"/>
      <path d="M6.5 5.5c6.5-1.9 14.5-1.9 21 0L26 11c-6-1.2-12-1.2-18 0z" fill="url(#${id}-glass)"/>
      <rect x="7" y="12" width="20" height="6" rx="2" fill="#fff" opacity="0.12"/>
      <path d="M5.6 3.6l2.6-.8-.4 2-2.4 1zM28.4 3.6l-2.6-.8.4 2 2.4 1z" fill="#fffbeb"/>
      <rect x="9" y="19.5" width="16" height="2.5" fill="#0f172a"/>
      <rect x="2.5" y="21.5" width="29" height="41" rx="3" fill="url(#${id}-box)"/>
      <rect x="14.5" y="23.5" width="5" height="37" rx="1.5" fill="#2563eb" opacity="0.9"/>
      <path d="M3.5 28h27M3.5 34h27M3.5 40h27M3.5 46h27M3.5 52h27M3.5 58h27" stroke="#0f172a" stroke-opacity="0.08"/>
      <rect x="4" y="60" width="5" height="1.6" rx=".8" fill="#ef4444"/>
      <rect x="25" y="60" width="5" height="1.6" rx=".8" fill="#ef4444"/>
      <rect x="2.5" y="21.5" width="29" height="41" rx="3" fill="none" stroke="#000" stroke-opacity="0.28" stroke-width="0.6"/>
    </svg>`;
}

function busSvg(w, h) {
  const id = "sg-bus";
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 30 72" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${sideShade(`${id}-body`, "#9a3412", "#ea580c", "#fdba74", 2, 28)}
        ${glass(`${id}-glass`)}
      </defs>
      <rect x="2" y="2" width="26" height="68" rx="6" fill="url(#${id}-body)"/>
      <path d="M4.5 6c6.5-2.4 14.5-2.4 21 0l-1 5c-6.5-1.4-12.5-1.4-19 0z" fill="url(#${id}-glass)"/>
      <rect x="2.6" y="13" width="2.4" height="51" rx="1" fill="url(#${id}-glass)" opacity="0.85"/>
      <rect x="25" y="13" width="2.4" height="51" rx="1" fill="url(#${id}-glass)" opacity="0.85"/>
      <rect x="6" y="13" width="18" height="53" rx="3" fill="#fff" opacity="0.16"/>
      <rect x="9" y="22" width="12" height="8" rx="2" fill="#f1f5f9"/>
      <rect x="9" y="44" width="12" height="8" rx="2" fill="#f1f5f9"/>
      <path d="M4.6 3.8l2.4-.9-.2 2.2-2.4.9zM25.4 3.8L23 2.9l.2 2.2 2.4.9z" fill="#fffbeb"/>
      <rect x="4" y="67.4" width="5" height="1.6" rx=".8" fill="#ef4444"/>
      <rect x="21" y="67.4" width="5" height="1.6" rx=".8" fill="#ef4444"/>
      <rect x="2" y="2" width="26" height="68" rx="6" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="0.6"/>
    </svg>`;
}

function bikeSvg(w, h) {
  const id = "sg-bike";
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 20 46" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${sideShade(`${id}-jacket`, "#0f172a", "#1e40af", "#3b82f6", 2.5, 17.5)}
        <radialGradient id="${id}-helmet" cx="0.38" cy="0.32" r="0.7">
          <stop offset="0" stop-color="#fecaca"/>
          <stop offset="0.35" stop-color="#ef4444"/>
          <stop offset="1" stop-color="#7f1d1d"/>
        </radialGradient>
      </defs>
      <rect x="8" y="1" width="4" height="10" rx="2" fill="#111827"/>
      <rect x="8" y="34" width="4" height="11" rx="2" fill="#111827"/>
      <ellipse cx="10" cy="23" rx="4.5" ry="12" fill="#1f2937"/>
      <rect x="1" y="11" width="18" height="2.4" rx="1.2" fill="#374151"/>
      <path d="M3.6 22L2.6 13M16.4 22l1-9" stroke="#1e3a8a" stroke-width="2.4" stroke-linecap="round"/>
      <ellipse cx="10" cy="25" rx="7.5" ry="4.8" fill="url(#${id}-jacket)"/>
      <circle cx="10" cy="21.5" r="4.6" fill="url(#${id}-helmet)"/>
      <circle cx="10" cy="1.6" r="1.2" fill="#fffbeb"/>
    </svg>`;
}

const VEHICLE_ART = {
  car: () => carSvg("graphite", 24, 42),
  truck: () => truckSvg(26, 49),
  bus: () => busSvg(22, 53),
  motorcycle: () => bikeSvg(15, 34),
};

const BOT_BADGE = `
  <span class="sg-veh__badge" title="ShipGoods demo bot">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.5v3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      <circle cx="12" cy="2.5" r="1.6" fill="#fff"/>
      <rect x="4" y="6.5" width="16" height="12" rx="4" fill="#fff"/>
      <circle cx="9" cy="12.5" r="1.8" fill="#6d28d9"/>
      <circle cx="15" cy="12.5" r="1.8" fill="#6d28d9"/>
      <path d="M2 11v4M22 11v4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </span>`;

/** Vehicle markers are square so rotation never clips; --h spins the body. */
function vehicleIcon({ art, heading = 0, live = false, bot = false }) {
  const size = live ? 64 : 56;
  return divIcon(
    `<div class="sg-veh${live ? " sg-veh--live" : ""}${bot ? " sg-veh--bot" : ""}" style="--h:${heading}deg">
      ${bot ? '<span class="sg-veh__halo"></span>' : ""}
      <div class="sg-veh__body">${art}</div>
      ${bot ? BOT_BADGE : ""}
    </div>`,
    [size, size],
    [size / 2, size / 2],
    "sg-marker sg-marker--vehicle"
  );
}

const HEADING_STEP = 15;
const vehicleIconCache = new Map();

/**
 * Static vehicle marker (e.g. nearby drivers). Headings are bucketed to
 * 15° so icons can be cached and reused instead of rebuilt per render.
 */
export function getVehicleIcon(type, heading = 0) {
  const kind = VEHICLE_ART[type] ? type : "car";
  const bucket = (Math.round(heading / HEADING_STEP) * HEADING_STEP) % 360;
  const key = `${kind}:${bucket}`;
  if (!vehicleIconCache.has(key)) {
    vehicleIconCache.set(key, vehicleIcon({ art: VEHICLE_ART[kind](), heading: bucket }));
  }
  return vehicleIconCache.get(key);
}

/** Live (animated) markers; SmoothMarker drives --h on `.sg-veh`. */
export const liveDriverIcon = vehicleIcon({ art: carSvg("graphite", 28, 49), live: true });
export const liveBotIcon = vehicleIcon({ art: carSvg("violet", 28, 49), live: true, bot: true });

// ── Routes ─────────────────────────────────────────────────────────────

const line = (color, weight, opacity = 1) => ({
  color,
  weight,
  opacity,
  lineCap: "round",
  lineJoin: "round",
  interactive: false,
});

// Soft ground shadow, white casing, then the coloured core.
export const ROUTE_LINE_STYLES = [
  line("#0f172a", 13, 0.12),
  line("#ffffff", 9),
  line("#2563eb", 5),
];
export const BOT_ROUTE_LINE_STYLES = [
  line("#2e1065", 13, 0.12),
  line("#ffffff", 9),
  line("#7c3aed", 5),
];

// ── Map extents ────────────────────────────────────────────────────────

export const DEFAULT_CENTER = [28.6654, 77.4391];
export const CURRENT_LOCATION_ZOOM = 15;

export const INDIA_BOUNDS = [
  [6.5, 68.0],
  [35.7, 97.5],
];

export const isInIndia = (lat, lng) =>
  lat >= 6.5 && lat <= 35.7 && lng >= 68.0 && lng <= 97.5;
