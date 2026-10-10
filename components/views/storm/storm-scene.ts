/**
 * The storm view's map: archived NEXRAD radar, report dots, the city-point stack and the
 * correction pins. Imperative on purpose (MapLibre owns these objects); React drives it by
 * calling update(p) with the animation progress.
 */
import type { GeoJSONSource, ImageSource, Marker } from "maplibre-gl";
import type { MapApi } from "@/components/map/map-context";
import { boxAround, compassWord } from "@/lib/geo";
import { clamp, inOut, lerp, outCubic } from "@/lib/ui/anim";
import { cameraFor, cameraPadding, constrainToBounds, enterCamera, isMobile, unlockCamera, type Camera, type CameraLock } from "@/lib/ui/camera";
import { decorative, el } from "@/lib/ui/dom";
import { LABELS_LAYER, radarCorners, radarFrameUrl } from "@/lib/ui/map-style";
import { camera3D, disable3D, enable3D, FLY_IN_MS, is3D, PITCH_3D, STORM_3D_MAX_ZOOM, STORM_BUILDINGS } from "@/lib/ui/terrain3d";
import { RadarLoader, type RadarProgress } from "@/lib/ui/radar-loader";
import { unplacedShort } from "@/lib/ui/placements";
import { rainBeforeReport, type PixelFrame, type RainLink } from "@/lib/ui/rain-link";
import { CAMERA_SHARE, correctionSlot, currentCorrection, moveProgress, type Correction, type ReplayReport, type StormModel } from "@/lib/ui/storm-model";
import type { Coord } from "@/lib/types";

export type RadarStatus = RadarProgress;

interface SceneOptions {
  model: StormModel;
  origin: Coord;
  reduced: boolean;
  /** Start in the 3D view (terrain and buildings). Toggle later with setView3d. */
  view3d?: boolean;
  onRadar: (status: RadarStatus) => void;
  /** A flood report just popped in during playback. `rain` is set only when the loaded radar shows heavy rain at its spot in the prior hour. */
  onPop?: (report: ReplayReport, rain: RainLink | null) => void;
}

/** See-through enough that streets, rivers and labels read through the rain. */
const RADAR_OPACITY = 0.55;

const PIN_PATH = "M15 38C15 38 2 25 2 14a13 13 0 0 1 26 0c0 11-13 24-13 24z";

function pinSvg(label: string, kind: "solid" | "hollow" | "unknown", verified = false): string {
  const text = (color: string) =>
    `<text x="15" y="19.5" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="15" fill="${color}">${label}</text>`;
  if (kind === "solid") {
    const check = verified
      ? '<g transform="translate(23 8)"><circle r="6.5" fill="#8FE3A7" stroke="#1b1204" stroke-width="1.6"/><path d="M-3.2 .2l2.3 2.3 4-4.4" fill="none" stroke="#1b1204" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>'
      : "";
    return `<svg class="body" viewBox="0 0 30 40" aria-hidden="true"><path d="${PIN_PATH}" fill="#FFB45A" stroke="#1b1204" stroke-width="2"/>${text("#1b1204")}${check}</svg>`;
  }
  const color = kind === "unknown" ? "#E6EAF2" : "#FFB45A";
  const dash = kind === "unknown" ? ' stroke-dasharray="4.5 3"' : "";
  return `<svg class="body" viewBox="0 0 30 40" aria-hidden="true"><path d="${PIN_PATH}" fill="rgba(10,15,27,.82)" stroke="${color}" stroke-width="2.4"${dash}/>${text(color)}</svg>`;
}

const paperSvg = (n: number) =>
  `<span class="paper"><svg viewBox="0 0 44 54" width="44" height="54" aria-hidden="true" focusable="false"><path d="M3 2h27l11 11v39H3z" fill="#F5F0E7" stroke="#1b1204" stroke-width="3" stroke-linejoin="round"/><path d="M30 2v11h11" fill="#CFC6B3" stroke="#1b1204" stroke-width="3" stroke-linejoin="round"/><text x="17" y="26" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="13" fill="#1b1204">No.${n}</text><path d="M9 33h26M9 40h26M9 46h16" stroke="#1b1204" stroke-width="2.6" stroke-linecap="round"/></svg></span>`;

/** The hollow pins fan out to the east of the city point so every number stays readable. */
const deck = (i: number): [number, number] => [10 + i * 26, Math.abs(i - 2) * 3 - 24];

function arcPoint(a: Coord, b: Coord, u: number): [number, number] {
  const dx = b[1] - a[1];
  const dy = b[0] - a[0];
  const len = Math.hypot(dx, dy) || 1;
  const bulge = Math.sin(Math.PI * u) * len * 0.18;
  return [lerp(a[1], b[1], u) - (dy / len) * bulge, lerp(a[0], b[0], u) + (dx / len) * bulge];
}

const arcLine = (a: Coord, b: Coord, e: number): Array<[number, number]> => {
  const n = Math.max(2, Math.ceil(e * 36));
  return Array.from({ length: n + 1 }, (_, k) => arcPoint(a, b, (e * k) / n));
};

interface DotMarker {
  ms: number;
  report: ReplayReport;
  element: HTMLElement;
  marker: Marker;
}

interface PinMarkers {
  correction: Correction;
  ghost: Marker;
  ghostEl: HTMLElement;
  solid: Marker | null;
  solidEl: HTMLElement | null;
}

const toBox = (b: [number, number, number, number]): [[number, number], [number, number]] => [
  [b[0], b[1]],
  [b[2], b[3]],
];

/**
 * The camera lock. On a phone in portrait the screen is taller than the radar box, so a lock to the box alone would pin the
 * house to the middle of the screen, under the panel. The lock is stretched north and south there (the width still fits the box).
 */
const lockBox = (b: [number, number, number, number]): [[number, number], [number, number]] => {
  const stretch = isMobile() ? 2.5 : 0;
  return [
    [b[0], b[1] - stretch],
    [b[2], b[3] + stretch],
  ];
};

export class StormScene {
  private stage: 1 | 2 = 1;
  private dots: DotMarker[] = [];
  private stack: { marker: Marker; element: HTMLElement; core: HTMLElement } | null = null;
  private pins: PinMarkers[] = [];
  /** Step 2 with no detective results: the nearby reports where the NWS filed them, one dot per tier. */
  private filedDots: Marker[] = [];
  private cameras: { replay: Camera | null; correction: Camera | null } = { replay: null, correction: null };
  private lastCamera: Camera | null = null;
  private lastCount = 0;
  private lastRadar = { a: -1, b: -1 };
  private radarReady = new Set<number>();
  private radarLoader: RadarLoader<ImageBitmap> | null = null;
  private radarBitmaps = new Map<number, ImageBitmap>();
  /** What the replay last asked to show, so a frame that arrives late can be drawn at once. */
  private radarView: { p: number; opacity: number } | null = null;
  private cancelCamera: (() => void) | null = null;
  /** The radar stays hidden until the camera has settled on the replay bounds (frames keep loading meanwhile). */
  private settled = false;
  private view3d = false;
  private fitZoom = 7;
  private dead = false;

  constructor(
    private readonly api: MapApi,
    private readonly opts: SceneOptions,
  ) {}

  // ------------------------------------------------------------ lifecycle

  /** The 3D replay camera: pitched, a gentle turn, the address in the free part of the screen. */
  private cam3d(): Camera {
    return { ...camera3D(this.opts.origin, STORM_3D_MAX_ZOOM, -18), padding: cameraPadding() };
  }

  /** The replay camera for the view that is on (3D or 2D). */
  private replayCamera(): Camera | null {
    if (this.view3d) return this.cam3d();
    // The camera the radar-box lock will leave it at, so flights land there instead of landing and then jumping.
    const wanted = cameraFor(this.api.map, toBox(boxAround(this.opts.origin, 90)));
    const flat = wanted ? constrainToBounds(this.api.map, wanted, lockBox(this.opts.model.bounds)) : null;
    return flat ? { ...flat, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } } : null;
  }

  private lock(): CameraLock {
    // The zoom at which the radar box just fills the screen, measured now (the window may have changed size since the view opened).
    const fit = cameraFor(this.api.map, toBox(this.opts.model.bounds), { padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.fitZoom = fit?.zoom ?? this.fitZoom;
    return { bounds: lockBox(this.opts.model.bounds), minZoom: Math.max(5, this.fitZoom), maxZoom: this.view3d ? STORM_3D_MAX_ZOOM : 12.5 };
  }

  enter(): void {
    const { map } = this.api;
    const { model, reduced } = this.opts;

    this.view3d = Boolean(this.opts.view3d);
    if (this.view3d) enable3D(map, { buildings: STORM_BUILDINGS });
    // The lock box is the radar region; the minimum zoom is the one at which that box just fills the screen.
    this.cameras.replay = this.replayCamera();
    const fit = cameraFor(map, toBox(model.bounds), { padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.fitZoom = fit?.zoom ?? 7;
    this.cancelCamera = enterCamera(
      map,
      () => {
        // Measured again when the flight ends, so a resize in between cannot leave the camera somewhere else.
        this.cameras.replay = this.replayCamera() ?? this.cameras.replay;
        return this.cameras.replay;
      },
      () => this.lock(),
      reduced,
      this.view3d ? FLY_IN_MS : 2400,
      () => this.settle(),
    );

    this.buildMarkers();
    this.loadRadar();
  }

  destroy(): void {
    this.dead = true;
    const { map } = this.api;
    this.cancelCamera?.();
    this.radarLoader?.stop();
    this.dots.forEach((d) => d.marker.remove());
    this.stack?.marker.remove();
    for (const pin of this.pins) {
      pin.ghost.remove();
      pin.solid?.remove();
    }
    this.filedDots.forEach((m) => m.remove());
    if (map.getStyle()) {
      for (const id of ["trails-l", ...this.radarIds()]) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of ["trails", ...this.radarIds()]) if (map.getSource(id)) map.removeSource(id);
    }
    for (const bitmap of this.radarBitmaps.values()) bitmap.close();
    this.radarBitmaps.clear();
    this.pixelCache.clear();
    this.rainMemo.clear();
    if (is3D(map)) disable3D(map);
    unlockCamera(map);
  }

  /**
   * Turns the 3D view on or off. On: terrain and buildings appear and the camera slowly flies in, pitched (a jump with reduced motion).
   * Off: the camera flies back to the flat view and the terrain is removed once it arrives. The radar, reports and pins stay as they are.
   */
  setView3d(on: boolean): void {
    if (this.dead || on === this.view3d) return;
    const { map } = this.api;
    const { reduced } = this.opts;
    this.cancelCamera?.();
    this.view3d = on;
    if (on) enable3D(map, { buildings: STORM_BUILDINGS });
    this.setRadarLook();
    this.cameras.replay = this.replayCamera();
    // Step 2 positions the camera itself, with its own offsets for the panel; leave the map's padding out of it.
    const target = this.stage === 2 ? null : this.cameras.replay;
    if (this.stage === 2) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    this.cancelCamera = enterCamera(
      map,
      target ?? { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), pitch: on ? PITCH_3D : 0, bearing: on ? -18 : 0 },
      () => this.lock(),
      reduced,
      on ? FLY_IN_MS : 2400,
      () => {
        if (!this.view3d) disable3D(map);
      },
    );
  }

  // ------------------------------------------------------------ radar

  /** The camera is on the replay bounds: the radar may show now. */
  private settle(): void {
    if (this.dead) return;
    this.settled = true;
    if (this.radarView) this.drawRadar(this.radarView.p, this.radarView.opacity);
  }

  // ---- rain and reports

  private pixelCache = new Map<number, PixelFrame>();
  private rainMemo = new Map<string, { loaded: number; link: RainLink | null }>();
  private scratch: HTMLCanvasElement | null = null;

  /** The pixels of a loaded radar frame, read once and kept for a while (the last 24 frames). */
  private pixelsOf(index: number): PixelFrame | null {
    const cached = this.pixelCache.get(index);
    if (cached) return cached;
    const bitmap = this.radarBitmaps.get(index);
    if (!bitmap) return null;
    this.scratch ??= document.createElement("canvas");
    this.scratch.width = bitmap.width;
    this.scratch.height = bitmap.height;
    const context = this.scratch.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.clearRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    if (this.pixelCache.size >= 24) this.pixelCache.delete(this.pixelCache.keys().next().value as number);
    this.pixelCache.set(index, image);
    return image;
  }

  /**
   * Did heavy rain cross this report's spot in the hour before it was filed? Read from the radar frames already loaded.
   * Null when the radar does not show it, or when the NWS point is only a city-point stand-in (not a real spot).
   */
  rainFor(report: ReplayReport): RainLink | null {
    const precision = report.row.coordPrecision;
    if (precision !== "precise" && precision !== "rounded") return null;
    const loaded = this.radarReady.size;
    const memo = this.rainMemo.get(report.id);
    if (memo && memo.loaded === loaded) return memo.link;
    const { model } = this.opts;
    const link = rainBeforeReport({
      at: report.at,
      ms: report.ms,
      bounds: model.bounds,
      frameTimesMs: model.frameTimes.map((t) => Date.parse(t)),
      frame: (i) => this.pixelsOf(i),
    });
    this.rainMemo.set(report.id, { loaded, link });
    return link;
  }

  private radarIds(): string[] {
    return Array.from({ length: this.opts.model.frameCount }, (_, i) => `rad${i}`);
  }

  /**
   * One image per frame (IEM's time-enabled WMS), loaded a few at a time. Frame 0 goes first and shows at once;
   * playback starts when the first dozen are in and the rest keep loading ahead of it.
   * With reduced motion the replay opens on its last frame, so that one is requested second.
   */
  private loadRadar(): void {
    const { model, reduced, onRadar } = this.opts;
    const total = model.frameCount;
    const order = Array.from({ length: total }, (_, i) => i);
    if (reduced && total > 1) order.splice(1, 0, ...order.splice(total - 1, 1));
    this.radarLoader = new RadarLoader<ImageBitmap>({
      total,
      order,
      fetchFrame: async (index, signal, progress) => {
        const response = await fetch(radarFrameUrl(model.bounds, model.frameTimes[index]), { signal });
        const type = response.headers.get("content-type") ?? "";
        if (!response.ok || !type.startsWith("image/") || !response.body) throw new Error(`radar frame ${index}: HTTP ${response.status}`);
        // Read in chunks so a slow but steady connection keeps the frame alive (the loader only gives up on a stall).
        const reader = response.body.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value as Uint8Array<ArrayBuffer>);
          progress();
        }
        return createImageBitmap(new Blob(chunks, { type }));
      },
      onFrame: (index, bitmap) => this.addRadarFrame(index, bitmap),
      onProgress: (progress) => {
        if (!this.dead) onRadar(progress);
      },
    });
    this.radarLoader.start();
  }

  private addRadarFrame(index: number, bitmap: ImageBitmap | null): void {
    const { map } = this.api;
    if (this.dead || !bitmap) return;
    const id = `rad${index}`;
    map.addSource(id, { type: "image", coordinates: radarCorners(this.opts.model.bounds) } as never);
    (map.getSource(id) as ImageSource).updateImage({ image: bitmap });
    map.addLayer(
      {
        id,
        type: "raster",
        source: id,
        paint: { "raster-opacity": 0, "raster-fade-duration": 0, "raster-resampling": this.view3d ? "nearest" : "linear", "raster-saturation": 0.1, "raster-contrast": 0.08 },
      },
      LABELS_LAYER,
    );
    this.radarBitmaps.set(index, bitmap);
    this.radarReady.add(index);
    // The frame the replay is waiting on may be this one.
    if (this.radarView) this.drawRadar(this.radarView.p, this.radarView.opacity);
  }

  /**
   * 2D smooths the radar. In 3D the map can be tilted and the radar's squares (1 km) get large on screen, so it is drawn with
   * nearest-neighbour sampling: crisp blocks that still look like radar instead of a blurred blob.
   */
  private setRadarLook(): void {
    const { map } = this.api;
    for (const id of this.radarIds()) if (map.getLayer(id)) map.setPaintProperty(id, "raster-resampling", this.view3d ? "nearest" : "linear");
  }

  private setRadarOpacity(index: number, value: number): void {
    const id = `rad${index}`;
    // Opacity only: switching a layer's visibility leaves stale pictures on the terrain in the 3D view.
    if (this.api.map.getLayer(id)) this.api.map.setPaintProperty(id, "raster-opacity", value);
  }

  /** Shows the radar frame for progress p (cross-fading into the next); null hides radar. A frame that is not in yet is skipped. */
  private drawRadar(p: number | null, opacity: number): void {
    const count = this.opts.model.frameCount;
    const hide = (i: number) => i >= 0 && this.setRadarOpacity(i, 0);
    if (p === null) {
      this.radarView = null;
      hide(this.lastRadar.a);
      hide(this.lastRadar.b);
      this.lastRadar = { a: -1, b: -1 };
      return;
    }
    this.radarView = { p, opacity };
    if (!this.settled) {
      // Camera still on its way: remember what to show, show nothing yet.
      hide(this.lastRadar.a);
      hide(this.lastRadar.b);
      this.lastRadar = { a: -1, b: -1 };
      return;
    }
    const exact = p * (count - 1);
    let i = Math.floor(exact);
    let fraction = exact - i;
    if (i >= count - 1) {
      i = count - 1;
      fraction = 0;
    }
    // A frame that is missing or not loaded yet falls back to the nearest earlier one, within half an hour.
    let a = i;
    while (a > 0 && !this.radarReady.has(a) && a > i - 6) a -= 1;
    if (!this.radarReady.has(a)) a = -1;
    const b = fraction > 0 && a >= 0 && this.radarReady.has(i + 1) ? i + 1 : -1;

    if (this.lastRadar.a >= 0 && this.lastRadar.a !== a && this.lastRadar.a !== b) hide(this.lastRadar.a);
    if (this.lastRadar.b >= 0 && this.lastRadar.b !== b && this.lastRadar.b !== a) hide(this.lastRadar.b);
    if (a >= 0) {
      if (b >= 0) {
        this.setRadarOpacity(a, opacity * (1 - fraction));
        this.setRadarOpacity(b, opacity * fraction);
      } else {
        this.setRadarOpacity(a, opacity);
      }
    }
    this.lastRadar = { a, b };
  }

  // ------------------------------------------------------------ markers

  private buildMarkers(): void {
    const { map, gl } = this.api;
    const { model } = this.opts;
    const correctionIds = new Set(model.corrections.map((c) => c.report.id));

    for (const report of model.reports) {
      if (correctionIds.has(report.id)) continue;
      const element = decorative(
        el("div", { className: "rep" }, [el("span", { className: "ring" }), el("span", { className: "ring r2" }), el("span", { className: "dot" })]),
      );
      const marker = new gl.Marker({ element, anchor: "center" }).setLngLat([report.at[1], report.at[0]]).addTo(map);
      this.dots.push({ ms: report.ms, report, element, marker });
    }

    if (!model.canCorrect) {
      this.buildFiledDots();
      return;
    }
    if (!model.cityPoint) return;

    const lngLat: [number, number] = [model.cityPoint[1], model.cityPoint[0]];
    const core = el("span", { className: "core", text: "0" });
    const stackEl = decorative(
      el("div", { className: "stack" }, [
        el("span", { className: "stem" }),
        el("span", { className: "anc" }),
        el("span", { className: "ring" }),
        core,
        el("span", { className: "cap", text: "Hollow: the NWS filed these at one city point" }),
      ]),
    );
    this.stack = { marker: new gl.Marker({ element: stackEl, anchor: "center", offset: [0, -42] }).setLngLat(lngLat).addTo(map), element: stackEl, core };

    this.pins = model.corrections.map((correction, i) => this.buildPin(correction, i, lngLat));
  }

  private buildFiledDots(): void {
    const { map, gl } = this.api;
    for (const report of this.opts.model.filed) {
      const at = report.placed ?? report.filed;
      if (!at) continue;
      const element = decorative(el("div", { className: `fdot ${report.tier}` }, [el("span")]));
      element.style.display = "none";
      this.filedDots.push(new gl.Marker({ element, anchor: "center" }).setLngLat([at[1], at[0]]).addTo(map));
    }
  }

  private showFiledDots(show: boolean): void {
    for (const marker of this.filedDots) marker.getElement().style.display = show ? "block" : "none";
  }

  /** A pin carries its own label; it shows for the active pin and on hover or keyboard focus. */
  private buildPin(correction: Correction, i: number, lngLat: [number, number]): PinMarkers {
    const { map, gl } = this.api;
    const { placement, number } = correction;
    const unknown = placement.dest === null;

    const label = (text: string, sub: string, tag: "Verified" | "Sample" | null) =>
      decorative(
        el("span", { className: "plabel" }, [
          el("b", { text }, tag ? [el("span", { className: `tag ${tag === "Sample" ? "sample" : "real"}`, text: tag })] : []),
          el("span", { text: sub }),
        ]),
      );

    const ghostEl = el("div", { className: `pinm ghost${unknown ? " unk" : ""}`, attrs: { tabindex: "0", role: "img", "aria-label": unknown ? `Report ${number}: ${unplacedShort(placement)} It stays at the city point.` : `Report ${number}, where the NWS filed it: the city point` } }, [
      el("span", { svg: pinSvg(unknown ? "?" : String(number), unknown ? "unknown" : "hollow") }),
    ]);
    ghostEl.style.display = "none";
    const ghost = new gl.Marker({ element: ghostEl, anchor: "center", offset: deck(i) }).setLngLat(lngLat).addTo(map);

    if (unknown || !placement.dest) {
      ghostEl.appendChild(label(`${number} · I don’t know`, unplacedShort(placement), null));
      return { correction, ghost, ghostEl, solid: null, solidEl: null };
    }

    const where = `${correction.km?.toFixed(2)} km ${compassWord(this.opts.origin, placement.dest)} of you`;
    const sample = placement.status === "sample";
    const solidEl = el(
      "div",
      { className: "pinm solid", attrs: { tabindex: "0", role: "img", "aria-label": `Report ${number}, re-filed at ${placement.label}, ${where}${sample ? ". Sample placement." : ""}` } },
      [el("span", { svg: pinSvg(String(number), "solid", placement.status === "verified") + paperSvg(number) }), label(`${number} · ${placement.label}`, where, sample ? "Sample" : "Verified")],
    );
    solidEl.style.display = "none";
    const solid = new gl.Marker({ element: solidEl, anchor: "center", offset: deck(i) }).setLngLat(lngLat).addTo(map);
    return { correction, ghost, ghostEl, solid, solidEl };
  }

  // ------------------------------------------------------------ stages

  setStage(stage: 1 | 2): void {
    if (stage === this.stage && this.cameras.replay && stage === 1) return; // already showing the replay
    this.stage = stage;
    const { map } = this.api;
    const { model, reduced } = this.opts;

    this.showFiledDots(false);
    // In 3D the map's own padding keeps the address clear of the panel; step 2 sets its own offsets, so it drops that padding.
    if (stage === 2 && this.view3d) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });

    if (stage === 1) {
      for (const pin of this.pins) {
        pin.ghostEl.style.display = "none";
        if (pin.solidEl) pin.solidEl.style.display = "none";
      }
      if (map.getLayer("trails-l")) map.removeLayer("trails-l");
      if (map.getSource("trails")) map.removeSource("trails");
      this.lastCamera = null;
      const cam = this.cameras.replay;
      if (cam) {
        if (reduced) map.jumpTo(cam);
        else {
          // The radar comes back once the camera is back on the replay bounds.
          this.settled = false;
          map.flyTo({ ...cam, duration: 1800, essential: false });
          map.once("moveend", () => this.settle());
        }
      }
      return;
    }

    if (!model.canCorrect) {
      // Nothing to move: look at the 5 km around the address, with the filed points shown.
      const [w, s, e, n] = boxAround(this.opts.origin, 5.5);
      const cam = cameraFor(map, [[w, s], [e, n]], { maxZoom: 13.5 });
      this.showFiledDots(true);
      this.lastCamera = null;
      if (cam) {
        if (reduced) map.jumpTo(cam);
        else map.flyTo({ ...cam, duration: 1800, essential: false });
      }
      return;
    }

    const points: Coord[] = [this.opts.origin];
    if (model.cityPoint) points.push(model.cityPoint);
    for (const c of model.corrections) if (c.placement.dest) points.push(c.placement.dest);
    const lats = points.map((q) => q[0]);
    const lons = points.map((q) => q[1]);
    this.cameras.correction = cameraFor(
      map,
      [
        [Math.min(...lons) - 0.02, Math.min(...lats) - 0.02],
        [Math.max(...lons) + 0.02, Math.max(...lats) + 0.02],
      ],
      { maxZoom: 12, padding: isMobile() && window.innerHeight < 520 ? { left: 12, right: 12, top: 70, bottom: 90 } : isMobile() ? { left: 12, right: 12, top: 140, bottom: Math.min(Math.round(window.innerHeight * 0.2) + 385, Math.round(window.innerHeight * 0.75)) } : { left: 470, right: 90, top: 440, bottom: 165 } },
    );
    if (!map.getSource("trails")) {
      map.addSource("trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer(
        { id: "trails-l", type: "line", source: "trails", layout: { "line-cap": "round" }, paint: { "line-color": "#FFB45A", "line-width": 3, "line-dasharray": [1.2, 2], "line-opacity": 0.95 } },
        LABELS_LAYER,
      );
    }
    this.lastCamera = null;
  }

  // ------------------------------------------------------------ drawing

  update(p: number, playing: boolean): void {
    if (this.dead) return;
    if (this.stage === 1) this.drawReplay(p, playing);
    else if (!this.opts.model.canCorrect) this.drawNotRun();
    else this.drawCorrection(p);
  }

  private drawReplay(p: number, playing: boolean): void {
    const { model, reduced } = this.opts;
    const now = model.startMs + p * (model.endMs - model.startMs);
    this.drawRadar(p, RADAR_OPACITY);

    for (const dot of this.dots) {
      const on = dot.ms <= now;
      const wasOn = dot.element.classList.contains("on");
      if (on && !wasOn) {
        dot.element.classList.add("on");
        if (playing && !reduced) {
          dot.element.classList.remove("pop");
          void dot.element.offsetWidth; // restart the ripple
          dot.element.classList.add("pop");
          this.opts.onPop?.(dot.report, this.rainFor(dot.report));
        }
      } else if (!on && wasOn) {
        dot.element.classList.remove("on", "pop", "old");
      }
      dot.element.classList.toggle("old", on && now - dot.ms > 50 * 60_000);
    }

    if (this.stack) {
      const filed = model.corrections.filter((c) => c.report.ms <= now).length;
      if (filed !== this.lastCount) {
        this.stack.core.textContent = String(filed);
        if (filed > this.lastCount && playing && !reduced) {
          this.stack.element.classList.remove("pop");
          void this.stack.element.offsetWidth;
          this.stack.element.classList.add("pop");
        }
        this.lastCount = filed;
      }
      this.stack.element.classList.toggle("on", filed > 0);
    }
  }

  /** Step 2 without detective results: no radar, no replay dots, only the filed points. */
  private drawNotRun(): void {
    this.drawRadar(null, 0);
    for (const dot of this.dots) dot.element.classList.remove("on", "pop");
    this.lastCount = 0;
  }

  private cameraAt(p: number): Camera | null {
    const a = this.cameras.replay;
    const b = this.cameras.correction;
    if (!a || !b) return null;
    const k = inOut(clamp(p / CAMERA_SHARE));
    return { center: [lerp(a.center[0], b.center[0], k), lerp(a.center[1], b.center[1], k)], zoom: lerp(a.zoom, b.zoom, k) };
  }

  private drawCorrection(p: number): void {
    const { map } = this.api;
    const { model, reduced } = this.opts;
    this.drawRadar(null, 0);
    for (const dot of this.dots) dot.element.classList.remove("on", "pop");
    this.stack?.element.classList.remove("on");
    this.lastCount = 0;

    const cam = this.cameraAt(p);
    if (cam && (!this.lastCamera || Math.abs(this.lastCamera.zoom - cam.zoom) > 1e-4 || this.lastCamera.center[0] !== cam.center[0])) {
      map.jumpTo(cam);
      this.lastCamera = cam;
    }

    const count = model.corrections.length;
    const current = currentCorrection(p, count);
    const from = model.cityPoint;
    if (!from) return;
    const trails: unknown[] = [];

    this.pins.forEach((pin, i) => {
      const { start, length } = correctionSlot(i, count);
      const u = clamp((p - start) / length);
      const active = current?.index === i;
      pin.ghostEl.style.display = "block";
      pin.ghostEl.classList.toggle("hot", u > 0 && u < 0.52);
      pin.ghostEl.classList.toggle("active", active && u > 0.7 && !pin.solid);
      pin.ghostEl.querySelector(".body")?.classList.toggle("shake", !pin.solid && u > 0.52 && u < 0.85 && !reduced);

      const dest = pin.correction.placement.dest;
      if (!pin.solid || !pin.solidEl || !dest) return;
      const moved = moveProgress(u);
      pin.solidEl.style.display = moved > 0 ? "block" : "none";
      const eased = inOut(moved);
      const position = moved <= 0 ? ([from[1], from[0]] as [number, number]) : arcPoint(from, dest, eased);
      const startOffset = deck(i);
      // Two pins land close together; nudge them apart so they never overlap.
      const endOffset: [number, number] = i === 1 ? [20, 0] : i === 3 ? [-20, 0] : [0, 0];
      const settle = outCubic(clamp(moved / 0.3));
      pin.solid.setLngLat(position);
      pin.solid.setOffset([lerp(startOffset[0], endOffset[0], settle), lerp(startOffset[1], endOffset[1], settle)]);
      pin.solidEl.classList.toggle("fly", moved > 0 && moved < 1);
      pin.solidEl.classList.toggle("active", active && moved >= 0.92);
      if (moved > 0) trails.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: arcLine(from, dest, eased) } });
    });

    (map.getSource("trails") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: trails } as never);
  }
}
