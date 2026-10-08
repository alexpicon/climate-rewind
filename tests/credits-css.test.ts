/**
 * The map credits button: a 44 px target at phone width, mounted outside #map so a panel or the tab bar cannot cover it.
 * (Browser-checked in Round 6: the button is the top element at its centre at 390 px on the 72-hour, heat and storm tabs.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "calm.css"), "utf8");
const canvas = readFileSync(path.join(process.cwd(), "components", "map", "MapCanvas.tsx"), "utf8");

describe("the map credits button", () => {
  it("is 44 by 44 at phone width and sits under the top bar, clear of the tab bar", () => {
    const phone = css.slice(css.indexOf("#map-credits{position:fixed"));
    expect(phone).toContain("@media (max-width:900px){");
    expect(phone).toMatch(/#map-credits \.maplibregl-ctrl-attrib \.maplibregl-ctrl-attrib-button\{width:44px!important;height:44px!important/);
    expect(phone).toMatch(/#map-credits\{top:calc\(var\(--bar-h\) \+ 8px\);bottom:auto/);
  });

  it("is mounted in its own element above the panels, not inside the map's layer", () => {
    expect(canvas).toContain('id="map-credits"');
    expect(canvas).toContain("credits.onAdd(map)");
    expect(canvas).toContain('role="region" aria-label="Map credits"');
    expect(canvas).not.toContain('addControl(new gl.AttributionControl');
    expect(css).toMatch(/#map-credits\{position:fixed;right:0;bottom:0;z-index:15\}/);
  });
});
