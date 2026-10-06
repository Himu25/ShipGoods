"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

/**
 * One-time size sync for Leaflet in flex layouts.
 * Avoid ResizeObserver loops — invalidateSize in a loop makes the map "float".
 */
export default function MapResizeFix() {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const invalidate = () => {
      try {
        map.invalidateSize({ animate: false });
      } catch {
        /* ignore */
      }
    };

    invalidate();
    const t1 = setTimeout(invalidate, 150);
    const t2 = setTimeout(invalidate, 500);

    const onResize = () => {
      clearTimeout(onResize._t);
      onResize._t = setTimeout(invalidate, 200);
    };
    window.addEventListener("resize", onResize);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(onResize._t);
      window.removeEventListener("resize", onResize);
    };
  }, [map]);

  return null;
}
