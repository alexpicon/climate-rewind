/**
 * Converts a pipeline heat file into the app's HeatGrid and writes it to data/heat/<slug>.json.
 *
 *   node scripts/convert-heat.ts --place "San Antonio" [--in pipeline/out/heat/san-antonio.json] [--out data/heat/san-antonio.json]
 *
 * With --in only, the slug comes from the file. Run from the repo root (Node 22.18 or newer runs .ts directly).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { convertHeatGrid, HeatConvertError } from "../lib/heat-convert.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const place = arg("place");
const input = arg("in");
if (!place || !input) {
  console.error('usage: node scripts/convert-heat.ts --in <pipeline heat file> --place "<Place name>" [--out <file>]');
  process.exit(2);
}

try {
  const grid = convertHeatGrid(JSON.parse(readFileSync(input, "utf8")), { place });
  const out = arg("out") ?? path.join("data", "heat", `${grid.slug}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(grid));
  console.log(`${out}: ${grid.cells.length} squares, ${grid.days[0]} to ${grid.days[grid.days.length - 1]}, "${grid.label}"`);
} catch (error) {
  if (error instanceof HeatConvertError) {
    console.error(`Not converted: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
