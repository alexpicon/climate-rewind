/**
 * Converts the pipeline's heat file (pipeline/out/heat/<slug>.json, written by heat_grid.py) into the
 * HeatGrid the app loads from data/heat/<slug>.json. Pure and offline; scripts/convert-heat.ts is the CLI.
 *
 * What changes: the app format has no address/point/gridPeak/dropped blocks, `bounds` is just the two ranges
 * (the pipeline also stores rows and cols), values are rounded to 0.1 F, and the file gets a plain-language
 * `label`. Anything malformed throws, so a bad file can never reach data/heat/.
 */
import type { HeatGrid } from "./types";

export interface PipelineHeat {
  slug: string;
  source: string;
  variable: string;
  unit: string;
  days: string[];
  step: number;
  bounds: { lat: [number, number]; lon: [number, number]; rows?: number; cols?: number };
  cells: Array<[number, number, number[]]>;
  gridPeak?: { feelsF: number } | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9-]{1,40}$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export class HeatConvertError extends Error {}

function fail(message: string): never {
  throw new HeatConvertError(message);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRange = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]) && value[0] <= value[1];

/** "2012-06-26" to "2012-07-02" -> "June 26 to July 2, 2012" */
export function weekLabel(first: string, last: string): string {
  const [y1, m1, d1] = first.split("-").map(Number);
  const [y2, m2, d2] = last.split("-").map(Number);
  const start = `${MONTHS[m1 - 1]} ${d1}`;
  const end = m1 === m2 && y1 === y2 ? `${d2}` : `${MONTHS[m2 - 1]} ${d2}`;
  return y1 === y2 ? `${start} to ${end}, ${y1}` : `${start}, ${y1} to ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function convertHeatGrid(input: unknown, options: { place: string }): HeatGrid {
  const raw = input as Partial<PipelineHeat> | null;
  if (!raw || typeof raw !== "object") fail("The heat file is not a JSON object.");
  const place = options.place.trim();
  if (!place) fail("A place name is required for the label.");

  if (typeof raw.slug !== "string" || !SLUG.test(raw.slug)) fail("The heat file has no valid slug (lowercase letters, digits, dashes).");
  if (raw.unit !== "F") fail(`Expected feels-like highs in F, got ${String(raw.unit)}.`);

  const days = raw.days;
  if (!Array.isArray(days) || days.length < 2 || !days.every((d) => typeof d === "string" && ISO_DAY.test(d))) fail("`days` must be a list of two or more YYYY-MM-DD dates.");
  if (days.some((d, i) => i > 0 && d <= days[i - 1])) fail("`days` must be in increasing order.");
  if (!isFiniteNumber(raw.step) || raw.step <= 0) fail("`step` must be a positive number of degrees.");

  const bounds = raw.bounds;
  if (!bounds || !isRange(bounds.lat) || !isRange(bounds.lon)) fail("`bounds` needs lat and lon ranges.");

  if (!Array.isArray(raw.cells) || raw.cells.length === 0) fail("The heat file has no cells.");
  const seen = new Set<string>();
  const cells: HeatGrid["cells"] = [];
  for (const cell of raw.cells) {
    if (!Array.isArray(cell) || cell.length !== 3) fail("Each cell must be [lat, lon, values].");
    const [lat, lon, values] = cell;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) fail("A cell has a non-numeric position.");
    if (lat < bounds.lat[0] || lat > bounds.lat[1] || lon < bounds.lon[0] || lon > bounds.lon[1]) fail(`Cell ${lat},${lon} is outside the bounds.`);
    if (!Array.isArray(values) || values.length !== days.length || !values.every(isFiniteNumber)) fail(`Cell ${lat},${lon} needs one number for each of the ${days.length} days.`);
    const key = `${lat},${lon}`;
    if (seen.has(key)) fail(`Cell ${key} appears twice.`);
    seen.add(key);
    cells.push([lat, lon, values.map(round1)]);
  }
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // The squares drawn must really span the declared range, so the camera lock matches the data.
  const lats = cells.map((c) => c[0]);
  const lons = cells.map((c) => c[1]);
  const spans = [Math.min(...lats) === bounds.lat[0], Math.max(...lats) === bounds.lat[1], Math.min(...lons) === bounds.lon[0], Math.max(...lons) === bounds.lon[1]];
  if (!spans.every(Boolean)) fail("The cells do not reach the declared bounds.");

  const peak = Math.max(...cells.flatMap((c) => c[2]));
  if (raw.gridPeak && isFiniteNumber(raw.gridPeak.feelsF) && Math.abs(raw.gridPeak.feelsF - peak) > 0.11) {
    fail(`The file says the hottest square is ${raw.gridPeak.feelsF} F but the cells peak at ${peak} F.`);
  }

  return {
    slug: raw.slug,
    label: `Heat wave, ${weekLabel(days[0], days[days.length - 1])}, around ${place}`,
    source:
      `${raw.source ?? "Open-Meteo archive API (reanalysis)"}; daily ${raw.variable ?? "apparent_temperature_max"} in F; ` +
      `${raw.step} degree lattice; built by pipeline/heat_grid.py`,
    days,
    step: raw.step,
    bounds: { lon: [bounds.lon[0], bounds.lon[1]], lat: [bounds.lat[0], bounds.lat[1]] },
    cells,
  };
}
