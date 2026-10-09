/**
 * The Albers equal-area conic projection for the lower 48 (standard parallels 29.5 and 45.5 N, centred on 37.5 N, 96 W): the
 * familiar shape of a US national map, with areas kept true so a dense patch of tracks is a dense patch on the ground.
 */

const RAD = Math.PI / 180;
const PHI1 = 29.5 * RAD;
const PHI2 = 45.5 * RAD;
const PHI0 = 37.5 * RAD;
const LAMBDA0 = -96 * RAD;
const N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2;
const C = Math.cos(PHI1) ** 2 + 2 * N * Math.sin(PHI1);
const RHO0 = Math.sqrt(C - 2 * N * Math.sin(PHI0)) / N;

/** Projected [x, y] of a point, in units of the earth's radius, with y growing north. */
export function albers(lat: number, lon: number): [number, number] {
  const rho = Math.sqrt(C - 2 * N * Math.sin(lat * RAD)) / N;
  const theta = N * (lon * RAD - LAMBDA0);
  return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)];
}

export interface Fit {
  /** Screen [x, y] of a point (y grows down, as on a canvas). */
  toScreen: (lat: number, lon: number) => [number, number];
  scale: number;
}

/** The lower 48's projected bounds (from its corners and its widest parallel), so the fit does not depend on the data drawn. */
const BOUNDS = (() => {
  const points = [
    [24.5, -125], [24.5, -66.9], [49.4, -125], [49.4, -66.9], [49.4, -96], [24.5, -96], [45, -125], [45, -66.9], [37, -125], [37, -66.9],
  ].map(([lat, lon]) => albers(lat, lon));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
})();

/**
 * Fits the lower 48 into a width by height box with a margin (a fraction of the smaller side), centred. `anchor` moves the map
 * right of centre (0.5 is centred, 1 hugs the right edge) so a column of text can sit on its left.
 */
export function fitLower48(width: number, height: number, margin = 0.06, anchor = 0.5): Fit {
  const pad = Math.min(width, height) * margin;
  const spanX = BOUNDS.maxX - BOUNDS.minX;
  const spanY = BOUNDS.maxY - BOUNDS.minY;
  const scale = Math.max(0, Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY));
  const offsetX = pad + (width - 2 * pad - spanX * scale) * anchor;
  const offsetY = pad + (height - 2 * pad - spanY * scale) / 2;
  return {
    scale,
    toScreen: (lat, lon) => {
      const [x, y] = albers(lat, lon);
      return [offsetX + (x - BOUNDS.minX) * scale, offsetY + (BOUNDS.maxY - y) * scale];
    },
  };
}

/** Fits a lat/lon box (south, north, west, east) into a width by height area with a margin in pixels, centred. */
export function fitBox(width: number, height: number, box: { south: number; north: number; west: number; east: number }, margin = 12): Fit {
  const corners = [
    albers(box.south, box.west),
    albers(box.south, box.east),
    albers(box.north, box.west),
    albers(box.north, box.east),
    albers(box.north, (box.west + box.east) / 2),
  ];
  const minX = Math.min(...corners.map((c) => c[0]));
  const maxX = Math.max(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  const maxY = Math.max(...corners.map((c) => c[1]));
  const scale = Math.max(0, Math.min((width - 2 * margin) / (maxX - minX), (height - 2 * margin) / (maxY - minY)));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  return {
    scale,
    toScreen: (lat, lon) => {
      const [x, y] = albers(lat, lon);
      return [offsetX + (x - minX) * scale, offsetY + (maxY - y) * scale];
    },
  };
}
