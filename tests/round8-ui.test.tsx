import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landing } from "@/components/Landing";
import { TopBar } from "@/components/TopBar";
import { MapCaption } from "@/components/map/MapCaption";
import { HistoryNav } from "@/components/panel/HistoryNav";
import { LoadSteps, Pending } from "@/components/panel/LoadSteps";
import { SAMPLE_ADDRESSES } from "@/lib/ui/tabs";
import { tidyAddress } from "@/lib/ui/text";

const noop = () => undefined;

describe("landing: who it is for, then four samples to start with, then your own address", () => {
  const html = renderToStaticMarkup(<Landing input="" onInput={noop} onSubmit={noop} lookingUp={false} error={null} onHow={noop} detectiveRan={false} />);

  it("says who it is for under the headline", () => {
    expect(html).toContain("For anyone renting, buying or living somewhere the climate is changing.");
    expect(html.indexOf("What the weather did to your street.")).toBeLessThan(html.indexOf("For anyone renting"));
  });

  it("puts the four samples, each with its one-line hook, above the search", () => {
    const start = html.indexOf("Start here");
    const search = html.indexOf('id="landing-address"');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(search);
    for (const sample of SAMPLE_ADDRESSES) {
      expect(html.indexOf(sample.label)).toBeGreaterThan(start);
      expect(html.indexOf(sample.label)).toBeLessThan(search);
      expect(html).toContain(sample.hook);
    }
    expect(html).toContain("Hurricane Helene’s floods");
    expect(html).toContain("Flash floods on downtown streets");
    expect(html).toContain("The 2021 heat dome, 115°F feels-like");
    expect(html).toContain("An EF3 tornado passed 0.65 km away");
    expect(html).toContain("Or your own address");
    expect(html).toMatch(/first look takes a few seconds/);
  });

  it("makes each sample a real button", () => {
    expect((html.match(/class="sample-btn"/g) ?? []).length).toBe(4);
  });
});

describe("top bar: four tabs and a small How it works link", () => {
  const bar = (tab: Parameters<typeof TopBar>[0]["tab"]) =>
    renderToStaticMarkup(<TopBar input="" onInput={noop} onSubmit={noop} matched={null} lookingUp={false} tab={tab} address="1 Main St" onTab={noop} live={null} />);

  it("has exactly four tab links, with the history tab opening the story, and How it works outside the tab list", () => {
    const html = bar("ahead");
    const nav = html.slice(html.indexOf('<nav id="tabs"'), html.indexOf("</nav>"));
    expect((nav.match(/<a /g) ?? []).length).toBe(4);
    for (const label of ["Your history", "Next 7 days", "What’s changing", "Get ready"]) expect(nav).toContain(`aria-label="${label}"`);
    expect(nav).toContain("tab=story");
    expect(nav).not.toContain("How it works");
    expect(html).toMatch(/<a id="how-link"[^>]*aria-label="How it works"/);
  });

  it("marks Your history as the current tab for each of its four views, and none for How it works", () => {
    for (const view of ["story", "storm", "heat", "tornado"] as const) {
      const html = bar(view);
      expect(html).toMatch(/aria-label="Your history"[^>]*aria-current="page"|aria-current="page"[^>]*aria-label="Your history"/);
      expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    }
    const how = bar("how");
    expect(how).toMatch(/id="how-link"[^>]*aria-current="page"|aria-current="page"[^>]*id="how-link"/);
    expect(how.slice(how.indexOf('<nav id="tabs"'), how.indexOf("</nav>"))).not.toContain("aria-current");
  });
});

describe("the segmented control in Your history", () => {
  it("is a labelled nav of four links to shareable URLs, the current one marked", () => {
    const html = renderToStaticMarkup(<HistoryNav current="storm" address="1 Main St" />);
    expect(html).toContain('aria-label="Your history: choose a view"');
    expect((html.match(/<a /g) ?? []).length).toBe(4);
    for (const view of ["story", "storm", "heat", "tornado"]) expect(html).toContain(`tab=${view}`);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/aria-current="page">Storm replay</);
  });
});

describe("loading progress", () => {
  it("lists each stage with its state said in words, so a screen reader hears more than a spinner", () => {
    const html = renderToStaticMarkup(
      <LoadSteps
        steps={[
          { id: "a", label: "Finding your address", state: "done", note: "1 Main St" },
          { id: "b", label: "Reading flood and tornado records", state: "active" },
          { id: "c", label: "Writing your brief", state: "wait" },
        ]}
      />,
    );
    expect(html).toContain("Finding your address");
    expect(html).toContain(", done");
    expect(html).toContain(", in progress");
    expect(html).toContain(", waiting");
    expect(html).toContain('data-state="done"');
    expect(html).toContain("1 Main St");
  });

  it("a section that is still being read shows a status line and a skeleton, never a blank hole", () => {
    const html = renderToStaticMarkup(<Pending label="Checking FEMA’s flood map…" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Checking FEMA’s flood map…");
    expect(html).toContain("skeleton");
  });
});

describe("map caption", () => {
  it("names what is drawn and its source, with a button that opens and closes the key", () => {
    const html = renderToStaticMarkup(<MapCaption title="Official outlook areas" summary="Day 1: Slight risk." source="Source: WPC." />);
    expect(html).toContain("Official outlook areas");
    expect(html).toContain("Day 1: Slight risk.");
    expect(html).toContain("Source: WPC.");
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-controls=/);
  });
});

describe("the matched address on the loading list", () => {
  it("is made readable and keeps the state as capitals", () => {
    expect(tidyAddress("1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500")).toBe("1600 Pennsylvania Ave NW, Washington, DC, 20500");
    expect(tidyAddress("450 110TH AVE NE, BELLEVUE, WA, 98004")).toBe("450 110th Ave NE, Bellevue, WA, 98004");
    expect(tidyAddress("100 JAMES ROBERTSON PKWY, NASHVILLE, TN, 37201")).toBe("100 James Robertson Pkwy, Nashville, TN, 37201");
  });
});
