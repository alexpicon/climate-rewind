"use client";

import { useEffect, useMemo, useState } from "react";
import { MapCaption } from "@/components/map/MapCaption";
import { useMapApi } from "@/components/map/map-context";
import { boxAround, growBox, useFitOnArea, useGeoOverlay, useMapPins, type Features, type OverlayLayer, type Pin } from "@/components/map/use-map-overlay";
import type { AreaMap } from "@/lib/area-map";
import type { AreaEvent, AreaEventsSummary } from "@/lib/types";
import { cameraFor } from "@/lib/ui/camera";
import { currentZone, eventLabel, FAMILIES, familyOf, zoneLabel } from "@/lib/ui/story-model";

const ZONE_NOW = "#FFB45A";
const ZONE_OTHER = "#7FD1FF";
const LAYERS: readonly OverlayLayer[] = [
  { id: "sm-zone-fill", type: "fill", filter: ["==", ["get", "k"], "zone"], paint: { "fill-color": ["case", ["==", ["get", "cur"], 1], ZONE_NOW, ZONE_OTHER], "fill-opacity": ["case", ["==", ["get", "hl"], 1], 0.3, ["==", ["get", "cur"], 1], 0.1, 0.05] } },
  { id: "sm-zone-now", type: "line", filter: ["all", ["==", ["get", "k"], "zone"], ["==", ["get", "cur"], 1]], paint: { "line-color": ZONE_NOW, "line-width": ["case", ["==", ["get", "hl"], 1], 3.5, 2.4] } },
  { id: "sm-zone-other", type: "line", filter: ["all", ["==", ["get", "k"], "zone"], ["==", ["get", "cur"], 0]], paint: { "line-color": ZONE_OTHER, "line-width": ["case", ["==", ["get", "hl"], 1], 3, 1.6], "line-dasharray": [3, 2.5], "line-opacity": 0.9 } },
  { id: "sm-track", type: "line", filter: ["==", ["get", "k"], "track"], layout: { "line-cap": "round" }, paint: { "line-color": "#E59BFF", "line-width": ["case", ["==", ["get", "hl"], 1], 5, 3], "line-opacity": 0.9 } },
];

type MapState = { status: "loading" } | { status: "ready"; map: AreaMap } | { status: "error" };

/**
 * The map under "Your area's story": the outline of your zone, the other zones the story's events were filed for, and a pin on each event that
 * has a place (NWS flood reports and tornadoes). Events filed for a whole zone or county have no pin, and the caption says so. Selecting an
 * event, or "Show on map" on a story sentence, highlights its area and pins and frames them.
 */
export function StoryMap({
  area,
  lat,
  lon,
  state,
  events,
  highlightIds,
  onSelect,
}: {
  area: AreaEventsSummary;
  lat: number;
  lon: number;
  state: string;
  /** The events the story is about (cited ones once the story is in). */
  events: readonly AreaEvent[];
  /** Events to highlight: the open event, or the ones a sentence cites. */
  highlightIds: readonly string[];
  onSelect: (id: string) => void;
}) {
  const api = useMapApi();
  const now = currentZone(area.zones);
  const nowCode = now?.code ?? null;
  const nowName = zoneLabel(now?.name ?? null);

  // Zones to outline: yours now, and the zone each event was filed for (a county row has no zone outline here).
  const zoneCodes = useMemo(() => [...new Set([...(nowCode ? [nowCode] : []), ...events.filter((e) => e.area.kind === "Z").map((e) => e.area.code)])].slice(0, 12), [nowCode, events]);
  const ids = useMemo(() => events.map((e) => e.id), [events]);
  const key = `${state}|${zoneCodes.join(",")}|${ids.join(",")}`;

  const [got, setGot] = useState<MapState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setGot((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    fetch(`/api/area-map?state=${state}&zones=${zoneCodes.join(",")}&ids=${ids.join(",")}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<AreaMap>) : Promise.reject(new Error("bad"))))
      .then((map) => setGot({ status: "ready", map }))
      .catch(() => {
        if (!controller.signal.aborted) setGot({ status: "error" });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const hl = useMemo(() => new Set(highlightIds), [highlightIds]);
  const hlZones = useMemo(() => new Set(highlightIds.map((id) => byId.get(id)).filter((e): e is AreaEvent => !!e && e.area.kind === "Z").map((e) => e.area.code)), [highlightIds, byId]);

  const features = useMemo<Features>(() => {
    if (got.status !== "ready") return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: got.map.features.map((f) => {
        const p = f.properties;
        if (p.kind === "zone") return { ...f, properties: { k: "zone", cur: p.code === nowCode ? 1 : 0, hl: hlZones.has(String(p.code)) ? 1 : 0 } };
        return { ...f, properties: { k: "track", hl: hl.has(String(p.id)) ? 1 : 0 } };
      }),
    };
  }, [got, nowCode, hl, hlZones]);
  useGeoOverlay("story-zones", features, LAYERS);

  const points = got.status === "ready" ? got.map.points : [];
  const pins = useMemo<Pin[]>(
    () =>
      points.flatMap((pt) => {
        const event = byId.get(pt.id);
        if (!event) return [];
        return [
          {
            id: pt.id,
            lat: pt.lat,
            lon: pt.lon,
            label: `${eventLabel(event)}. Select to read the National Weather Service’s words.`,
            text: event.start.slice(0, 4),
            color: FAMILIES[familyOf(event.type)].color,
            active: hl.has(pt.id),
            dim: hl.size > 0 && !hl.has(pt.id),
          },
        ];
      }),
    [points, byId, hl],
  );
  useMapPins(pins, onSelect);

  // The resting frame: your zone and the address (a zone is a few tens of km across); falls back to the address while the outline loads.
  const zoneBox = useMemo(() => {
    if (got.status !== "ready" || !nowCode) return null;
    const f = got.map.features.find((x) => x.properties.kind === "zone" && x.properties.code === nowCode);
    if (!f) return null;
    const box: [number, number, number, number] = [lon, lat, lon, lat];
    growBox(f.geometry.coordinates, box);
    return [[box[0], box[1]], [box[2], box[3]]] as [[number, number], [number, number]];
  }, [got, nowCode, lat, lon]);
  const fallbackBox = useMemo(() => boxAround(lat, lon, 0.25, 0.32), [lat, lon]);
  useFitOnArea(lat, lon, 9, zoneBox ?? fallbackBox, 11);

  // Frame what a sentence or an open event is about: its pins, and the zone it was filed for.
  useEffect(() => {
    if (!api || got.status !== "ready" || hl.size === 0) return;
    const box: [number, number, number, number] = [180, 90, -180, -90];
    for (const pt of got.map.points) if (hl.has(pt.id)) growBox([pt.lon, pt.lat], box);
    for (const f of got.map.features) if ((f.properties.kind === "zone" && hlZones.has(String(f.properties.code))) || (f.properties.kind === "track" && hl.has(String(f.properties.id)))) growBox(f.geometry.coordinates, box);
    if (box[0] > box[2]) return; // nothing it is about has a place
    growBox([lon, lat], box);
    const cam = cameraFor(api.map, [[box[0], box[1]], [box[2], box[3]]], { maxZoom: 12 });
    if (cam) api.map.easeTo({ center: cam.center, zoom: cam.zoom, duration: 900, essential: false });
  }, [api, got, hl, hlZones, lat, lon]);

  const located = points.filter((p) => byId.has(p.id)).length;
  const picked = highlightIds.length === 1 ? byId.get(highlightIds[0]) : undefined;
  const pickedHasPlace = picked ? points.some((p) => p.id === picked.id) || picked.area.kind === "Z" : true;
  let summary =
    got.status === "loading"
      ? "Placing the story’s events on the map…"
      : got.status === "error"
        ? "The map outlines are not available right now. The story and timeline in the panel are complete without them."
        : `${nowName ? `Orange outline: your zone, ${nowName}. ` : ""}${located} of the ${events.length} events in the story have a recorded place (pins); the rest were filed for a whole zone or county.`;
  if (picked) summary += pickedHasPlace ? ` Highlighted: ${eventLabel(picked)}.` : ` ${eventLabel(picked)} was filed for ${zoneLabel(picked.area.name) ?? "the county"}, with no place on the map.`;

  return (
    <MapCaption
      title="Where these events happened"
      summary={summary}
      keys={
        <ul className="mapcap-keys" aria-label="Key">
          <li style={{ "--c": ZONE_NOW } as React.CSSProperties}>
            <i /> Your zone
          </li>
          <li style={{ "--c": ZONE_OTHER } as React.CSSProperties}>
            <i className="ring" /> Another zone in the story
          </li>
          <li style={{ "--c": "#E59BFF" } as React.CSSProperties}>
            <i className="dot" /> Flood report or tornado with a place
          </li>
        </ul>
      }
      source="Zone outlines: the NWS forecast zones used in NCEI Storm Events. Pins: where the National Weather Service filed a flood report or a tornado track; a report filed at a city centre is not pinned. Wind, snow, heat and hail rows carry no coordinates."
    />
  );
}
