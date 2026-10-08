"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { onPlaced } from "@/lib/ui/camera";
import { createAddressMarkerElement } from "@/lib/ui/dom";
import { loadMapLibre } from "@/lib/ui/maplibre";
import { baseStyle } from "@/lib/ui/map-style";
import { MapContext, type MapApi } from "./map-context";

interface Props {
  /** The matched address, or null while the lookup is running. */
  address: { lat: number; lon: number; matched: string } | null;
  reducedMotion: boolean;
  children: ReactNode;
}

/**
 * The one full-bleed map. Views are children and render at once; they read the map with
 * useMapApi() and add and remove their own layers, markers and camera locks when it is ready.
 */
export function MapCanvas({ address, reducedMotion, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<MapApi | null>(null);
  const [tileTrouble, setTileTrouble] = useState(false);
  // The map starts on a placeholder world view while the lookup runs. It stays hidden until a view has put the camera on its
  // data (never a flight in from the whole country), then fades in.
  const [placed, setPlaced] = useState(false);
  const addressMarker = useRef<Marker | null>(null);
  // Before the lookup finishes the map shows the whole country; each view then flies in to the address.
  const startRef = useRef<[number, number]>(address ? [address.lon, address.lat] : [-96, 38]);

  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;

    (async () => {
      const gl = await loadMapLibre();
      if (cancelled || !containerRef.current) return;

      map = new gl.Map({
        container: containerRef.current,
        style: baseStyle(),
        center: startRef.current,
        zoom: 4,
        minZoom: 3,
        maxZoom: 14,
        attributionControl: false,
        fadeDuration: 0,
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 0,
      });
      map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
      map.touchZoomRotate.disableRotation();

      // Markers only follow "move" events; a clamped camera moves without one. Re-sync them.
      let cameraKey = "";
      map.on("render", () => {
        if (!map) return;
        const c = map.getCenter();
        const key = `${c.lng.toFixed(6)},${c.lat.toFixed(6)},${map.getZoom().toFixed(4)}`;
        if (key !== cameraKey) {
          cameraKey = key;
          map.fire("move");
        }
      });

      let errors = 0;
      map.on("error", (event) => {
        // Radar frames are fetched by the storm view, which reports its own failures.
        if ((event as { sourceId?: string }).sourceId?.startsWith("rad")) return;
        errors += 1;
        if (errors === 4) setTileTrouble(true);
      });

      onPlaced(map, () => {
        if (!cancelled) setPlaced(true);
      });

      map.on("load", () => {
        if (cancelled || !map) return;
        // Read-only handle for the browser tests (camera, pitch, terrain). Nothing in the app reads it.
        (window as unknown as { __memoriaMap?: MapLibreMap }).__memoriaMap = map;
        setApi({ map, gl });
      });
    })();

    return () => {
      cancelled = true;
      addressMarker.current?.remove();
      addressMarker.current = null;
      map?.remove();
      setApi(null);
    };
  }, []);

  // Failsafe: if no view ever places the camera (it should not happen), show the map anyway once the data is here.
  const hasAddress = Boolean(address);
  useEffect(() => {
    if (!api || !hasAddress || placed) return;
    const timer = setTimeout(() => setPlaced(true), 6000);
    return () => clearTimeout(timer);
  }, [api, hasAddress, placed]);

  // The house marker: exactly one element, on every tab, re-created if the address changes.
  const lat = address?.lat;
  const lon = address?.lon;
  const matched = address?.matched;
  useEffect(() => {
    if (!api || lat === undefined || lon === undefined || !matched) return;
    const element = createAddressMarkerElement(matched);
    if (reducedMotion) element.classList.add("still");
    const marker = new api.gl.Marker({ element, anchor: "center" }).setLngLat([lon, lat]).addTo(api.map);
    addressMarker.current = marker;
    return () => {
      marker.remove();
    };
  }, [api, lat, lon, matched, reducedMotion]);

  return (
    <>
      <div
        id="map"
        className={placed ? undefined : "pending"}
        ref={containerRef}
        role="application"
        aria-label={`Interactive weather map${matched ? ` around ${matched}` : ""}. The panel and the text versions hold the same information.`}
      />
      <div id="vignette" aria-hidden="true" />
      {tileTrouble ? (
        <p id="toast" className="on" role="status">
          Some map tiles did not load. Check your connection; the data still works.
        </p>
      ) : null}
      <MapContext.Provider value={api}>{children}</MapContext.Provider>
    </>
  );
}
