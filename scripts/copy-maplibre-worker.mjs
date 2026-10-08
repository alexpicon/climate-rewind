// MapLibre 6 runs its tile and GeoJSON work in a module worker. Bundlers do not emit that file
// reliably, so we serve it ourselves from /vendor and point MapLibre at it (see lib/ui/maplibre.ts).
// Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/vendor", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/vendor/maplibre-gl-worker.mjs");
console.log("copied maplibre-gl-worker.mjs to public/vendor");
