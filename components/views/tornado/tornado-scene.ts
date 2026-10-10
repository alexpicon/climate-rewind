/**
 * The tornado view's map: the 5 and 10 km rings, each track drawing on with a spinning vortex, its
 * growing damage swath, a call-out for the strongest one, and the closest-pass finale.
 */
import type { GeoJSONSource, Marker } from "maplibre-gl";
import type { MapApi } from "@/components/map/map-context";
import { clamp, inOut, lerp } from "@/lib/ui/anim";
import { cameraFor, keepInView, safeRect, enterCamera, unlockCamera, type Camera, type CameraLock } from "@/lib/ui/camera";
import { decorative, el } from "@/lib/ui/dom";
import { LABELS_LAYER } from "@/lib/ui/map-style";
import {
  casualtyParts,
  circlePoints,
  closestTornado,
  DAMAGE_LABEL,
  damageWhere,
  efColor,
  efLineWidth,
  efVortexScale,
  isBig,
  isStrong,
  strongestTornado,
  swathPolygon,
  type TornadoTimeline,
} from "@/lib/ui/tornado-model";
import { niceDate } from "@/lib/ui/text";
import { bearingAcross, camera3D, disable3D, enable3D, FLY_IN_MS, is3D, PITCH_3D } from "@/lib/ui/terrain3d";
import type { Coord, DamagePin, NearbyTornado } from "@/lib/types";

const VORTEX =
  '<svg class="vort" viewBox="0 0 54 64" width="54" height="64" aria-hidden="true" focusable="false"><defs><clipPath id="vclip"><path d="M3 4Q27 -1 51 4L33 52Q27 58 21 52Z"/></clipPath><linearGradient id="vgrad" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".5" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient></defs>' +
  '<path class="vbody" d="M3 4Q27 -1 51 4L33 52Q27 58 21 52Z" fill="url(#vgrad)" stroke="currentColor" stroke-width="2.2"/>' +
  '<g clip-path="url(#vclip)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><ellipse class="vb v1" cx="27" cy="8" rx="25" ry="4.2"/><ellipse class="vb v2" cx="27" cy="16" rx="21" ry="3.8"/><ellipse class="vb v3" cx="27" cy="24" rx="17" ry="3.4"/><ellipse class="vb v4" cx="27" cy="32" rx="13" ry="3"/><ellipse class="vb v5" cx="27" cy="40" rx="9.5" ry="2.6"/><ellipse class="vb v6" cx="27" cy="47" rx="6" ry="2.2"/></g>' +
  '<g transform="translate(27 58) scale(1 .36)"><g class="orbit" fill="currentColor"><circle cx="17" cy="0" r="2.6"/><circle cx="-15" cy="7" r="2.2"/><circle cx="4" cy="-16" r="2.4"/><circle cx="-7" cy="15" r="2"/><circle cx="-19" cy="-4" r="1.8"/><circle cx="12" cy="13" r="1.8"/></g></g></svg>';

interface SceneOptions {
  origin: Coord;
  timeline: TornadoTimeline;
  /** The AI-mapped damage places; each appears once its tornado's track has been drawn. */
  damage?: readonly DamagePin[];
  reduced: boolean;
  /** Start in the 3D view (terrain and buildings). Toggle later with setView3d. */
  view3d?: boolean;
  /** Called when a track passes within 2 km while playing, for the screen reader. */
  onPass?: (tornado: NearbyTornado) => void;
}

const EMPTY = { type: "FeatureCollection", features: [] } as const;

export class TornadoScene {
  private cam0: Camera | null = null;
  private vortex: Marker | null = null;
  private callout: Marker | null = null;
  private distanceLabel: Marker | null = null;
  private ringLabels: Marker[] = [];
  /** One marker per AI-mapped damage place; `at` is when its tornado's track finishes drawing. */
  private damageMarkers: Array<{ marker: Marker; at: number; on: boolean }> = [];
  private lastTime = 0;
  private zoomedIn = false;
  private cancelCamera: (() => void) | null = null;
  private view3d = false;
  private lockBox: [[number, number], [number, number]] = [[0, 0], [0, 0]];
  private fitZoom = 8;
  private pulseTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly closest: NearbyTornado | null;
  private readonly strongest: NearbyTornado | null;

  constructor(
    private readonly api: MapApi,
    private readonly opts: SceneOptions,
  ) {
    const all = opts.timeline.items.map((i) => i.tornado);
    this.closest = closestTornado(all);
    this.strongest = strongestTornado(all);
  }

  enter(): void {
    const { map, gl } = this.api;
    const { origin, timeline, reduced } = this.opts;
    const lonLat: [number, number] = [origin[1], origin[0]];

    map.addSource("rings", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [10, 5].map((km) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: circlePoints(origin, km) } })),
      },
    });
    map.addLayer({ id: "rings-l", type: "line", source: "rings", paint: { "line-color": "#E8EAF2", "line-width": 1.6, "line-dasharray": [3, 4], "line-opacity": 0.7 } }, LABELS_LAYER);
    for (const id of ["swath", "tor", "dist"]) map.addSource(id, { type: "geojson", data: EMPTY as never });
    map.addLayer({ id: "tor-swath", type: "fill", source: "swath", paint: { "fill-color": ["get", "c"], "fill-opacity": ["*", ["get", "a"], 0.46], "fill-antialias": true } }, LABELS_LAYER);
    map.addLayer({ id: "tor-swath-edge", type: "line", source: "swath", paint: { "line-color": ["get", "c"], "line-width": 1, "line-opacity": ["*", ["get", "a"], 0.7] } }, LABELS_LAYER);
    map.addLayer({ id: "tor-glow", type: "line", source: "tor", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": ["*", ["get", "w"], 2.6], "line-blur": 8, "line-opacity": ["*", ["get", "a"], 0.5] } }, LABELS_LAYER);
    map.addLayer({ id: "tor-case", type: "line", source: "tor", filter: ["==", ["get", "big"], 1], layout: { "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": ["+", ["get", "w"], 3], "line-opacity": 0.32 } }, LABELS_LAYER);
    map.addLayer({ id: "tor-line", type: "line", source: "tor", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": ["get", "w"], "line-opacity": ["get", "a"] } }, LABELS_LAYER);
    map.addLayer({ id: "tor-start", type: "circle", source: "tor", paint: { "circle-radius": ["+", 2.5, ["*", ["get", "w"], 0.22]], "circle-color": "#0b111e", "circle-stroke-color": ["get", "c"], "circle-stroke-width": 2, "circle-opacity": ["get", "a"], "circle-stroke-opacity": ["get", "a"] } }, LABELS_LAYER);
    map.addLayer({ id: "dist-l", type: "line", source: "dist", paint: { "line-color": "#fff", "line-width": 2.5, "line-dasharray": [1, 1.6] } }, LABELS_LAYER);

    // Camera: the 10 km circle, locked inside a box that holds every track so nobody pans into empty map.
    const damage = this.opts.damage ?? [];
    const points: Coord[] = [origin, ...timeline.items.flatMap((i) => [i.tornado.begin, i.tornado.end]), ...damage.map((d): Coord => [d.lat, d.lon])];
    const lats = points.map((p) => p[0]);
    const lons = points.map((p) => p[1]);
    const pad = 0.12;
    this.lockBox = [
      [Math.min(...lons) - pad, Math.min(...lats) - pad],
      [Math.max(...lons) + pad, Math.max(...lats) + pad],
    ];
    const fit = cameraFor(map, this.lockBox);
    this.fitZoom = fit?.zoom ?? 8;
    this.view3d = Boolean(this.opts.view3d);
    if (this.view3d) enable3D(map);
    this.cam0 = this.baseCamera();
    this.cancelCamera = enterCamera(
      map,
      () => {
        this.cam0 = this.baseCamera() ?? this.cam0;
        return this.cam0;
      },
      () => this.lock(),
      reduced,
      this.view3d ? FLY_IN_MS : 2200,
    );

    this.callout = new gl.Marker({ element: decorative(el("div", {}, [el("div", { className: "torlab" })])), anchor: "bottom", offset: [0, -14] });
    this.distanceLabel = new gl.Marker({ element: decorative(el("div", {}, [el("div", { className: "chip" })])), anchor: "left", offset: [14, -4] });
    this.vortex = new gl.Marker({ element: decorative(el("div", { className: "torm" }, [el("span", { svg: VORTEX }), el("span", { className: "tl" }, [el("b"), el("span")])])), anchor: "center" });
    this.damageMarkers = damage.flatMap((pin) => {
      const item = timeline.items.find((i) => i.tornado.id === pin.tornadoId);
      if (!item) return [];
      const color = efColor(pin.ef ?? item.tornado.ef);
      return [{ marker: new gl.Marker({ element: this.damageElement(pin, color), anchor: "center" }).setLngLat([pin.lon, pin.lat]), at: item.startMs + item.drawMs, on: false }];
    });
    this.ringLabels = [[5, "5 km"], [10, "10 km"]].map(([km, text]) =>
      new gl.Marker({ element: decorative(el("div", {}, [el("div", { className: "ringlab", text: String(text) })])), anchor: "bottom", offset: [0, -2] })
        .setLngLat([lonLat[0], lonLat[1] + Number(km) / 110.57])
        .addTo(map),
    );
  }

  /**
   * A damage place on the map: a small diamond that shows the survey's own words on hover or tap. Decorative to assistive tech:
   * the same words are in the story panel's list and in the text version, which a keyboard and a screen reader can reach.
   */
  private damageElement(pin: DamagePin, color: string): HTMLElement {
    const root = decorative(
      el("div", { className: "dmgm" }, [
        el("span", { className: "dmgdot" }, [el("i")]),
        el("span", { className: "dmglab" }, [
          el("b", { text: pin.place }),
          el("q", { text: pin.phrase }),
          el("em", { text: `${DAMAGE_LABEL} · ${damageWhere(pin.matchType)}` }),
        ]),
      ]),
    );
    root.style.setProperty("--c", color);
    // The label is centred on the diamond; near the story panel (desktop, left side) it would open behind it, so it opens to the right instead.
    const keepClear = () => {
      const clearOf = safeRect().left;
      root.classList.toggle("flip", root.getBoundingClientRect().left - 150 < clearOf);
      // Then slide the card back inside the visible map area (clear of the panel, the top bar and the dock).
      const label = root.querySelector<HTMLElement>(".dmglab");
      label?.style.removeProperty("translate");
      requestAnimationFrame(() => keepInView(label));
    };
    root.addEventListener("mouseenter", keepClear);
    root.addEventListener("click", (event) => {
      keepClear();
      event.stopPropagation();
      const open = root.classList.toggle("active");
      if (open) for (const other of document.querySelectorAll(".dmgm.active")) if (other !== root) other.classList.remove("active");
    });
    return root;
  }

  /** The camera the animation rests on: the 10 km circle, or in 3D a pitched view across the closest track. */
  private baseCamera(): Camera | null {
    const { origin } = this.opts;
    if (this.view3d) {
      const across = this.closest ? bearingAcross(this.closest.begin, this.closest.end) : -18;
      return camera3D(origin, 12.8, across);
    }
    const ringBox = circlePoints(origin, 12);
    const flat = cameraFor(this.api.map, [
      [Math.min(...ringBox.map((p) => p[0])), Math.min(...ringBox.map((p) => p[1]))],
      [Math.max(...ringBox.map((p) => p[0])), Math.max(...ringBox.map((p) => p[1]))],
    ]);
    return flat ? { ...flat, pitch: 0, bearing: 0 } : null;
  }

  private lock(): CameraLock {
    const fit = cameraFor(this.api.map, this.lockBox);
    this.fitZoom = fit?.zoom ?? this.fitZoom;
    return { bounds: this.lockBox, minZoom: Math.max(5, this.fitZoom), maxZoom: this.view3d ? 15 : 13.8 };
  }

  /** Turns the 3D view on or off: a slow pitched fly-in (a jump with reduced motion), or back to the flat circle, then the terrain goes. */
  setView3d(on: boolean): void {
    if (on === this.view3d) return;
    const { map } = this.api;
    this.cancelCamera?.();
    this.view3d = on;
    if (on) enable3D(map);
    this.cam0 = this.baseCamera();
    // The closest-pass finale positions the camera itself every frame; leave it alone there and just add the tilt.
    this.cancelCamera = enterCamera(
      map,
      this.zoomedIn ? { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), pitch: on ? PITCH_3D : 0, bearing: on ? this.cam0?.bearing ?? -18 : 0 } : this.cam0,
      () => this.lock(),
      this.opts.reduced,
      on ? FLY_IN_MS : 2200,
      () => {
        if (!this.view3d) disable3D(map);
      },
    );
  }

  destroy(): void {
    const { map } = this.api;
    this.cancelCamera?.();
    clearTimeout(this.pulseTimer);
    [this.vortex, this.callout, this.distanceLabel, ...this.ringLabels, ...this.damageMarkers.map((d) => d.marker)].forEach((m) => m?.remove());
    if (map.getStyle()) {
      for (const id of ["dist-l", "tor-start", "tor-line", "tor-case", "tor-glow", "tor-swath-edge", "tor-swath", "rings-l"]) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of ["dist", "tor", "swath", "rings"]) if (map.getSource(id)) map.removeSource(id);
    }
    document.querySelector(".addr-pin")?.classList.remove("tp");
    if (is3D(map)) disable3D(map);
    unlockCamera(map);
  }

  /** Draws everything for animation time `ms`. `playing` decides whether to pulse the address. */
  update(ms: number, playing: boolean): void {
    const { map } = this.api;
    const { timeline, reduced, origin } = this.opts;
    const lines: unknown[] = [];
    const swaths: unknown[] = [];
    let current: { tornado: NearbyTornado; head: [number, number] } | null = null;

    for (const item of timeline.items) {
      const t = item.tornado;
      const u = clamp((ms - item.startMs) / item.drawMs);
      if (u <= 0) continue;
      const done = u >= 1;
      const color = efColor(t.ef);
      const head: [number, number] = [lerp(t.begin[1], t.end[1], u), lerp(t.begin[0], t.end[0], u)];
      const alpha = done ? (isStrong(t.ef) ? 0.95 : 0.65) : 1;
      lines.push({ type: "Feature", properties: { c: color, w: efLineWidth(t.ef), a: alpha, big: isBig(t.ef) ? 1 : 0 }, geometry: { type: "LineString", coordinates: [[t.begin[1], t.begin[0]], head] } });
      swaths.push({ type: "Feature", properties: { c: color, a: done ? 0.85 : 1 }, geometry: { type: "Polygon", coordinates: [swathPolygon(t, u)] } });
      if (!done) current = { tornado: t, head };

      // A brief pulse at the address as a close track passes its nearest point.
      const passAt = item.startMs + item.closestFraction * item.drawMs;
      if (t.minDistanceKm <= 2 && this.lastTime < passAt && ms >= passAt && ms - passAt < 1500 && playing) this.pulse(t);
    }
    (map.getSource("tor") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: lines } as never);
    (map.getSource("swath") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: swaths } as never);
    this.lastTime = ms;

    // A damage place appears once its tornado's track is drawn, and goes again if the slider is dragged back.
    for (const d of this.damageMarkers) {
      const on = ms >= d.at;
      if (on === d.on) continue;
      d.on = on;
      if (on) d.marker.addTo(map);
      else d.marker.remove();
    }

    // The vortex rides the head of the track being drawn (reduced motion: just the drawn line).
    if (current && ms < timeline.tracksMs && !reduced) {
      const element = this.vortex!.getElement();
      const t = current.tornado;
      this.vortex!.setLngLat(current.head);
      if (!element.isConnected) this.vortex!.addTo(map);
      element.style.setProperty("--c", efColor(t.ef));
      element.style.setProperty("--s", String(efVortexScale(t.ef)));
      element.classList.toggle("ef3", isBig(t.ef));
      element.querySelector(".tl b")!.textContent = niceDate(t.start);
      element.querySelector(".tl span")!.textContent = `${t.ef} · ${t.lengthMi} mi`;
    } else {
      this.vortex?.remove();
    }

    // Call-out for the strongest tornado once it is drawn, until the finale.
    const s = this.strongest;
    const strongItem = timeline.items.find((i) => i.tornado === s);
    const showCallout = !!s && !!strongItem && ms >= strongItem.startMs + strongItem.drawMs * 0.98 && ms < timeline.tracksMs + timeline.finaleMs * 0.4 && isStrong(s.ef);
    if (showCallout && s) {
      if (!this.callout!.getElement().isConnected) {
        const box = this.callout!.getElement().firstElementChild as HTMLElement;
        box.replaceChildren(document.createTextNode(`${s.ef} · ${niceDate(s.start)}`), el("span", { text: [...casualtyParts(s), `up to ${s.widthYd.toLocaleString("en-US")} yd wide`].join(" · ") }));
        this.callout!.setLngLat([lerp(s.begin[1], s.end[1], 0.3), lerp(s.begin[0], s.end[0], 0.3)]).addTo(map);
      }
    } else {
      this.callout?.remove();
    }

    this.drawFinale(ms, origin);
    this.keepCardsInView();
  }

  /** The call-out, the distance chip and the moving tornado's label slide back inside the visible map area (clear of the panel, bar and dock). */
  private keepCardsInView(): void {
    for (const [marker, selector] of [[this.callout, ".torlab"], [this.distanceLabel, ".chip"], [this.vortex, ".tl"]] as const) {
      const root = marker?.getElement();
      if (root?.isConnected) keepInView(root.querySelector<HTMLElement>(selector));
    }
  }

  /** Push in on the closest pass and draw the line from the address to it. */
  private drawFinale(ms: number, origin: Coord): void {
    const { map } = this.api;
    const { timeline } = this.opts;
    const closest = this.closest;
    const line = map.getSource("dist") as GeoJSONSource | undefined;
    const fk = clamp((ms - timeline.tracksMs) / timeline.finaleMs);

    if (fk > 0 && closest && this.cam0) {
      const k = inOut(clamp(fk / 0.7));
      const near = closest.closest;
      const target = Math.min(13.4, Math.max(10.5, 13.4 - Math.log2(Math.max(1, closest.minDistanceKm / 0.7))));
      const zoom = lerp(this.cam0.zoom, target, k);
      const aim: [number, number] = [lerp(this.cam0.center[0], (origin[1] + near[1]) / 2, k), lerp(this.cam0.center[1], (origin[0] + near[0]) / 2 + 0.0004, k)];
      // On a phone the story panel covers the lower half; aim the closest pass at the free part of the screen.
      map.jumpTo({ center: aim, zoom });
      const reach = clamp((fk - 0.45) / 0.3);
      const tip: [number, number] = [lerp(origin[1], near[1], reach), lerp(origin[0], near[0], reach)];
      line?.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[origin[1], origin[0]], tip] } }] } as never);
      if (reach >= 1) {
        if (!this.distanceLabel!.getElement().isConnected) {
          const box = this.distanceLabel!.getElement().firstElementChild as HTMLElement;
          box.replaceChildren(el("b", { text: `${closest.minDistanceKm.toFixed(2)} km` }), el("span", { text: `Closest: ${closest.ef}, ${niceDate(closest.start)}` }));
          this.distanceLabel!.setLngLat([(origin[1] + near[1]) / 2, (origin[0] + near[0]) / 2]).addTo(map);
        }
      } else {
        this.distanceLabel?.remove();
      }
      this.zoomedIn = true;
    } else {
      line?.setData(EMPTY as never);
      this.distanceLabel?.remove();
      if (this.zoomedIn && this.cam0) map.jumpTo(this.cam0);
      this.zoomedIn = false;
    }
  }

  private pulse(t: NearbyTornado): void {
    if (this.opts.reduced) return;
    const pin = document.querySelector<HTMLElement>(".addr-pin");
    if (!pin) return;
    pin.style.setProperty("--tc", efColor(t.ef));
    pin.classList.remove("tp");
    void pin.offsetWidth;
    pin.classList.add("tp");
    clearTimeout(this.pulseTimer);
    this.pulseTimer = setTimeout(() => pin.classList.remove("tp"), 1900);
    this.opts.onPass?.(t);
  }
}
