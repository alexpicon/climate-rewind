"use client";

import { useMemo } from "react";
import { HistoryNav } from "@/components/panel/HistoryNav";
import { useRestOnAddress } from "@/components/map/use-rest-on-address";
import { kmToDegrees, useFitOnArea, useGeoOverlay, type Features, type OverlayLayer } from "@/components/map/use-map-overlay";
import { INDEXED_STATES_TEXT, TORNADO_RADIUS_KM } from "@/lib/constants";
import { efColor } from "@/lib/ui/tornado-model";
import { niceDate } from "@/lib/ui/text";
import type { LookupPayload, NearbyTornado } from "@/lib/types";

const LAYERS: readonly OverlayLayer[] = [
  { id: "tor-empty-ring", type: "line", filter: ["==", ["get", "kind"], "ring"], paint: { "line-color": "#E6EAF2", "line-width": 1.5, "line-dasharray": [3, 3], "line-opacity": 0.7 } },
  { id: "tor-empty-track", type: "line", filter: ["==", ["get", "kind"], "track"], layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.95 } },
  // A short EF0 track is only a few pixels long: a dot at its midpoint makes every one easy to see.
  { id: "tor-empty-dot", type: "circle", filter: ["==", ["get", "kind"], "dot"], paint: { "circle-color": ["get", "color"], "circle-radius": 8, "circle-stroke-color": "#0b1226", "circle-stroke-width": 2.5 } },
];

/** The 10 km circle and the closest tracks beyond it, as map features ([lon, lat]). */
function emptyFeatures(lat: number, lon: number, near: readonly NearbyTornado[]): Features {
  const [dLat, dLon] = kmToDegrees(TORNADO_RADIUS_KM, lat);
  const ring = Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * 2 * Math.PI;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
  });
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { kind: "ring" }, geometry: { type: "LineString", coordinates: ring } },
      ...near.map((t) => ({
        type: "Feature" as const,
        properties: { kind: "track", color: efColor(t.ef) },
        geometry: { type: "LineString" as const, coordinates: [[t.begin[1], t.begin[0]], [t.end[1], t.end[0]]] },
      })),
      ...near.map((t) => ({
        type: "Feature" as const,
        properties: { kind: "dot", color: efColor(t.ef) },
        geometry: { type: "Point" as const, coordinates: [(t.begin[1] + t.end[1]) / 2, (t.begin[0] + t.end[0]) / 2] },
      })),
    ],
  } as Features;
}

/** The camera box: the 10 km circle and the closest tracks. */
function emptyBox(lat: number, lon: number, near: readonly NearbyTornado[]): [[number, number], [number, number]] {
  const [dLat, dLon] = kmToDegrees(TORNADO_RADIUS_KM, lat);
  let [w, s, e, n] = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  for (const t of near) for (const [y, x] of [t.begin, t.end]) [w, s, e, n] = [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)];
  // A little room around the edges, so a dot is never against the frame.
  const [mx, my] = [(e - w) * 0.08, (n - s) * 0.08];
  return [[w - mx, s - my], [e + mx, n + my]];
}

export function TornadoEmpty({ data }: { data: LookupPayload }) {
  const notIndexed = data.coverage === "not yet indexed";
  if (notIndexed) return <TornadoNotIndexed data={data} />;
  return <TornadoNone data={data} />;
}

function TornadoNotIndexed({ data }: { data: LookupPayload }) {
  useRestOnAddress(data.address.lat, data.address.lon);
  return (
    <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
      <section id="v-tornado" className="view on" aria-labelledby="tor-h">
        <HistoryNav current="tornado" address={data.address.input} />
        <h1 className="sr" id="tor-h">Tornado paths: not indexed yet</h1>
        <p className="eyebrow">Tornadoes · not indexed yet</p>
        <div className="big" aria-hidden="true"><span>–</span></div>
        <p className="lede">We have not indexed {data.address.state || "this state"} yet, so there are no tornado paths to show here.</p>
        <p className="note">Tornado paths are indexed for {INDEXED_STATES_TEXT} so far. No paths shown here does not mean there were none.</p>
      </section>
    </aside>
  );
}

function TornadoNone({ data }: { data: LookupPayload }) {
  const { lat, lon } = data.address;
  const near = useMemo(() => data.nearestTornadoes ?? [], [data.nearestTornadoes]);
  const features = useMemo(() => emptyFeatures(lat, lon, near), [lat, lon, near]);
  useGeoOverlay("tornado-empty", features, LAYERS);
  const box = useMemo(() => emptyBox(lat, lon, near), [lat, lon, near]);
  useFitOnArea(lat, lon, 11, box, 12);
  return (
    <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
      <section id="v-tornado" className="view on" aria-labelledby="tor-h">
        <HistoryNav current="tornado" address={data.address.input} />
        <h1 className="sr" id="tor-h">Tornado paths within 10 kilometres</h1>
        <p className="eyebrow">Tornadoes · within 10 km</p>
        <div className="big" aria-hidden="true"><span>0</span></div>
        <p className="lede">No tornado path in the records we have came within 10 km of this address. The dashed circle on the map is 10 km.</p>
        {near.length ? (
          <>
            <p className="eyebrow">The closest on record</p>
            <ul className="tor-near" aria-label="The closest tornado tracks beyond 10 km">
              {near.map((t) => (
                <li key={t.id}>
                  <span className="ef" style={{ background: efColor(t.ef) }}>{t.ef}</span> {niceDate(t.start)} · {t.minDistanceKm.toFixed(1)} km away
                </li>
              ))}
            </ul>
            <p className="note">Shown on the map as colored dots, each on its NWS track.</p>
          </>
        ) : null}
        <p className="note">That is what our records show. It is not a promise that one never will.</p>
      </section>
    </aside>
  );
}
