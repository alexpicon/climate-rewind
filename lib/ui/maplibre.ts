export type MapLibre = typeof import("maplibre-gl");

let loading: Promise<MapLibre> | null = null;

/** Loads MapLibre in the browser only, once, and points it at the worker we serve from /vendor. */
export function loadMapLibre(): Promise<MapLibre> {
  loading ??= import("maplibre-gl").then((gl) => {
    gl.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
    return gl;
  });
  return loading;
}
