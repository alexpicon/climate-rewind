/**
 * An event replay on the shared map: the camera on the event's box, the archived radar underneath (one image per frame, cross-faded),
 * and a canvas over the map for the wind arrows, the hurricane and the reports, redrawn every frame while it plays.
 */
import type { ImageSource } from "maplibre-gl";
import type { MapApi } from "@/components/map/map-context";
import { cameraFor, cameraPadding, enterCamera, isMobile, unlockCamera } from "@/lib/ui/camera";
import type { EventEntry } from "@/lib/ui/event-catalog";
import { eventFrame, type EventModel } from "@/lib/ui/event-model";
import { LABELS_LAYER, radarCorners, radarFrameUrl } from "@/lib/ui/map-style";
import { RadarLoader, type RadarProgress } from "@/lib/ui/radar-loader";
import { drawReports, drawTrack } from "./event-overlay";
import { drawWindArrows, mercX, mercY, type ScreenFrame } from "./wind-arrows";

export interface SceneState {
  p: number;
  playing: boolean;
  field: "speed" | "gust";
  showRadar: boolean;
}

interface Options {
  model: EventModel;
  entry: EventEntry;
  reduced: boolean;
  onRadar: (progress: RadarProgress) => void;
}

const RADAR_OPACITY = 0.5;

export class EventScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private state: SceneState = { p: 0, playing: false, field: "speed", showRadar: true };
  private dirty = true;
  private raf = 0;
  private last = 0;
  /** Glide and spin clock: it only runs while the replay plays, so a pause stops every motion. */
  private flowSec = 0;
  private dead = false;
  private cancelCamera: (() => void) | null = null;
  private radarLoader: RadarLoader<ImageBitmap> | null = null;
  private readonly radarReady = new Set<number>();
  /** Radar layers showing now, and their opacity. */
  private shownRadar = new Map<number, number>();
  private cssW = 0;
  private cssH = 0;
  readonly radarTimes: number[];
  private readonly onMapChange = () => {
    this.dirty = true;
  };
  private readonly onResize = () => {
    this.size();
    this.dirty = true;
  };

  constructor(
    private readonly api: MapApi,
    private readonly opts: Options,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "ev-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    const { model, entry } = opts;
    const every = entry.radarEveryMin * 60_000;
    this.radarTimes = [];
    for (let t = model.startMs; t <= model.endMs; t += every) this.radarTimes.push(t);
  }

  private get bounds(): [number, number, number, number] {
    const [south, north, west, east] = this.opts.model.pkg.box;
    return [west, south, east, north];
  }

  enter(): void {
    const { map } = this.api;
    map.getCanvasContainer().appendChild(this.canvas);
    this.size();
    map.on("move", this.onMapChange);
    map.on("resize", this.onResize);
    const [west, south, east, north] = this.bounds;
    const box: [[number, number], [number, number]] = [[west, south], [east, north]];
    // A loose lock: MapLibre zooms in until the whole screen is inside the bounds, so tight bounds would crop the event.
    const padX = (east - west) * 1.5;
    const padY = (north - south) * 1.5;
    this.cancelCamera = enterCamera(
      map,
      () => cameraFor(map, box, { padding: cameraPadding() }),
      () => ({ bounds: [[west - padX, south - padY], [east + padX, north + padY]], minZoom: 3.5, maxZoom: 9 }),
      this.opts.reduced,
    );
    this.loadRadar();
    this.raf = requestAnimationFrame(this.tick);
  }

  setState(next: SceneState): void {
    if (next.showRadar !== this.state.showRadar || next.p !== this.state.p) this.dirty = true;
    if (next.field !== this.state.field) this.dirty = true;
    this.state = next;
    this.drawRadar();
  }

  leave(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.cancelCamera?.();
    this.radarLoader?.stop();
    const { map } = this.api;
    map.off("move", this.onMapChange);
    map.off("resize", this.onResize);
    this.canvas.remove();
    for (let i = 0; i < this.radarTimes.length; i += 1) {
      if (map.getLayer(`evrad${i}`)) map.removeLayer(`evrad${i}`);
      if (map.getSource(`evrad${i}`)) map.removeSource(`evrad${i}`);
    }
    unlockCamera(map);
  }

  private size(): void {
    const el = this.api.map.getCanvas();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = el.clientWidth;
    this.cssH = el.clientHeight;
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
  }

  private readonly tick = (now: number) => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.last ? Math.min(80, now - this.last) / 1000 : 0;
    this.last = now;
    const moving = this.state.playing && !this.opts.reduced;
    if (moving) this.flowSec += dt;
    if (!moving && !this.dirty) return;
    this.dirty = false;
    this.draw();
  };

  private screenFrame(): ScreenFrame {
    const { map } = this.api;
    const centre = map.getCenter();
    const at = map.project(centre);
    return {
      width: this.cssW,
      height: this.cssH,
      world: 512 * 2 ** map.getZoom(),
      cx: mercX(centre.lng),
      cy: mercY(centre.lat),
      px: at.x,
      py: at.y,
    };
  }

  private draw(): void {
    const { model, entry, reduced } = this.opts;
    const ctx = this.ctx;
    const f = this.screenFrame();
    const dpr = this.canvas.width / Math.max(1, f.width);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.width, f.height);
    const frame = eventFrame(model, this.state.p);
    const moving = this.state.playing && !reduced;
    drawWindArrows(ctx, model, frame.hourF, f, { field: this.state.field, flowSec: moving ? this.flowSec : null, spacingPx: isMobile() ? 26 : 22 });
    drawTrack(ctx, model, frame, f, reduced ? 0 : this.flowSec, entry.offsetMin);
    drawReports(ctx, model, frame, f, !reduced);
  }

  // ------------------------------------------------------------ radar

  private loadRadar(): void {
    const total = this.radarTimes.length;
    const order = Array.from({ length: total }, (_, i) => i);
    // Reduced motion opens on the last frame, so that one comes second.
    if (this.opts.reduced && total > 1) order.splice(1, 0, ...order.splice(total - 1, 1));
    this.radarLoader = new RadarLoader<ImageBitmap>({
      total,
      order,
      fetchFrame: async (index, signal, progress) => {
        const iso = new Date(this.radarTimes[index]).toISOString().replace(".000Z", "Z");
        const response = await fetch(radarFrameUrl(this.bounds, iso), { signal });
        const type = response.headers.get("content-type") ?? "";
        if (!response.ok || !type.startsWith("image/")) throw new Error(`radar frame ${index}: HTTP ${response.status}`);
        progress();
        return createImageBitmap(await response.blob());
      },
      onFrame: (index, bitmap) => this.addRadarFrame(index, bitmap),
      onProgress: (progress) => {
        if (!this.dead) this.opts.onRadar(progress);
      },
    });
    this.radarLoader.start();
  }

  private addRadarFrame(index: number, bitmap: ImageBitmap | null): void {
    const { map } = this.api;
    if (this.dead || !bitmap) return;
    const id = `evrad${index}`;
    map.addSource(id, { type: "image", coordinates: radarCorners(this.bounds) } as never);
    (map.getSource(id) as ImageSource).updateImage({ image: bitmap });
    map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-fade-duration": 0 } }, LABELS_LAYER);
    this.radarReady.add(index);
    this.drawRadar();
  }

  /** The radar frame at the replay's time, cross-faded into the next; a frame not in yet falls back to the nearest earlier one. */
  private drawRadar(): void {
    const { map } = this.api;
    const ms = this.opts.model.startMs + this.state.p * (this.opts.model.endMs - this.opts.model.startMs);
    const every = this.opts.entry.radarEveryMin * 60_000;
    const exact = Math.min(this.radarTimes.length - 1, Math.max(0, (ms - this.radarTimes[0]) / every));
    const i = Math.floor(exact);
    let a = i;
    while (a > 0 && !this.radarReady.has(a) && a > i - 4) a -= 1;
    const want: Array<[number, number]> = [];
    if (this.state.showRadar && this.radarReady.has(a)) {
      const b = i + 1;
      // The cross-fade moves in tenths: every opacity change repaints the whole map, so it should not happen every frame.
      const k = Math.round((exact - i) * 10) / 10;
      if (a === i && this.radarReady.has(b) && k > 0) want.push([a, 1 - k], [b, k]);
      else want.push([a, 1]);
    }
    const next = new Map(want.map(([idx, w]) => [idx, RADAR_OPACITY * w]));
    for (const idx of this.shownRadar.keys()) if (!next.has(idx) && map.getLayer(`evrad${idx}`)) map.setPaintProperty(`evrad${idx}`, "raster-opacity", 0);
    for (const [idx, value] of next) if (this.shownRadar.get(idx) !== value) map.setPaintProperty(`evrad${idx}`, "raster-opacity", value);
    this.shownRadar = next;
  }
}
