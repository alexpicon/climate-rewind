"use client";

import { useEffect, useRef } from "react";
import type { GeoJSONSource, LngLatBoundsLike, Marker } from "maplibre-gl";
import { NO_FEATURES, type Features } from "@/lib/features";
import { cameraFor, cameraPadding, isPlaced, markPlaced, unlockCamera } from "@/lib/ui/camera";
import { el } from "@/lib/ui/dom";
import { LABELS_LAYER } from "@/lib/ui/map-style";
import { useMapApi } from "./map-context";

export { NO_FEATURES, type Features };

export interface OverlayLayer {
  id: string;
  type: "fill" | "line" | "circle";
  paint: Record<string, unknown>;
  layout?: Record<string, unknown>;
  filter?: unknown[];
}

/**
 * One GeoJSON source and its layers on the shared map, drawn under the place labels. The layers are added when the map is ready and
 * removed when the view goes away; changing `data` only swaps the source's data (so a highlight does not rebuild anything).
 * `layers` must be a constant (a module-level array).
 */
export function useGeoOverlay(sourceId: string, data: Features | null, layers: readonly OverlayLayer[]): void {
  const api = useMapApi();
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    if (!api) return;
    const { map } = api;
    map.addSource(sourceId, { type: "geojson", data: (latest.current ?? NO_FEATURES) as never });
    for (const layer of layers) {
      map.addLayer({ ...layer, source: sourceId } as never, map.getLayer(LABELS_LAYER) ? LABELS_LAYER : undefined);
    }
    return () => {
      try {
        for (const layer of layers) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // the map was torn down with the page
      }
    };
  }, [api, sourceId, layers]);

  useEffect(() => {
    if (!api) return;
    (api.map.getSource(sourceId) as GeoJSONSource | undefined)?.setData((data ?? NO_FEATURES) as never);
  }, [api, sourceId, data]);
}

export interface Pin {
  id: string;
  lon: number;
  lat: number;
  /** The accessible name and the hover text, in words. */
  label: string;
  /** What the pin shows (a number or a short mark). */
  text: string;
  color: string;
  active?: boolean;
  dim?: boolean;
}

/**
 * Clickable pins as real buttons (keyboard and screen reader reachable), kept by id so changing which one is active updates it in place
 * and never loses the focus. `onSelect` may change on every render.
 */
export function useMapPins(pins: readonly Pin[], onSelect: (id: string) => void): void {
  const api = useMapApi();
  const live = useRef(new Map<string, { marker: Marker; node: HTMLButtonElement }>());
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!api) return;
    const have = live.current;
    const wanted = new Set(pins.map((p) => p.id));
    for (const [id, entry] of have) {
      if (!wanted.has(id)) {
        entry.marker.remove();
        have.delete(id);
      }
    }
    for (const pin of pins) {
      let entry = have.get(pin.id);
      if (!entry) {
        const node = el("button", { className: "ovpin", attrs: { type: "button" } }, [el("span", { className: "ovtx" })]);
        node.addEventListener("click", () => select.current(pin.id));
        const marker = new api.gl.Marker({ element: node, anchor: "center" }).setLngLat([pin.lon, pin.lat]).addTo(api.map);
        entry = { marker, node };
        have.set(pin.id, entry);
      }
      entry.marker.setLngLat([pin.lon, pin.lat]);
      entry.node.setAttribute("aria-label", pin.label);
      entry.node.title = pin.label;
      entry.node.style.setProperty("--c", pin.color);
      entry.node.classList.toggle("on", Boolean(pin.active));
      entry.node.classList.toggle("dim", Boolean(pin.dim));
      (entry.node.firstChild as HTMLElement).textContent = pin.text;
      entry.node.classList.toggle("long", pin.text.length > 2);
    }
  }, [api, pins]);

  useEffect(
    () => () => {
      for (const { marker } of live.current.values()) marker.remove();
      live.current.clear();
    },
    [api],
  );
}

/**
 * For the views that rest on the map without an animation: put the camera on the address, or on a box around the data when there is one
 * (clear of the panel). The first camera of a page load is a jump; later ones ease.
 */
export function useFitOnArea(lat: number, lon: number, zoom: number, bounds: LngLatBoundsLike | null = null, maxZoom = 12): void {
  const api = useMapApi();
  const key = bounds ? JSON.stringify(bounds) : "";
  useEffect(() => {
    if (!api) return;
    const { map } = api;
    unlockCamera(map);
    const padding = cameraPadding(true);
    const fit = bounds ? cameraFor(map, bounds, { padding, maxZoom }) : null;
    const target = fit ? { center: fit.center, zoom: fit.zoom, padding: { top: 0, bottom: 0, left: 0, right: 0 } } : { center: [lon, lat] as [number, number], zoom, padding };
    if (isPlaced(map)) {
      map.easeTo({ ...target, duration: 1400, essential: false });
    } else {
      map.jumpTo(target);
      markPlaced(map);
    }
    return () => {
      map.stop();
    };
    // `bounds` is read through its key so a new array with the same corners does not move the camera again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, lat, lon, zoom, key, maxZoom]);
}

/** A box [west, south], [east, north] this many degrees around a point. */
export function boxAround(lat: number, lon: number, dLat: number, dLon: number): [[number, number], [number, number]] {
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat + dLat],
  ];
}

/** A small non-interactive label on the map (decorative: the same words are in the caption), anchored at a point. */
export function useMapLabel(lon: number | null, lat: number | null, text: string | null, anchor: "top" | "bottom" = "bottom"): void {
  const api = useMapApi();
  useEffect(() => {
    if (!api || lon === null || lat === null || !text) return;
    const node = el("div", { className: "ovlabel", text, attrs: { "aria-hidden": "true" } });
    const marker = new api.gl.Marker({ element: node, anchor }).setLngLat([lon, lat]).addTo(api.map);
    return () => {
      marker.remove();
    };
  }, [api, lon, lat, text, anchor]);
}

/** km as degrees at a latitude: [dLat, dLon]. */
export function kmToDegrees(km: number, lat: number): [number, number] {
  return [km / 111.195, km / (111.195 * Math.cos((lat * Math.PI) / 180))];
}

/** A square of `km` on a side around a point, as a GeoJSON polygon ring ([lon, lat]). */
export function squareAround(lat: number, lon: number, km: number): number[][] {
  const [dLat, dLon] = kmToDegrees(km / 2, lat);
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}

/** Grows [west, south, east, north] to hold every [lon, lat] inside a GeoJSON coordinates value. Start from [180, 90, -180, -90] for "empty". */
export function growBox(coords: unknown, box: [number, number, number, number]): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    box[0] = Math.min(box[0], coords[0]);
    box[1] = Math.min(box[1], coords[1]);
    box[2] = Math.max(box[2], coords[0]);
    box[3] = Math.max(box[3], coords[1]);
    return;
  }
  for (const part of coords) growBox(part, box);
}

/** Do two [west, south, east, north] boxes overlap? */
export function boxesTouch(a: readonly number[], b: readonly number[]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
