/*
 * ShipGoods basemap theme: OpenFreeMap's Liberty style, recoloured into a
 * calm, light palette so our pins, cars and route are the loudest things
 * on the map. Applied to the style JSON before the map first renders, so
 * the stock colours never flash.
 */

const LIBERTY_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

const COLORS = {
  land: "#ebeae6",
  residential: "rgba(226, 224, 218, 0.55)",
  building: "#dfddd6",
  building3d: "#dcd9d1",
  park: "#d7ebcd",
  wood: "rgba(196, 224, 182, 0.7)",
  water: "#b9d8f6",
  waterLine: "#a6cbef",
  casing: "#d6d2c8",
  road: "#ffffff",
  majorRoad: "#fff8e6",
  motorway: "#fbe2a6",
  motorwayCasing: "#efc77a",
  rail: "#cdd2d8",
  hospital: "#f6e5e9",
  school: "#eef0dc",
  label: "#4b5563",
  placeLabel: "#1f2937",
  waterLabel: "#4a6fa5",
  halo: "rgba(255, 255, 255, 0.92)",
};

// Bus stops and minor shops crowd the map at city zoom levels.
const HIDDEN = new Set(["poi_r20", "poi_r7", "poi_transit", "road_one_way_arrow", "road_one_way_arrow_opposite"]);

// [layer id pattern, paint overrides]; the first match wins.
const PAINT_RULES = [
  [/^background$/, { "background-color": COLORS.land }],
  [/^landuse_residential$/, { "fill-color": COLORS.residential }],
  [/^park$/, { "fill-color": COLORS.park }],
  [/^park_outline$/, { "line-color": COLORS.park }],
  [/^landcover_(wood|grass)$/, { "fill-color": COLORS.wood }],
  [/^landuse_(pitch|track|school)$/, { "fill-color": COLORS.school }],
  [/^landuse_hospital$/, { "fill-color": COLORS.hospital }],
  [/^water$/, { "fill-color": COLORS.water }],
  [/^waterway_/, { "line-color": COLORS.waterLine }],
  [/motorway.*casing$/, { "line-color": COLORS.motorwayCasing }],
  [/casing$/, { "line-color": COLORS.casing }],
  [/^(road|bridge|tunnel)_motorway(_link)?$/, { "line-color": COLORS.motorway }],
  [/^(road|bridge|tunnel)_trunk_primary$/, { "line-color": COLORS.majorRoad }],
  [/^(road|bridge|tunnel)_(link|secondary_tertiary|minor|street|service_track)$/, { "line-color": COLORS.road }],
  [/_rail(_hatching)?$/, { "line-color": COLORS.rail }],
  [/^building$/, { "fill-color": COLORS.building }],
  [/^building-3d$/, { "fill-extrusion-color": COLORS.building3d, "fill-extrusion-opacity": 0.75 }],
];

function themeLayer(layer) {
  if (HIDDEN.has(layer.id)) {
    return { ...layer, layout: { ...layer.layout, visibility: "none" } };
  }
  // Only apply properties that belong to this layer type (line-* on lines).
  const rule = PAINT_RULES.find(
    ([pattern, props]) =>
      pattern.test(layer.id) &&
      Object.keys(props).every((key) => key.startsWith(`${layer.type}-`))
  );
  let paint = rule ? { ...layer.paint, ...rule[1] } : layer.paint;

  if (layer.type === "symbol" && paint?.["text-color"]) {
    const color = layer.id.startsWith("water")
      ? COLORS.waterLabel
      : layer.id.startsWith("label_")
        ? COLORS.placeLabel
        : COLORS.label;
    paint = { ...paint, "text-color": color, "text-halo-color": COLORS.halo };
  }
  if (layer.id === "poi_r1") paint = { ...paint, "icon-opacity": 0.75 };
  return paint === layer.paint ? layer : { ...layer, paint };
}

let themedStyle = null;

/** Liberty with the ShipGoods palette; fetched once per page load. */
export function loadMapStyle() {
  if (!themedStyle) {
    themedStyle = fetch(LIBERTY_STYLE)
      .then((res) => {
        if (!res.ok) throw new Error(`Map style HTTP ${res.status}`);
        return res.json();
      })
      .then((style) => ({ ...style, layers: style.layers.map(themeLayer) }))
      .catch((err) => {
        themedStyle = null; // let a later map retry
        throw err;
      });
  }
  return themedStyle;
}
