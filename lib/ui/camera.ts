import type { LngLatBoundsLike, Map as MapLibreMap, PaddingOptions } from "maplibre-gl";

/** The panel on the left is 404 px wide with 20 px margins (see prototype.css). */
export function isMobile(): boolean {
  return window.innerWidth <= 900;
}

const ZERO: Required<PaddingOptions> = { top: 0, bottom: 0, left: 0, right: 0 };

/** The old fixed estimates, used only until the real UI is on the page (and in tests with no DOM). */
function estimatedPadding(): PaddingOptions {
  if (isMobile() && window.innerHeight >= 520) return { left: 12, right: 12, top: 84, bottom: Math.min(Math.round(window.innerHeight * 0.34) + 200, Math.round(window.innerHeight * 0.6)) };
  if (isMobile()) return { left: 12, right: 12, top: 70, bottom: 90 };
  return { left: 404 + 20 * 2 + 16, right: 28, top: 72 + 30, bottom: 190 };
}

function visibleRect(id: string | Element | null): DOMRect | null {
  const node = typeof id === "string" ? document.getElementById(id) : id;
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/**
 * Padding that keeps the interesting part of the map in the VISIBLE area, measured from the real UI:
 * left = the panel's right edge + 24 (on a phone the panel is a bottom sheet, so bottom = its height), top = the top bar + 16,
 * bottom = the dock (and on a phone the tab bar) + 16, right = 24, and the top also clears the map-caption card while it is collapsed.
 */
export function cameraPadding(_sheet = false): PaddingOptions {
  if (typeof window === "undefined" || typeof document === "undefined") return ZERO;
  const bar = visibleRect("bar");
  if (!bar) return estimatedPadding();
  const [W, H] = [window.innerWidth, window.innerHeight];
  const mobile = isMobile();
  let top = Math.round(bar.bottom + 16);
  let bottom = 16;
  let left = mobile ? 12 : 24;
  const right = mobile ? 12 : 24;
  const panel = visibleRect("panel");
  if (panel) {
    if (mobile) bottom = Math.max(bottom, H - panel.top + 16);
    else left = Math.max(left, panel.right + 24);
  }
  const dock = visibleRect("dock");
  if (dock) bottom = Math.max(bottom, H - dock.top + 16);
  const tabs = mobile ? visibleRect("tabs") : null;
  if (tabs) bottom = Math.max(bottom, H - tabs.top + 16);
  const cap = visibleRect(document.querySelector(".mapcap"));
  // The caption card sits over the top of the map (taller when open): keep clear of it as long as enough height is left for the map.
  if (cap && cap.top < H / 2 && H - Math.round(cap.bottom + 12) - bottom >= 280) top = Math.max(top, Math.round(cap.bottom + 12));
  // On a short or narrow screen the stack must not eat the whole canvas, or no camera fits.
  if (H - top - bottom < 160) bottom = Math.max(16, H - top - 160);
  if (H - top - bottom < 160) top = Math.max(16, H - bottom - 160);
  if (W - left - right < 200) left = Math.max(12, W - right - 200);
  return { top, bottom: Math.round(bottom), left: Math.round(left), right };
}

const waiting = new WeakSet<MapLibreMap>();
const appliedReal = new WeakMap<MapLibreMap, Required<PaddingOptions>>();
const SIDES = ["top", "bottom", "left", "right"] as const;

/**
 * Puts the real UI padding on the map. It adds only what changed since last time, so a temporary extra (the pre-roll card's shift)
 * survives. With the padding set, the map's centre is the centre of the visible area, MapLibre's max-bounds lock works on that area
 * and a camera that centres a point puts it in the middle of what the visitor can see.
 */
export function syncPadding(map: MapLibreMap, force = false): void {
  if (typeof map.setPadding !== "function") return;
  const read = (): Required<PaddingOptions> => ({ ...ZERO, ...(typeof map.getPadding === "function" ? map.getPadding() : ZERO) });
  // setPadding is a jump: in the middle of a flight or an ease it would cut the move short. Wait for it to end.
  if (!force && typeof map.isMoving === "function" && map.isMoving()) {
    if (!waiting.has(map)) {
      waiting.add(map);
      map.once("moveend", () => {
        waiting.delete(map);
        syncPadding(map);
      });
    }
    return;
  }
  const real = { ...ZERO, ...cameraPadding() };
  const prev = force ? ZERO : (appliedReal.get(map) ?? ZERO);
  const cur = force ? ZERO : read();
  const next = { ...ZERO };
  for (const side of SIDES) next[side] = Math.max(0, Math.round(cur[side] + real[side] - prev[side]));
  appliedReal.set(map, real);
  const now = read();
  if (force || SIDES.some((side) => now[side] !== next[side])) map.setPadding(next);
}

/** Keeps the map's padding on the real UI as it changes (resize, tab change, panel or dock opening and closing). Returns a stop. */
export function watchPadding(map: MapLibreMap): () => void {
  let raf = 0;
  const run = () => {
    raf = 0;
    try {
      attach();
      syncPadding(map);
    } catch {
      // the map was torn down
    }
  };
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(run);
  };
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(queue);
  const watched = new Set<Element>();
  const attach = () => {
    for (const node of document.querySelectorAll("#bar, #panel, #dock, #tabs, .mapcap")) {
      if (!watched.has(node)) {
        watched.add(node);
        resizeObserver?.observe(node);
      }
    }
    for (const node of [...watched]) if (!node.isConnected) {
      watched.delete(node);
      resizeObserver?.unobserve(node);
    }
  };
  const hook = new MutationObserver(queue);
  hook.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
  window.addEventListener("resize", queue);
  window.addEventListener("orientationchange", queue);
  attach();
  syncPadding(map);
  return () => {
    cancelAnimationFrame(raf);
    hook.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener("resize", queue);
    window.removeEventListener("orientationchange", queue);
  };
}

/** The rectangle (viewport pixels) that hover and popup cards must stay inside: clear of the panel, the top bar and the dock. */
export function safeRect(): { left: number; top: number; right: number; bottom: number } {
  const p = cameraPadding();
  return { left: (p.left ?? 0) - 16, top: (p.top ?? 0) - 8, right: window.innerWidth - (p.right ?? 0) + 16, bottom: window.innerHeight - (p.bottom ?? 0) + 8 };
}

/** Slides a card (with CSS `translate`, so its own transform is untouched) back inside the visible map area. */
export function keepInView(box: HTMLElement | null | undefined): void {
  if (!box || !box.isConnected) return;
  if (box.style.translate) box.style.translate = "";
  const r = box.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const s = safeRect();
  let dx = 0;
  let dy = 0;
  if (r.right > s.right) dx = s.right - r.right;
  if (r.left + dx < s.left) dx = s.left - r.left;
  if (r.bottom > s.bottom) dy = s.bottom - r.bottom;
  if (r.top + dy < s.top) dy = s.top - r.top;
  if (dx || dy) box.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}

export interface Camera {
  center: [number, number];
  zoom: number;
  /** Only the 3D view sets these. A flight or jump carries them along; 2D cameras leave them out (and keep the current ones). */
  pitch?: number;
  bearing?: number;
  padding?: PaddingOptions;
}

export const isFiniteCamera = (cam: Camera): boolean => Number.isFinite(cam.zoom) && Number.isFinite(cam.center[0]) && Number.isFinite(cam.center[1]);

export function cameraFor(map: MapLibreMap, bounds: LngLatBoundsLike, extra: { padding?: PaddingOptions; maxZoom?: number } = {}): Camera | null {
  // maxZoom must be left out entirely when unset: an explicit undefined makes MapLibre return NaN.
  // On a very short screen the padding can leave no room for the box and MapLibre returns nothing; try again with half the padding.
  // The map's own padding (the real UI, see syncPadding) already keeps the camera in the visible area; `extra.padding` is only added on top of it.
  syncPadding(map);
  let padding: PaddingOptions = { ...ZERO, ...extra.padding };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const cam = map.cameraForBounds(bounds, { padding, ...(extra.maxZoom !== undefined ? { maxZoom: extra.maxZoom } : {}) });
    if (cam) {
      const center = cam.center as { lng: number; lat: number } | [number, number];
      const result: Camera = { center: Array.isArray(center) ? [center[0], center[1]] : [center.lng, center.lat], zoom: cam.zoom ?? map.getZoom() };
      // A map that is not laid out yet (or a box that cannot fit) can come back as NaN; never hand that to a flight.
      if (isFiniteCamera(result)) return result;
    }
    padding = {
      top: Math.round((padding.top ?? 0) / 2),
      bottom: Math.round((padding.bottom ?? 0) / 2),
      left: Math.round((padding.left ?? 0) / 2),
      right: Math.round((padding.right ?? 0) / 2),
    };
  }
  return null;
}

export interface CameraLock {
  bounds: LngLatBoundsLike | null;
  minZoom: number;
  maxZoom: number;
}

/** Boxes the camera in so the visitor can never pan or zoom past the data. */
export function lockCamera(map: MapLibreMap, lock: CameraLock): void {
  map.setMinZoom(lock.minZoom);
  map.setMaxZoom(lock.maxZoom);
  map.setMaxBounds(lock.bounds ?? undefined);
  map.fire("move");
}

export function unlockCamera(map: MapLibreMap): void {
  map.setMaxBounds(undefined);
  map.setMinZoom(3);
  map.setMaxZoom(14);
}

const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
const unmercX = (x: number) => x * 360 - 180;
const unmercY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/**
 * The camera MapLibre's max-bounds lock would turn `cam` into: zoomed in until the box covers the whole canvas, centre kept inside it.
 * Flying to a camera the lock will move anyway lands with a visible jump; flying to this one lands where the lock leaves it.
 * Only for flat (unpitched) cameras and boxes given as [[west, south], [east, north]].
 */
export function constrainToBounds(map: MapLibreMap, cam: Camera, bounds: LngLatBoundsLike | null): Camera {
  if (!bounds || !Array.isArray(bounds) || (cam.pitch ?? 0) > 0) return cam;
  const corners = bounds as unknown[];
  if (corners.length !== 2 || !Array.isArray(corners[0]) || !Array.isArray(corners[1])) return cam;
  const [[west, south], [east, north]] = bounds as [[number, number], [number, number]];
  const canvas = map.getCanvas();
  // The lock works on the visible (padded) area, and the camera centre is the centre of that area.
  const pad = typeof map.getPadding === "function" ? { ...ZERO, ...map.getPadding() } : ZERO;
  const width = canvas.clientWidth - pad.left - pad.right;
  const height = canvas.clientHeight - pad.top - pad.bottom;
  const [x0, x1, yTop, yBottom] = [mercX(west), mercX(east), mercY(north), mercY(south)];
  if (!(width > 0 && height > 0 && x1 > x0 && yBottom > yTop)) return cam;
  const cover = Math.log2(Math.max(width / ((x1 - x0) * 512), height / ((yBottom - yTop) * 512)));
  const zoom = Math.max(cam.zoom, cover);
  const world = 512 * 2 ** zoom;
  const [halfW, halfH] = [width / 2 / world, height / 2 / world];
  const clamp = (value: number, low: number, high: number) => (low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value)));
  const [wantedX, wantedY] = [mercX(cam.center[0]), mercY(cam.center[1])];
  const x = clamp(wantedX, x0 + halfW, x1 - halfW);
  const y = clamp(wantedY, yTop + halfH, yBottom - halfH);
  // Already inside the lock: hand back the very same camera (no rounding from the round trip).
  if (zoom === cam.zoom && Math.abs(x - wantedX) < 1e-12 && Math.abs(y - wantedY) < 1e-12) return cam;
  return { ...cam, zoom, center: [unmercX(x), unmercY(y)] };
}

/** Maps that have had their first camera placed. Until then the map is hidden, so the visitor never sees the placeholder world view. */
const placed = new WeakSet<MapLibreMap>();
const placedListeners = new WeakMap<MapLibreMap, Set<() => void>>();

/** Runs `fn` when the map's first camera is placed (at once if it already is). Returns an unsubscribe. */
export function onPlaced(map: MapLibreMap, fn: () => void): () => void {
  if (placed.has(map)) {
    fn();
    return () => undefined;
  }
  const set = placedListeners.get(map) ?? new Set<() => void>();
  set.add(fn);
  placedListeners.set(map, set);
  return () => set.delete(fn);
}

export function isPlaced(map: MapLibreMap): boolean {
  return placed.has(map);
}

/** Called once some view has put the camera where it belongs. Tells the canvas it can fade the map in. */
export function markPlaced(map: MapLibreMap): void {
  if (placed.has(map)) return;
  placed.add(map);
  for (const fn of placedListeners.get(map) ?? []) fn();
  placedListeners.delete(map);
}

/** How close (in screen pixels) the camera must be to its target to count as arrived. */
const ARRIVED_PX = 6;

/** True when the map camera is at `cam` (same zoom, centre within a few pixels). */
export function cameraIsAt(map: MapLibreMap, cam: Camera): boolean {
  if (Math.abs(map.getZoom() - cam.zoom) > 0.03) return false;
  if (cam.pitch !== undefined && Math.abs(map.getPitch() - cam.pitch) > 0.5) return false;
  if (cam.bearing !== undefined && Math.abs(map.getBearing() - cam.bearing) > 0.5) return false;
  const here = map.getCenter();
  const degreesPerPixel = 360 / (512 * 2 ** cam.zoom);
  return Math.abs(here.lng - cam.center[0]) < ARRIVED_PX * degreesPerPixel && Math.abs(here.lat - cam.center[1]) < ARRIVED_PX * degreesPerPixel;
}

type CameraSource = Camera | null | (() => Camera | null);

/** Waits (up to `maxMs`) for the map's container to have a real size, then runs `go`. A zero-size map yields NaN cameras. */
function whenSized(map: MapLibreMap, go: () => void, maxMs = 3000): () => void {
  let stopped = false;
  let waited = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (stopped) return;
    const canvas = map.getCanvas();
    if ((canvas.clientWidth >= 40 && canvas.clientHeight >= 40) || waited >= maxMs) {
      go();
      return;
    }
    waited += 100;
    timer = setTimeout(check, 100);
  };
  check();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/**
 * Moves to a camera, then locks. Returns a cleanup that cancels a pending lock.
 *
 * The first camera of a page load (cold load, reload, shared link) is a jump: the map starts hidden on a placeholder world view and
 * must never be seen flying in from it. Later calls fly (a jump when motion is reduced). Whatever interrupts a flight (a scroll, a resize,
 * another effect), the camera is checked when it stops and put on the target if it is not there, then the lock is applied.
 * `cam` may be a function so the target is measured again at the end, after any resize. `onSettled` runs once the camera is where it belongs.
 */
export function enterCamera(
  map: MapLibreMap,
  cam: CameraSource,
  lockSource: CameraLock | (() => CameraLock),
  reduced: boolean,
  duration = 2200,
  onSettled?: () => void,
): () => void {
  unlockCamera(map);
  syncPadding(map);
  let cancelled = false;
  let finished = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let stopWatching: (() => void) | null = null;
  const lock = (): CameraLock => (typeof lockSource === "function" ? lockSource() : lockSource);
  const resolve = (): Camera | null => {
    const value = typeof cam === "function" ? cam() : cam;
    return value && isFiniteCamera(value) ? constrainToBounds(map, value, lock().bounds) : null;
  };
  const finish = () => {
    if (cancelled || finished) return;
    finished = true;
    clearTimeout(fallback);
    map.off("moveend", onMoveEnd);
    const target = resolve();
    if (target) {
      if (!cameraIsAt(map, target)) map.jumpTo(target);
    } else {
      const bounds = lock().bounds;
      if (bounds) map.fitBounds(bounds, { padding: 0, duration: 0 });
    }
    lockCamera(map, lock());
    markPlaced(map);
    stopWatching = watchLayout(map, resolve, lock);
    onSettled?.();
  };
  const onMoveEnd = () => finish();

  const stopWaiting = whenSized(map, () => {
    if (cancelled) return;
    // The camera is measured against the map's size, so make sure the map has read the container's current size first.
    map.resize();
    const target = resolve();
    if (!target) {
      finish();
      return;
    }
    if (reduced || duration === 0 || !isPlaced(map) || cameraIsAt(map, target)) {
      map.jumpTo(target);
      finish();
      return;
    }
    map.flyTo({ ...target, duration, curve: 1.4, essential: false, easing: (t) => 1 - (1 - t) ** 3 });
    map.on("moveend", onMoveEnd);
    // If the flight never reports back (a hidden tab, a stalled frame loop), put the camera there anyway.
    fallback = setTimeout(finish, duration + 1500);
  });

  return () => {
    cancelled = true;
    stopWaiting();
    clearTimeout(fallback);
    map.off("moveend", onMoveEnd);
    stopWatching?.();
  };
}

/** How long after arriving a change of the map's size is still treated as part of the page settling (late CSS, a toolbar, devtools). */
const LAYOUT_SETTLE_MS = 3000;

/**
 * Just after a view has placed the camera, the page may still be settling: stylesheets arriving late, a scrollbar, devtools opening.
 * Any resize in that window re-measures the target and puts the camera on it (a jump, since nothing has been seen yet), then
 * re-applies the lock for the new size. It stops after a few seconds, and at once when the visitor moves the map themselves.
 */
function watchLayout(map: MapLibreMap, resolve: () => Camera | null, lock: () => CameraLock): () => void {
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    map.off("resize", onResize);
    map.off("dragstart", stop);
    map.off("wheel", stop);
    map.off("touchstart", stop);
  };
  const onResize = () => {
    const target = resolve();
    if (!target || cameraIsAt(map, target)) return;
    unlockCamera(map);
    map.jumpTo(target);
    lockCamera(map, lock());
  };
  const timer = setTimeout(stop, LAYOUT_SETTLE_MS);
  map.on("resize", onResize);
  map.on("dragstart", stop);
  map.on("wheel", stop);
  map.on("touchstart", stop);
  return stop;
}
