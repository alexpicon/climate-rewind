"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { onPlaced, watchPadding } from "@/lib/ui/camera";
import { createAddressMarkerElement } from "@/lib/ui/dom";
import { loadMapLibre } from "@/lib/ui/maplibre";
import { baseStyle } from "@/lib/ui/map-style";
import { MapContext, MapUnavailableContext, type MapApi } from "./map-context";

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
  const creditsRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<MapApi | null>(null);
  const [tileTrouble, setTileTrouble] = useState(false);
  // No WebGL (switched off, blocklisted GPU, some remote desktops): MapLibre cannot start. The panels hold the same information.
  const [unavailable, setUnavailable] = useState(false);
  // The map starts on a placeholder world view while the lookup runs. It stays hidden until a view has put the camera on its
  // data (never a flight in from the whole country), then fades in.
  const [placed, setPlaced] = useState(false);
  const addressMarker = useRef<Marker | null>(null);
  // Before the lookup finishes the map shows the whole country; each view then flies in to the address.
  const startRef = useRef<[number, number]>(address ? [address.lon, address.lat] : [-96, 38]);

  useEffect(() => {
    let map: MapLibreMap | null = null;
    let attribution: { onRemove(): void } | null = null;
    let stopPadding: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const gl = await loadMapLibre();
      if (cancelled || !containerRef.current) return;

      try {
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
      } catch (error) {
        console.error("map unavailable", (error as Error | null)?.name);
        setUnavailable(true);
        return;
      }
      // The credits button lives in #map-credits, outside #map: the map is one fixed layer under every panel, so a control inside it
      // is covered by the panel and the tab bar on a phone and cannot be reached. (It is the same MapLibre control, mounted by hand.)
      const credits = new gl.AttributionControl({ compact: true });
      attribution = credits;
      const creditsEl = credits.onAdd(map);
      if (creditsRef.current) creditsRef.current.appendChild(creditsEl);
      // MapLibre opens the credits text at first. On a phone it would sit over the panel, so there it starts as the small button.
      const collapseOnPhone = () => {
        if (!window.matchMedia("(max-width: 900px)").matches) return;
        creditsEl.removeAttribute("open");
        creditsEl.classList.remove("maplibregl-compact-show");
      };
      collapseOnPhone();
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
        collapseOnPhone();
        // Keep the map's padding on the real UI (panel, top bar, dock), so every camera lands in the visible area.
        stopPadding = watchPadding(map);
        setApi({ map, gl });
      });
    })();

    return () => {
      cancelled = true;
      try {
        attribution?.onRemove();
      } catch {
        // the control was never mounted
      }
      attribution = null;
      stopPadding?.();
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
      <div id="map-credits" className="maplibregl-ctrl-bottom-right" role="region" aria-label="Map credits" ref={creditsRef} />
      {unavailable ? (
        <p id="map-off" className="glass" role="status">
          <b>The map can’t be drawn in this browser.</b> It needs WebGL, which is switched off or not supported here. Every number, story and
          replay is still in the panel, with a text version.
        </p>
      ) : null}
      {tileTrouble ? (
        <p id="toast" className="on" role="status">
          Some map tiles did not load. Check your connection; the data still works.
        </p>
      ) : null}
      <MapUnavailableContext.Provider value={unavailable}>
        <MapContext.Provider value={api}>{children}</MapContext.Provider>
      </MapUnavailableContext.Provider>
    </>
  );
}
