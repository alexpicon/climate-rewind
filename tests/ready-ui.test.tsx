import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadyContent } from "@/components/views/ready/ReadyContent";
import { AiProblem } from "@/components/views/ahead/AiProblem";
import { guidanceById } from "@/lib/ready/guidance";
import type { ReadyPayload } from "@/lib/ready/types";

const base: ReadyPayload = {
  state: "ok",
  items: [
    {
      action: "After the Flash Flood report of Mar 27, 2021 near you, never drive through flood waters.",
      why: [{ id: "SE-1265274", label: "Flash Flood report, Mar 27, 2021", hazard: "flood", href: "https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=1265274" }],
      guidance: [guidanceById("flood-turn-around")!],
    },
    { action: "Your record has 11 days at 100°F or more; know where to get cool.", why: [{ id: "local-heat", label: "Hottest day on record, Jun 29, 2012 (feels like 113.3°F)", hazard: "heat" }], guidance: [guidanceById("heat-cool-places")!] },
  ],
  hazards: [{ id: "flood", label: "Flooding", evidence: "2 written NWS flood reports within 5 km on 2 different days, latest Mar 27, 2021" }],
  dropped: 1,
  notices: ["Storm events for the wider area (wind, winter storms, wildfire smoke) are not part of this plan yet."],
  generatedAt: "2026-10-08T00:00:00Z",
  model: "m",
  cached: false,
};

describe("ReadyContent", () => {
  const html = renderToStaticMarkup(<ReadyContent payload={base} problem={null} onPrint={() => undefined} />);

  it("is a checklist: a real checkbox with a label for every item, in an ordered list", () => {
    expect(html).toContain("<ol");
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('for="rd-item-0"');
    expect(html).toContain('id="rd-item-0"');
  });

  it("gives each item its reason with the record's date, a link to the record, and the official line with its source link", () => {
    expect(html).toContain("Why:");
    expect(html).toContain("Flash Flood report, Mar 27, 2021");
    expect(html).toContain('href="https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=1265274"');
    expect(html).toContain("Do not walk, swim or drive through flood waters.");
    expect(html).toContain('href="https://www.ready.gov/floods"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Ready.gov, Floods");
  });

  it("says how many items the checks removed, offers printing, and lists what the record holds", () => {
    expect(html).toContain("1 item the AI wrote was removed");
    expect(html).toContain("Print this plan");
    expect(html).toContain("What your area’s record holds");
    expect(html).toContain("Storm events for the wider area");
  });

  it("the empty state shows the honest line and never a generic plan", () => {
    const empty = renderToStaticMarkup(<ReadyContent payload={{ ...base, state: "empty", items: [], hazards: [], notices: ["Our records hold nothing near this address to build a personal plan from, so we are not writing a generic one."] }} problem={null} />);
    expect(empty).toContain("not writing a generic one");
    expect(empty).not.toContain('type="checkbox"');
  });

  it("when the AI is resting it shows the problem block and still shows the record counted by code", () => {
    const resting = renderToStaticMarkup(
      <ReadyContent
        payload={{ ...base, state: "problem", items: [], problem: { state: "resting", message: "Today's allowance for AI answers is used up." } }}
        problem={<AiProblem result={{ ok: false, state: "resting", message: "Today's allowance for AI answers is used up." }} onRetry={() => undefined} />}
      />,
    );
    expect(resting).toContain("The AI is resting");
    expect(resting).toContain("What your area’s record holds");
    expect(resting).not.toContain('type="checkbox"');
  });
});
