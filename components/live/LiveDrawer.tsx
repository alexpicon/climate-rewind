"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { alertLevel, parseMotion } from "@/lib/ui/alerts";
import { el, HOUSE_SVG } from "@/lib/ui/dom";
import { loadMapLibre } from "@/lib/ui/maplibre";
import { baseStyle, LABELS_LAYER, liveRadarTiles } from "@/lib/ui/map-style";
import { bearingWord } from "@/lib/geo";
import type { FloodTrigger } from "@/lib/types";
import { TRIGGER_TITLE, triggerCopy, triggerFinePrint } from "@/lib/ui/trigger-text";
import type { Live } from "./use-live";

interface Props {
  live: Live;
  lat: number;
  lon: number;
  notice?: string;
  /** The street's flood trigger, shown as one calm line under the alerts. */
  trigger?: FloodTrigger | null;
  onClose: () => void;
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const COLORS = { warn: "#FF8A7A", watch: "#FFB45A" } as const;

/** The live alerts drawer: status, each real alert, and a small map with the outline and storm motion. */
export function LiveDrawer({ live, lat, lon, notice, trigger, onClose }: Props) {
  const [radar, setRadar] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const miniRef = useRef<{ map: MapLibreMap; markers: Marker[]; gl: typeof import("maplibre-gl") } | null>(null);
  const [miniReady, setMiniReady] = useState(false);
  const [miniFailed, setMiniFailed] = useState(false);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  // A second, small map so an alert never fights the main map's camera lock.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gl = await loadMapLibre();
      if (cancelled || !mapBox.current) return;
      let map: MapLibreMap;
      try {
        map = new gl.Map({
          container: mapBox.current,
          style: baseStyle(),
          center: [lon, lat],
          zoom: 8.4,
          minZoom: 5,
          maxZoom: 11,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          maxPitch: 0,
          fadeDuration: 0,
        });
      } catch {
        // No WebGL: the drawer's text says everything the small map would show.
        setMiniFailed(true);
        return;
      }
      map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");
      map.touchZoomRotate.disableRotation();
      map.on("load", () => {
        if (cancelled) return;
        map.addSource("live", { type: "raster", tiles: liveRadarTiles(), tileSize: 512, maxzoom: 8 });
        map.addLayer({ id: "livel", type: "raster", source: "live", layout: { visibility: "none" }, paint: { "raster-opacity": 0.8, "raster-fade-duration": 0, "raster-resampling": "linear" } }, LABELS_LAYER);
        map.addSource("alert", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "alert-fill", type: "fill", source: "alert", paint: { "fill-color": ["get", "c"], "fill-opacity": 0.26 } });
        map.addLayer({ id: "alert-line", type: "line", source: "alert", paint: { "line-color": ["get", "c"], "line-width": 3.5 } });
        map.addSource("motion", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "motion-l", type: "line", source: "motion", paint: { "line-color": "#fff", "line-width": 3.5, "line-dasharray": [2, 1.2] } });
        const house = el("div", { className: "mini-house", attrs: { "aria-hidden": "true" } }, [
          el("span", { svg: HOUSE_SVG.replace('width="26" height="26"', 'width="18" height="18"') }),
        ]);
        const marker = new gl.Marker({ element: house, anchor: "center" }).setLngLat([lon, lat]).addTo(map);
        miniRef.current = { map, markers: [marker], gl };
        setMiniReady(true);
      });
      miniRef.current = { map, markers: [], gl };
    })();
    return () => {
      cancelled = true;
      miniRef.current?.map.remove();
      miniRef.current = null;
      setMiniReady(false);
    };
  }, [lat, lon]);

  // Draw the real alerts: outline, and the NWS's own storm motion as a 30-minute arrow.
  useEffect(() => {
    const mini = miniRef.current;
    if (!mini || !miniReady) return;
    const { map, gl } = mini;

    const outlined = live.alerts.filter((a) => a.polygon);
    const features = outlined.map((a) => ({ type: "Feature" as const, properties: { c: COLORS[alertLevel(a)] }, geometry: a.polygon! }));
    (map.getSource("alert") as GeoJSONSource).setData({ type: "FeatureCollection", features } as never);

    mini.markers.slice(1).forEach((m) => m.remove());
    mini.markers = mini.markers.slice(0, 1);
    const lines: unknown[] = [];
    const bounds = new gl.LngLatBounds();
    for (const alert of live.alerts) {
      const motion = parseMotion(alert.motion);
      if (!motion) continue;
      const to = (motion.from + 180) % 360;
      const km = motion.knots * 1.852 * 0.5; // 30 minutes at the stated speed
      const rad = (to * Math.PI) / 180;
      const end: [number, number] = [
        motion.lon + (km * Math.sin(rad)) / (111.32 * Math.cos((motion.lat * Math.PI) / 180)),
        motion.lat + (km * Math.cos(rad)) / 110.57,
      ];
      lines.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[motion.lon, motion.lat], end] } });
      const arrow = el("div", {
        attrs: { "aria-hidden": "true" },
        svg: `<svg width="30" height="30" viewBox="-13 -13 26 26" style="transform:rotate(${to}deg);display:block" aria-hidden="true"><path d="M0 -11 L8 8 L0 4 L-8 8z" fill="#fff" stroke="#0b111e" stroke-width="1.5"/></svg>`,
      });
      mini.markers.push(new gl.Marker({ element: arrow, anchor: "center" }).setLngLat(end).addTo(map));
      bounds.extend([motion.lon, motion.lat]);
    }
    (map.getSource("motion") as GeoJSONSource).setData({ type: "FeatureCollection", features: lines } as never);

    if (outlined.length) {
      for (const alert of outlined) {
        const rings = alert.polygon!.type === "Polygon" ? [alert.polygon!.coordinates] : alert.polygon!.coordinates;
        rings.forEach((poly) => poly[0].forEach((c) => bounds.extend(c as [number, number])));
      }
      bounds.extend([lon, lat]);
      map.fitBounds(bounds, { padding: 36, duration: 0, maxZoom: 10 });
    } else {
      map.jumpTo({ center: [lon, lat], zoom: 8.4 });
    }
  }, [live.alerts, miniReady, lat, lon]);

  useEffect(() => {
    const mini = miniRef.current;
    if (!mini || !miniReady) return;
    mini.map.setLayoutProperty("livel", "visibility", radar ? "visible" : "none");
  }, [radar, miniReady]);

  const when = live.checkedAt ? timeOf(live.checkedAt) : "";
  const outlined = live.alerts.some((a) => a.polygon);
  const alerting = live.state === "watch" || live.state === "warn";

  return (
    <aside
      id="drawer"
      className="glass"
      role="dialog"
      aria-modal="false"
      aria-labelledby="dr-h"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="dr-top">
        <h2 id="dr-h" ref={headingRef} tabIndex={-1}>
          Live NWS alerts
        </h2>
        <button type="button" className="dr-x" aria-label="Close the live alerts drawer" onClick={onClose}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="dr-body">
        {live.state === "error" ? (
          <div className="errcard" role="alert">
            <b>We couldn’t check right now.</b>
            {notice ?? "The alert service didn’t answer."} That does not mean the sky is clear. Check weather.gov or try again.
          </div>
        ) : null}
        {live.state === "loading" ? <div className="skeleton" aria-hidden="true" /> : null}
        {live.state === "calm" ? (
          <div className="calm">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#8FE3A7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l2.8 2.8L16.5 9.5" />
            </svg>
            <div>
              <b>No NWS alerts for this address</b>
              <span>Checked {when}. If a warning is issued, its outline and storm motion appear here and the strip turns amber or red.</span>
            </div>
          </div>
        ) : null}

        <div className="dr-mapwrap">
          <div ref={mapBox} id="dr-map" role="img" aria-label="Small map around your address. It shows the alert outline and storm motion when an alert is active, and live radar if you turn it on." />
          {miniFailed ? <p className="dr-mapoff">The map can’t be drawn in this browser (it needs WebGL). The alerts above are complete.</p> : null}
          <div className="dr-maplab" aria-hidden="true">
            {radar ? <><b>Live radar</b> NOAA NEXRAD</> : outlined ? <><b>Alert outline</b> and storm motion</> : <><b>Around your address</b> · radar is off</>}
          </div>
        </div>

        <label className="dr-switch" htmlFor="dr-radar">
          <input id="dr-radar" type="checkbox" role="switch" checked={radar} onChange={(event) => setRadar(event.target.checked)} />
          <span className="sw" aria-hidden="true" />
          <span className="swt">
            <b>Show live radar</b>
            <small>NOAA NEXRAD, updates about every 5 minutes. No color means no rain.</small>
          </span>
        </label>

        {alerting
          ? live.alerts.map((alert) => {
              const motion = parseMotion(alert.motion);
              const level = alertLevel(alert);
              return (
                <div key={alert.id} className={`alertcard ${level}`}>
                  <h3>{alert.event}</h3>
                  <p>
                    <b>{alert.severity ?? ""}</b>
                    {alert.urgency ? ` · ${alert.urgency}` : ""}
                    {alert.ends ? ` · until ${timeOf(Date.parse(alert.ends))}` : ""}
                  </p>
                  <p>{alert.headline}</p>
                  {alert.polygon ? null : <p className="note">The NWS issued this for a zone, so there is no exact outline to draw.</p>}
                  {motion ? (
                    <p className="note">
                      <b>Storm motion, as stated by the NWS:</b> toward the {bearingWord(motion.from + 180)} at{" "}
                      {Math.round(motion.knots * 1.151)} mph. The white arrow shows the next 30 minutes at that speed. This is the NWS’s motion, not our prediction.
                    </p>
                  ) : null}
                </div>
              );
            })
          : null}

        {trigger ? <TriggerLine trigger={trigger} /> : null}

        <button className="btn ghost" type="button" disabled={live.checking} onClick={live.refresh}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M3 12a9 9 0 0 1 15.5-6.2M21 4v5h-5M21 12a9 9 0 0 1-15.5 6.2M3 20v-5h5" />
          </svg>
          {live.checking ? "Checking…" : "Check again"}
        </button>
        <p className="fine">Source: api.weather.gov{when ? `, checked ${when}` : ""}; checked on load and every 5 minutes.</p>
      </div>
    </aside>
  );
}

/** One line about the street's flood trigger (the full card is on the storm tab). */
function TriggerLine({ trigger }: { trigger: FloodTrigger }) {
  const copy = triggerCopy(trigger);
  return (
    <section className={`trigger-line ${copy.tone}`} aria-labelledby="dr-trig-h">
      <h3 id="dr-trig-h">{TRIGGER_TITLE}</h3>
      <p>{copy.headline}</p>
      {copy.context[0] ? <p className="trig-n">{copy.context[0]}</p> : null}
      {copy.notice ? <p className="trig-n">{copy.notice}</p> : null}
      <p className="trig-fine">{triggerFinePrint(trigger)}</p>
    </section>
  );
}
