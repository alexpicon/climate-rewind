"use client";

import { useEffect, useMemo, useState } from "react";
import { boxAround, boxesTouch, growBox, useFitOnArea, useGeoOverlay, type Features, type OverlayLayer } from "@/components/map/use-map-overlay";
import { MapCaption } from "@/components/map/MapCaption";
import type { AlertZone } from "@/lib/alert-zone";
import { LEVEL_ORDER, type OutlookAreas, type OutlookKind, type OutlookLevel } from "@/lib/outlook-areas";
import { ERO_LABEL, type OutlookPayload } from "@/lib/outlook-types";
import type { LookupPayload } from "@/lib/types";

/** Marginal to High, one calm ramp. Text names every level in the key, so color is never the only signal. */
export const LEVEL_COLOR: Record<OutlookLevel, string> = { MRGL: "#6BD08A", SLGT: "#FFE066", ENH: "#FFA94D", MDT: "#FF6B57", HIGH: "#FF4FD8" };
const LEVEL_NAME: Record<OutlookLevel, string> = { MRGL: "Marginal", SLGT: "Slight", ENH: "Enhanced", MDT: "Moderate", HIGH: "High" };

const colorByLevel = ["match", ["get", "level"], ...LEVEL_ORDER.flatMap((l) => [l, LEVEL_COLOR[l]]), "#9aa6bd"];
const LAYERS: readonly OverlayLayer[] = [
  { id: "oa-fill", type: "fill", filter: ["==", ["get", "k"], "area"], paint: { "fill-color": colorByLevel, "fill-opacity": 0.24 } },
  { id: "oa-line", type: "line", filter: ["==", ["get", "k"], "area"], paint: { "line-color": colorByLevel, "line-width": 2, "line-opacity": 0.95 } },
  { id: "al-fill", type: "fill", filter: ["==", ["get", "k"], "alert"], paint: { "fill-color": "#FF6B57", "fill-opacity": 0.1 } },
  { id: "al-line", type: "line", filter: ["==", ["get", "k"], "alert"], paint: { "line-color": "#FF8A7A", "line-width": 3, "line-dasharray": [2, 1.5] } },
];

type AreasState = { status: "loading" } | { status: "ready"; areas: OutlookAreas } | { status: "error" };

const KIND_LABEL: Record<OutlookKind, string> = { flood: "Rain and flooding", storm: "Storms" };
const SOURCE_NAME: Record<OutlookKind, string> = { flood: "WPC Excessive Rainfall Outlook", storm: "SPC Convective Outlook (categorical)" };

/** "Oct 9, 00:29 UTC" */
function utcStamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, ${d.toISOString().slice(11, 16)} UTC`;
}

/**
 * The map under "Next 72 hours": the agencies' own outlook polygons for the day and kind chosen (rain and flooding from the WPC, storms from
 * the SPC), the live NWS alert outline if there is one, and the address. It frames the region, not the street: the cards say what it means
 * at the address. A polygon is the agency's shape, never ours.
 */
export function AheadMap({ data, outlook }: { data: LookupPayload; outlook: OutlookPayload | null }) {
  const { lat, lon } = data.address;
  const [areas, setAreas] = useState<AreasState>({ status: "loading" });
  const [zones, setZones] = useState<AlertZone[]>([]);
  const [pick, setPick] = useState<{ kind: OutlookKind; day: 1 | 2 | 3 } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/outlook-areas", { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<OutlookAreas>) : Promise.reject(new Error("bad"))))
      .then((areas) => setAreas({ status: "ready", areas }))
      .catch((e) => {
        if (!controller.signal.aborted) setAreas({ status: "error" });
        void e;
      });
    return () => controller.abort();
  }, []);

  // A live alert with no polygon (a Flood Watch is issued for zones): draw the zone that holds the address, labelled as the zone.
  const alerts = data.live?.alerts ?? [];
  const bare = alerts.some((a) => !a.polygon);
  useEffect(() => {
    if (!bare) {
      setZones([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/alert-zone?lat=${lat}&lon=${lon}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ zones: AlertZone[] }>) : { zones: [] }))
      .then((body) => setZones(body.zones ?? []))
      .catch(() => setZones([]));
    return () => controller.abort();
  }, [bare, lat, lon]);

  // The opening choice: rain and flooding, on the first day that has a risk area at the address (else Day 1). The visitor's choice wins after.
  const firstRisky = outlook?.flood.days?.find((d) => d.level !== "none")?.day ?? 1;
  const kind = pick?.kind ?? "flood";
  const day = pick?.day ?? firstRisky;

  const shown = useMemo<Features>(() => {
    const features: Features["features"] = [];
    if (areas.status === "ready") {
      for (const f of areas.areas.areas.features) if (f.properties.kind === kind && f.properties.day === day) features.push({ ...f, properties: { ...f.properties, k: "area" } });
    }
    for (const alert of alerts) if (alert.polygon) features.push({ type: "Feature", properties: { k: "alert", event: alert.event }, geometry: alert.polygon });
    for (const zone of zones) features.push({ type: "Feature", properties: { k: "alert", event: zone.events.join(", ") }, geometry: zone.geometry });
    return { type: "FeatureCollection", features };
  }, [areas, kind, day, alerts, zones]);

  useGeoOverlay("ahead-areas", shown, LAYERS);
  const box = useMemo(() => boxAround(lat, lon, 2.3, 3.4), [lat, lon]);
  useFitOnArea(lat, lon, 6, box, 7);

  // What the card says is what the framed region shows: an area elsewhere in the country is not "near you".
  const frame = [box[0][0], box[0][1], box[1][0], box[1][1]];
  const near = shown.features.filter((f) => {
    if (f.properties.k !== "area") return false;
    const b: [number, number, number, number] = [180, 90, -180, -90];
    growBox(f.geometry.coordinates, b);
    return boxesTouch(b, frame);
  });
  const present = LEVEL_ORDER.filter((level) => near.some((f) => f.properties.level === level));
  const product = areas.status === "ready" ? areas.areas.products.find((p) => p.kind === kind && p.day === day) : undefined;
  const here = kind === "flood" ? outlook?.flood.days?.find((d) => d.day === day)?.level : undefined;

  let summary: string;
  if (areas.status === "loading") summary = "Reading the outlook maps…";
  else if (areas.status === "error") summary = "The outlook maps are not available right now. The cards in the panel are read separately.";
  else if (present.length === 0) summary = `No ${KIND_LABEL[kind].toLowerCase()} risk area in the NWS outlook for Day ${day} anywhere near this address.`;
  else summary = `Day ${day}, ${KIND_LABEL[kind].toLowerCase()}: ${present.map((l) => LEVEL_NAME[l]).join(", ")} risk ${present.length === 1 ? "area" : "areas"} in the NWS outlook near this address.`;
  if (here) summary += ` At your address: ${ERO_LABEL[here].toLowerCase()}${here === "none" ? "" : " risk"}.`;
  if (alerts.length) summary += ` Dashed outline: ${bare && zones.length ? "the zone your address is in, under" : "live NWS alert"} ${[...new Set(alerts.map((a) => a.event))].join(", ")}.`;

  const pressed = (k: OutlookKind, d: 1 | 2 | 3) => kind === k && day === d;
  const set = (next: Partial<{ kind: OutlookKind; day: 1 | 2 | 3 }>) => setPick({ kind, day, ...next });

  return (
    <MapCaption
      title="Official outlook areas"
      summary={summary}
      controls={
        <>
          <div className="seg" role="group" aria-label="Which outlook to draw">
            {(["flood", "storm"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => set({ kind: k })}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Which day to draw">
            {([1, 2, 3] as const).map((d) => (
              <button key={d} type="button" aria-pressed={pressed(kind, d)} onClick={() => set({ day: d })}>
                Day {d}
              </button>
            ))}
          </div>
        </>
      }
      keys={
        <ul className="mapcap-keys" aria-label="Key">
          {present.map((level) => (
            <li key={level} style={{ "--c": LEVEL_COLOR[level] } as React.CSSProperties}>
              <i /> {LEVEL_NAME[level]}
            </li>
          ))}
          {alerts.length ? (
            <li style={{ "--c": "#FF8A7A" } as React.CSSProperties}>
              <i className="ring" /> Live NWS alert
            </li>
          ) : null}
        </ul>
      }
      source={
        <>
          Source: {SOURCE_NAME[kind]}, NWS map service
          {utcStamp(product?.issued ?? null) ? `, issued ${utcStamp(product?.issued ?? null)}` : ""}
          {alerts.length ? "; alerts from api.weather.gov" : ""}. Outlines are generalized to about 1 km. These are the agencies’ products, not our forecast.
          {areas.status === "ready" && areas.areas.notice ? ` ${areas.areas.notice}` : ""}
        </>
      }
    />
  );
}
