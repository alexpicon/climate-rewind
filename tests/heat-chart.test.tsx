/** The heat tab's days-per-year chart (components/views/heat/HeatChart.tsx), including a place that never reached 100°F. */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeatChart } from "@/components/views/heat/HeatChart";

const years = (counts: number[]) => Object.fromEntries(counts.map((n, i) => [String(2000 + i), n]));

describe("HeatChart", () => {
  afterEach(() => vi.restoreAllMocks());

  it("labels a flat record once and says so, without duplicate keys", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = renderToStaticMarkup(<HeatChart byYear={years(new Array(26).fill(0))} hottestYear="2021" />);
    expect(errors).not.toHaveBeenCalled();
    expect(html).toContain("2000 to 2025: 0 days every year.");
    expect(html).not.toContain("Most:");
    // One bar label, plus the three year labels.
    expect(html.match(/font-weight="700"/g)).toHaveLength(1);
  });

  it("names the most and the fewest when they differ", () => {
    const html = renderToStaticMarkup(<HeatChart byYear={years([0, 3, 7, 1])} hottestYear="2002" />);
    expect(html).toContain("Most: 7 days in 2002. Fewest: 0 days in 2000.");
    expect(html.match(/font-weight="700"/g)).toHaveLength(2);
  });
});
