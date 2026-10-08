"use client";

import { useEffect } from "react";
import { cameraPadding, isPlaced, markPlaced, unlockCamera } from "@/lib/ui/camera";
import { useMapApi } from "./map-context";

/** For views with no animation (or no data): unlock the camera and rest the map on the address, clear of the panel. */
export function useRestOnAddress(lat: number, lon: number, zoom = 9.5): void {
  const api = useMapApi();

  useEffect(() => {
    if (!api) return;
    const { map } = api;
    unlockCamera(map);
    const target = { center: [lon, lat] as [number, number], zoom, padding: cameraPadding() };
    if (isPlaced(map)) {
      map.easeTo({ ...target, duration: 1500, essential: false });
    } else {
      // The first camera of a page load is a jump: the map is still hidden and must never be seen flying in from the world view.
      map.jumpTo(target);
      markPlaced(map);
    }
    return () => {
      map.stop();
    };
  }, [api, lat, lon, zoom]);
}
