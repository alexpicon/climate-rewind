"use client";

import { useEffect } from "react";
import { isPlaced, markPlaced, syncPadding, unlockCamera } from "@/lib/ui/camera";
import { useMapApi } from "./map-context";

/** For views with no animation (or no data): unlock the camera and rest the map on the address, clear of the panel. */
export function useRestOnAddress(lat: number, lon: number, zoom = 9.5, enabled = true): void {
  const api = useMapApi();

  useEffect(() => {
    if (!api || !enabled) return;
    const { map } = api;
    unlockCamera(map);
    syncPadding(map);
    const target = { center: [lon, lat] as [number, number], zoom };
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
  }, [api, lat, lon, zoom, enabled]);
}
