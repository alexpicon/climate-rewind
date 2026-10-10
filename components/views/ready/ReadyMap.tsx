"use client";

import { useEffect, useMemo, useState } from "react";
import { MapCaption } from "@/components/map/MapCaption";
import { useMapApi } from "@/components/map/map-context";
import { boxAround, useFitOnArea, useGeoOverlay, useMapPins, type Features, type OverlayLayer, type Pin } from "@/components/map/use-map-overlay";
import type { AreaMap } from "@/lib/area-map";
import type { ReadyItem } from "@/lib/ready/types";
import { cameraFor } from "@/lib/ui/camera";

const LAYERS: readonly OverlayLayer[] = [{ id: "rd-track", type: "line", layout: { "line-cap": "round" }, paint: { "line-color": "#E59BFF", "line-width": 3, "line-opacity": 0.85 } }];

/** The plan items whose cited record has a place, and where: [item index, point]. Exported for the item list ("Show on map"). */
export interface ItemPoint {
  item: number;
  factId: string;
  label: string;
  lat: number;
  lon: number;
}

type Got = { status: "loading" } | { status: "ready"; map: AreaMap } | { status: "error" };

/** Fetches the map points for the records a plan cites. Quiet on failure: the plan is complete without the map. */
export function useItemPoints(state: string, items: readonly ReadyItem[]): { points: ItemPoint[]; got: Got["status"]; map: AreaMap | null } {
  const ids = useMemo(() => [...new Set(items.flatMap((item) => item.why.map((fact) => fact.id)))].slice(0, 80), [items]);
  const key = `${state}|${ids.join(",")}`;
  const [got, setGot] = useState<Got>({ status: "loading" });
  useEffect(() => {
    if (ids.length === 0) {
      setGot({ status: "ready", map: { features: [], points: [] } });
      return;
    }
    const controller = new AbortController();
    setGot({ status: "loading" });
    fetch(`/api/area-map?state=${state}&ids=${ids.join(",")}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<AreaMap>) : Promise.reject(new Error("bad"))))
      .then((map) => setGot({ status: "ready", map }))
      .catch(() => {
        if (!controller.signal.aborted) setGot({ status: "error" });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const map = got.status === "ready" ? got.map : null;
  const points = useMemo<ItemPoint[]>(() => {
    if (!map) return [];
    const where = new Map(map.points.map((p) => [p.id, p]));
    return items.flatMap((item, i) =>
      item.why.flatMap((fact) => {
        const p = where.get(fact.id);
        return p ? [{ item: i, factId: fact.id, label: fact.label, lat: p.lat, lon: p.lon }] : [];
      }),
    );
  }, [map, items]);
  return { points, got: got.status, map };
}

/**
 * The map under "Get ready": a numbered pin for each plan item whose cited record has a place on earth (a flood report or a tornado track).
 * A pin is a button that takes you to its item; "Show on map" on an item does the reverse. An item that cites a whole zone, a county or a
 * count has no pin, and the caption says how many do.
 */
export function ReadyMap({
  lat,
  lon,
  items,
  points,
  status,
  map,
  active,
  onPin,
}: {
  lat: number;
  lon: number;
  items: readonly ReadyItem[];
  points: readonly ItemPoint[];
  status: Got["status"];
  map: AreaMap | null;
  active: number | null;
  onPin: (item: number) => void;
}) {
  const api = useMapApi();
  const features = useMemo<Features>(() => ({ type: "FeatureCollection", features: (map?.features ?? []).filter((f) => f.properties.kind === "track" && points.some((p) => p.factId === f.properties.id)) }), [map, points]);
  useGeoOverlay("ready-tracks", features, LAYERS);

  const pins = useMemo<Pin[]>(
    () =>
      points.map((p) => ({
        id: `${p.item}|${p.factId}`,
        lat: p.lat,
        lon: p.lon,
        label: `Plan item ${p.item + 1}: ${items[p.item].action} The record behind it: ${p.label}.`,
        text: String(p.item + 1),
        color: "#FFB45A",
        active: active === p.item,
        dim: active !== null && active !== p.item,
      })),
    [points, items, active],
  );
  useMapPins(pins, (id) => onPin(Number(id.split("|")[0])));

  const bounds = useMemo<[[number, number], [number, number]]>(() => {
    if (points.length === 0) return boxAround(lat, lon, 0.12, 0.16);
    const lats = [lat, ...points.map((p) => p.lat)];
    const lons = [lon, ...points.map((p) => p.lon)];
    const pad = 0.02;
    return [
      [Math.min(...lons) - pad, Math.min(...lats) - pad],
      [Math.max(...lons) + pad, Math.max(...lats) + pad],
    ];
  }, [points, lat, lon]);
  useFitOnArea(lat, lon, 10, bounds, 12);

  // An item picked in the list: frame its pins and the address.
  useEffect(() => {
    if (!api || active === null) return;
    const mine = points.filter((p) => p.item === active);
    if (mine.length === 0) return;
    const lats = [lat, ...mine.map((p) => p.lat)];
    const lons = [lon, ...mine.map((p) => p.lon)];
    const cam = cameraFor(api.map, [[Math.min(...lons) - 0.01, Math.min(...lats) - 0.01], [Math.max(...lons) + 0.01, Math.max(...lats) + 0.01]], { maxZoom: 13 });
    if (cam) api.map.easeTo({ center: cam.center, zoom: cam.zoom, duration: 900, essential: false });
  }, [api, active, points, lat, lon]);

  const withPin = new Set(points.map((p) => p.item)).size;
  const summary =
    status === "loading"
      ? "Looking for the places behind the plan’s records…"
      : status === "error"
        ? "The map points are not available right now. The plan in the panel is complete without them."
        : items.length === 0
          ? "No plan items to place."
          : `${withPin} of the ${items.length} plan items cite a record with a place (numbered pins). The others cite a whole zone or county, or a count.`;

  return (
    <MapCaption
      title="Where the records behind your plan happened"
      summary={summary}
      keys={
        <ul className="mapcap-keys" aria-label="Key">
          <li style={{ "--c": "#FFB45A" } as React.CSSProperties}>
            <i className="dot" /> Plan item number: its flood report or tornado
          </li>
        </ul>
      }
      source="Pins: where the National Weather Service filed a flood report or a tornado track (NCEI Storm Events and Local Storm Reports); a report filed at a city centre is not pinned. Wind, snow, heat and hail records carry no coordinates, so those items have no pin."
    />
  );
}
