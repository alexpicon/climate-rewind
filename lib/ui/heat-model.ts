/** Pure helpers for the heat view: the regional grid summary, day names and the address series. */
import type { HeatDay, HeatGrid } from "../types";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekday index of an ISO date (the date as written, no timezone shifting). */
export const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

export interface GridCell {
  id: number;
  lat: number;
  lon: number;
  values: number[];
}

export interface GridSummary {
  cells: GridCell[];
  /** The hottest cell for each day. */
  hottestByDay: GridCell[];
  /** Share of cells at 100 F or more, per day, 0 to 1. */
  over100ByDay: number[];
  peak: { value: number; dayIndex: number; cell: GridCell };
  /** Outer edge of the outer squares: [[west, south], [east, north]]. */
  region: [[number, number], [number, number]];
}

export function summarizeGrid(grid: HeatGrid): GridSummary {
  const cells: GridCell[] = grid.cells.map(([lat, lon, values], id) => ({ id, lat, lon, values }));
  const dayCount = grid.days.length;
  const half = grid.step / 2;

  const hottestByDay = Array.from({ length: dayCount }, (_, d) => cells.reduce((best, c) => (c.values[d] > best.values[d] ? c : best), cells[0]));
  const over100ByDay = Array.from({ length: dayCount }, (_, d) => cells.filter((c) => c.values[d] >= 100).length / cells.length);

  let peak = { value: -Infinity, dayIndex: 0, cell: cells[0] };
  hottestByDay.forEach((cell, d) => {
    if (cell.values[d] > peak.value) peak = { value: cell.values[d], dayIndex: d, cell };
  });

  return {
    cells,
    hottestByDay,
    over100ByDay,
    peak,
    region: [
      [grid.bounds.lon[0] - half, grid.bounds.lat[0] - half],
      [grid.bounds.lon[1] + half, grid.bounds.lat[1] + half],
    ],
  };
}

/** Consecutive days at or above 100 F, counting back from day `index`. */
export function streakAt(series: HeatDay[], index: number): number {
  let n = 0;
  for (let i = index; i >= 0 && series[i].feelsF >= 100; i -= 1) n += 1;
  return n;
}
