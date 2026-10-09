/** "What you'll see" on the landing page (lib/ui/landing-features.ts): each tile's example is a real sample on a real view. */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landing } from "@/components/Landing";
import { featureSample, LANDING_FEATURES } from "@/lib/ui/landing-features";
import { lightningFileFor, type LightningIndex } from "@/lib/ui/lightning";
import { VISIBLE_TABS } from "@/lib/ui/tabs";

describe("the feature tiles", () => {
  it("each opens a sample address on a view the app shows", () => {
    for (const feature of LANDING_FEATURES) {
      const sample = featureSample(feature);
      expect(sample, feature.id).not.toBeNull();
      expect(VISIBLE_TABS).toContain(feature.tab);
      expect(sample!.tab).toBe(feature.tab);
    }
  });

  it("the storm tile promises lightning only on a night that has it shipped", () => {
    const storm = LANDING_FEATURES.find((f) => f.id === "storm")!;
    expect(storm.body).toContain("On the sample nights, lightning seen from space");
    const sample = featureSample(storm)!;
    const index = JSON.parse(readFileSync("public/data/lightning/index.json", "utf8")) as LightningIndex;
    const snapshot = JSON.parse(readFileSync("data/samples/san-antonio.json", "utf8")) as { lat: number; lon: number };
    expect(sample.night).toBe("2021-05-01T18:05");
    expect(lightningFileFor(index, snapshot.lat, snapshot.lon, sample.night)).not.toBeNull();
  });

  it("the landing page shows every tile with its example button, in its own chunk after the first screen's search, with a sticky search bar", () => {
    const html = renderToStaticMarkup(<Landing input="" onInput={() => undefined} onSubmit={() => undefined} lookingUp={false} error={null} onHow={() => undefined} detectiveRan />);
    for (const feature of LANDING_FEATURES) expect(html).toContain(feature.title);
    expect(html.match(/class="feat-go"/g)).toHaveLength(LANDING_FEATURES.length);
    expect(html.indexOf("What you’ll see")).toBeGreaterThan(html.indexOf('id="landing-address"'));
    expect(html).toContain('id="lbar-address"');
    expect(html.match(/<section id="ch-/g)?.length).toBe(7);
    expect(html).toContain("from floods and tornadoes to heat, wind, ice and");
  });
});
