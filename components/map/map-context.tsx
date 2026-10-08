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

/** The shared map, or null until it has loaded. Views draw their panels immediately and add map layers once this is set. */
export function useMapApi(): MapApi | null {
  return useContext(MapContext);
}
