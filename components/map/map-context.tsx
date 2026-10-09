"use client";

import { createContext, useContext } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import type { MapLibre } from "@/lib/ui/maplibre";

export type { MapLibre };

export interface MapApi {
  map: MapLibreMap;
  gl: MapLibre;
}

export const MapContext = createContext<MapApi | null>(null);

/** True when the map cannot be drawn at all (no WebGL): views stop waiting for it and run from the panel alone. */
export const MapUnavailableContext = createContext(false);

/** The shared map, or null until it has loaded. Views draw their panels immediately and add map layers once this is set. */
export function useMapApi(): MapApi | null {
  return useContext(MapContext);
}

/** The map will never load in this browser (no WebGL). Anything that waits on the map should stop waiting. */
export function useMapUnavailable(): boolean {
  return useContext(MapUnavailableContext);
}
