"use client";

import { useEffect, useState } from "react";
import { lightningFileFor, type LightningIndex, type LightningNight } from "@/lib/ui/lightning";

/**
 * The satellite lightning for this address and storm night, when it was extracted ahead of time (the sample addresses' nights with
 * GOES coverage), else null. A missing or unreadable file only means no lightning layer.
 */
export function useLightning(lat: number, lon: number, nightId: string | null | undefined): LightningNight | null {
  const [night, setNight] = useState<{ key: string; data: LightningNight } | null>(null);
  const key = `${lat},${lon},${nightId ?? ""}`;

  useEffect(() => {
    if (!nightId) return;
    const controller = new AbortController();
    const get = <T,>(url: string) => fetch(url, { signal: controller.signal }).then((r) => (r.ok ? (r.json() as Promise<T>) : null));
    get<LightningIndex>("/data/lightning/index.json")
      .then((index) => {
        const file = index ? lightningFileFor(index, lat, lon, nightId) : null;
        return file ? get<LightningNight>(`/${file}`) : null;
      })
      .then((data) => {
        if (data) setNight({ key, data });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [key, lat, lon, nightId]);

  return night?.key === key ? night.data : null;
}
