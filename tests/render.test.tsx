/**
 * Server-rendered markup of the panels, so the words on screen are tested without a browser:
 * the AI line on the landing, the labelled correction number, the honest "detective has not run" state,
 * and tornado deaths and injuries coming from the index row.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landing } from "@/components/Landing";
import { HowStandalone } from "@/components/views/HowView";
import { StormPanel } from "@/components/views/storm/StormPanel";
import { TornadoPanel } from "@/components/views/tornado/TornadoPanel";
import { NightPicker } from "@/components/views/storm/NightPicker";
import { findNearbyFloods, listStormNights, selectReplayNight } from "@/lib/lookup";
import type { LookupPayload, NearbyTornado } from "@/lib/types";
import { buildStormModel, correctionSlot } from "@/lib/ui/storm-model";
import { buildTimeline } from "@/lib/ui/tornado-model";
import { NASHVILLE, flood, tornado } from "./helpers";

const noop = () => undefined;

describe("landing, before any real detective result exists", () => {
  const html = renderToStaticMarkup(<Landing input="" onInput={noop} onSubmit={noop} lookingUp={false} error={null} onHow={noop} detectiveRan={false} />);

  it("says what is true: a detective built to re-file pins, the pre-registered result and its trade-off together", () => {
    expect(html).toContain("An AI detective");
    expect(html).toContain("that reads each report’s words to re-file misplaced pins.");
    expect(html).toContain("In a pre-registered test on 100 fresh reports, the AI detective cut wrong pins from 28% to 2%. It places fewer reports (16% vs 33% within 1 km), because it refuses to guess when a report names only a road.");
    expect(html).not.toContain("re-test is pending");
    expect(html).not.toContain("36% to 8%");
    expect(html).toMatch(/<a href="\/\?tab=how"[^>]*>How it works<\/a>/);
  });

  it("does not claim the detective already moved pins", () => {
    expect(html).not.toContain("moves misfiled flood pins");
    expect(html).not.toContain("An AI flood detective.");
  });

  it("labels the Nashville correction demo as SAMPLE", () => {
    expect(html).toContain("The Nashville storm replay includes a correction demo with hand-made placements");
    expect(html).toContain('<span class="tag sample">Sample</span>');
  });

  it("still has the search, the 4 samples and the honesty line", () => {
    expect(html).toContain('role="search"');
    expect(html).toContain("Nashville, TN");
    expect(html).toContain("Asheville, NC");
    expect(html).toContain("San Antonio, TX");
    expect(html).toContain("Bellevue, WA");
    expect(html).toContain("2021 heat dome");
    expect(html).not.toContain("Kerrville");
    expect(html).toContain("not every flood");
  });
});

describe("landing once real detective results exist", () => {
  const html = renderToStaticMarkup(<Landing input="" onInput={noop} onSubmit={noop} lookingUp={false} error={null} onHow={noop} detectiveRan />);

  it("flips to the plain description of what the detective does", () => {
    expect(html).toContain("An AI flood detective.");
    expect(html).toContain("misfiled flood pins to the street the words name, or says it doesn’t know");
    expect(html).toContain("cut wrong pins from 28% to 2%. It places fewer reports (16% vs 33% within 1 km)");
    expect(html).not.toContain("re-test is pending");
    expect(html).not.toContain("hand-made placements");
  });
});

describe("how it works with no address", () => {
  it("is a full page with a way back, no map needed", () => {
    const html = renderToStaticMarkup(<HowStandalone onBack={noop} detectiveRan={false} />);
    expect(html).toContain("Back to the search");
    expect(html).toMatch(/<a class="backlink" href="\/">/);
  });

  it("says no real detective result exists yet, and keeps the Nashville demo labelled", () => {
    const html = renderToStaticMarkup(<HowStandalone onBack={noop} detectiveRan={false} />);
    expect(html).toContain("An AI flood detective, built to refuse to guess.");
    expect(html).toContain("It has not run on this data yet.");
    expect(html).toContain("No real detective result is on this site yet.");
    expect(html).toContain("hand-made Nashville demo");
    expect(html).not.toContain("An AI flood detective that refuses to guess.");
  });

  it("shows the pre-registered bars with the trade-off beside the headline, and the pilot as a one-line footnote", () => {
    const html = renderToStaticMarkup(<HowStandalone onBack={noop} detectiveRan={false} />);
    expect(html).toContain("Pre-registered test, 100 fresh reports");
    expect(html).toContain("In a pre-registered test on 100 fresh reports, the AI detective cut wrong pins from 28% to 2%.</p><p class=\"bars-claim\">It places fewer reports (16% vs 33% within 1 km), because it refuses to guess when a report names only a road.");
    for (const label of ["Without AI, 28 percent wrong pins", "AI detective, 2 percent wrong pins", "Without AI, 33 percent placed within 1 km", "AI detective, 16 percent placed within 1 km"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain("width:28%");
    expect(html).toContain("width:16%");
    expect(html).toContain("McNemar p = 3e-8");
    expect(html).toContain("No wrong pin was a confident one");
    expect(html).toContain("Pilot: 36% → 8%");
    expect(html).toContain("pipeline/eval/score.json");
    expect(html).not.toMatch(/re-test|Re-test|Sonnet agent|Placement within 1 km was a tie|post-hoc/);
  });

  it("flips its wording when real results exist", () => {
    const html = renderToStaticMarkup(<HowStandalone onBack={noop} detectiveRan />);
    expect(html).toContain("An AI flood detective that refuses to guess.");
    expect(html).not.toContain("No real detective result is on this site yet.");
    expect(html).not.toContain("It has not run on this data yet.");
  });
});

// ---------------------------------------------------------------- the storm panel

const CITY: [number, number] = [36.17, -86.78];
const cityPoint = (id: string, start: string, quote: string) => flood({ id, start, quote, filed: CITY, coordPrecision: "placeholder" });
const NASHVILLE_NIGHT = [
  cityPoint("n1", "2021-03-27T22:55:00-05:00", "ROSA PARKS BLVD UNDERWATER NEAR THE FARMERS MARKET WITH CARS STALLED"),
  cityPoint("n2", "2021-03-27T23:30:00-05:00", "1ST FLOOR OF HOTEL FLOODED AT 95 WALLACE ROAD NEAR I-24 AT HARDING PLACE"),
  cityPoint("n3", "2021-03-27T23:35:00-05:00", "NUMEROUS WATER RESCUES BEING CONDUCTED IN SOUTH NASHVILLE IN OAK HILL AREA AND EDMONDSON PIKE"),
  cityPoint("n4", "2021-03-27T23:55:00-05:00", "FLASH FLOODING AT THE SOUTH BROOKE APARTMENTS ON LINBAR DRIVE. POSSIBLE BUILDING COLLAPSE"),
  cityPoint("n5", "2021-03-28T00:50:00-05:00", "MAJOR FLASH FLOODING ONGOING ACROSS THE SOUTHERN HALF OF NASHVILLE WITH I-40 AND I-24 BOTH"),
];

function payload(rows = NASHVILLE_NIGHT, extra: Partial<LookupPayload> = {}): LookupPayload {
  const floods = findNearbyFloods(rows, NASHVILLE);
  return {
    address: { input: "x", matched: "100 JAMES ROBERTSON PKWY, NASHVILLE, TN, 37201", lat: NASHVILLE[0], lon: NASHVILLE[1], state: "TN", county: "Davidson", city: "NASHVILLE" },
    fema: null,
    live: null,
    floods,
    stormReplay: selectReplayNight(rows, NASHVILLE),
    stormNights: listStormNights(rows, NASHVILLE),
    tornadoes: [],
    heat: null,
    floodTrigger: { status: "insufficient", floodDays: 0, triggerIn: null, history: [], forecast: null, notices: {} },
    coverage: "indexed",
    notices: {},
    ...extra,
  };
}

function panel(data: LookupPayload, stage: 1 | 2, p: number) {
  const model = buildStormModel(data.stormReplay!, data.address, data.floods.reports);
  return {
    model,
    html: renderToStaticMarkup(<StormPanel data={data} model={model} stage={stage} p={p} onStage={noop} replayDate="Mar 27, 2021" zone={model.zone} onNight={async () => ({ ok: false, message: "unused" })} />),
  };
}

describe("the correction step with the Nashville sample placements", () => {
  it("labels the big number: '1 of 5', not a bare 1", () => {
    const data = payload();
    const { model } = panel(data, 2, 0);
    expect(model.detective).toBe("sample");
    const slot = correctionSlot(0, 5);
    const { html } = panel(data, 2, slot.start + slot.length * 0.97); // the first report has just been re-filed
    expect(html).toContain("<span>1</span><small>of 5</small>");
    expect(html).toContain("reports re-filed so far");
    expect(html).toContain('<span class="sr">1 of 5 </span>');
  });

  it("ends on '4 of 5 reports re-filed' with the one that stays put named, and every placement tagged Sample", () => {
    const { html } = panel(payload(), 2, 1);
    expect(html).toContain("<span>4</span><small>of 5</small>");
    expect(html).toContain("reports re-filed from their own words");
    expect(html).toContain("1 stays put: too vague to place.");
    expect(html).toContain("The NWS filed all 5 of these reports at one city point");
    expect(html).toContain('<span class="tag sample">4 Sample</span>');
    expect(html.split('<ol class="dlist">')[1].split("</ol>")[0]).not.toContain("Verified");
  });

  it("names the second step 'Correct the pins' when it can move pins", () => {
    expect(panel(payload(), 2, 0).html).toContain("2 · Correct the pins");
  });
});

describe("step 2 for an address where the detective has not run", () => {
  const rows = [
    flood({ id: "a", start: "2016-06-02T03:25:00-05:00", filed: [29.43, -98.49], coordPrecision: "rounded", quote: "WATER OVER THE ROAD" }),
    flood({ id: "b", start: "2016-06-02T03:40:00-05:00", filed: [29.42, -98.5], coordPrecision: "precise", quote: "STREET FLOODED" }),
    flood({ id: "c", start: "2016-06-02T04:10:00-05:00", filed: [29.4, -98.47], coordPrecision: "placeholder", quote: "FLOODING IN SAN ANTONIO" }),
  ];
  const sanAntonio: [number, number] = [29.4248, -98.4947];
  const data = payload(rows, {
    address: { input: "x", matched: "100 MILITARY PLZ, SAN ANTONIO, TX, 78205", lat: sanAntonio[0], lon: sanAntonio[1], state: "TX", county: "Bexar", city: "SAN ANTONIO" },
    floods: findNearbyFloods(rows, sanAntonio),
    stormReplay: selectReplayNight(rows, sanAntonio),
    stormNights: listStormNights(rows, sanAntonio),
  });

  it("says the AI detective hasn't run for this area yet, and moves nothing", () => {
    const { model, html } = panel(data, 2, 0);
    expect(model.detective).toBe("not-run");
    expect(model.corrections).toEqual([]);
    expect(html).toContain("The AI detective hasn’t run for this area yet.");
    expect(html).toContain("No pin has moved.");
    expect(html).toContain("2 · AI detective");
    expect(html).not.toContain("Correct the pins");
    expect(html).not.toContain("re-filed");
  });

  it("shows the filed points with their precision tiers", () => {
    const { html } = panel(data, 2, 0);
    expect(html).toContain("reports within 5 km, shown where the NWS filed them.");
    expect(html).toContain("<span>3</span>");
    expect(html).toContain("<b>2</b><span>filed at a point (about 1 km)</span>");
    expect(html).toContain("<b>1</b><span>filed at a city point only</span>");
    expect(html).toContain("<b>0</b><span>placed from their words</span>");
    expect(html).toContain("Filed at a city point only"); // in the list and the table
    expect(html).toContain("Nearest reports, as filed");
  });

  it("lists every report in the text version as a table", () => {
    const { html } = panel(data, 1, 0);
    expect(html).toContain("<th scope=\"col\">How it was placed</th>");
    expect(html.match(/<th scope="row">Jun 2, 2016<\/th>/g)).toHaveLength(3);
  });

  it("does not claim the detective has not run when it has", () => {
    const ran = rows.map((r, i) => (i === 0 ? { ...r, detective: { verdict: "unknown" as const, clues: [], match: null, matchType: null, confidence: null, model: "m", ranAt: "x" } } : r));
    const withResult = payload(ran, { floods: findNearbyFloods(ran, sanAntonio), stormReplay: selectReplayNight(ran, sanAntonio), address: data.address });
    const html = panel(withResult, 2, 0).html;
    expect(html).not.toContain("hasn’t run");
  });

  it("with no reports within 5 km, the number is 0 and the sentence says so", () => {
    const none = payload(rows, { floods: { reports: [], tierCounts: { mentioned: 0, about1km: 0, citywide: 0 } }, address: data.address, stormReplay: data.stormReplay });
    const html = panel(none, 2, 0).html;
    expect(html).toContain("<span>0</span>");
    expect(html).toContain("reports within 5 km in the records we have.");
  });
});

// ---------------------------------------------------------------- tornado cards

describe("tornado deaths and injuries come from the index row", () => {
  const nearby = (overrides: Partial<NearbyTornado> & { id: string }): NearbyTornado => ({
    ...tornado(overrides),
    minDistanceKm: 0.65,
    closest: [36.17, -86.8],
    ...overrides,
  });

  function render(t: NearbyTornado) {
    const data = payload([], {});
    const timeline = buildTimeline([t]);
    return renderToStaticMarkup(<TornadoPanel data={data} timeline={timeline} ms={timeline.tracksMs + timeline.finaleMs} closest={t} />);
  }

  it("shows exactly the row's numbers (2 and 170), scoped to the county", () => {
    const html = render(nearby({ id: "SE-882999", ef: "EF3", deaths: 2, injuries: 170, narrative: "A strong tornado. " }));
    expect(html).toContain("2 deaths, 170 injured in this county");
    expect(html).toContain("with 2 deaths and 170 injured recorded for this county’s part of the track");
  });

  it("follows the row when it changes, so nothing is hardcoded", () => {
    const html = render(nearby({ id: "SE-1", ef: "EF2", deaths: 7, injuries: 9 }));
    expect(html).toContain("7 deaths, 9 injured in this county");
    expect(html).not.toContain("170");
    expect(html).not.toContain("220");
  });

  it("says nothing about casualties when the row has none", () => {
    const html = render(nearby({ id: "SE-2", ef: "EF0", deaths: 0, injuries: 0 }));
    expect(html).not.toMatch(/death|injured/);
  });
});

describe("AI-mapped damage places in the tornado card", () => {
  const t: NearbyTornado = { ...tornado({ id: "SE-882999", ef: "EF3", narrative: "EF-2 damage to homes in the Lockeland Springs and Barclay Dr neighborhoods." }), minDistanceKm: 0.65, closest: [36.17, -86.8] };
  const pins = [
    { tornadoId: "SE-882999", place: "Barclay Drive", phrase: "EF-2 damage to homes in the Lockeland Springs and Barclay Dr neighborhoods", ef: "EF2", lat: 36.2005, lon: -86.85, matchType: "street", confidence: "medium" },
    { tornadoId: "SE-882999", place: "Lincoya Hills", phrase: "moved northeast through the Donelson Hills and Lincoya Hills", ef: null, lat: 36.201, lon: -86.82, matchType: "named_area", confidence: "medium" },
    { tornadoId: "SE-1", place: "Elsewhere", phrase: "damage elsewhere", ef: null, lat: 36.2, lon: -86.8, matchType: "street", confidence: "low" },
  ];
  const render = (damage: typeof pins | undefined) => {
    const timeline = buildTimeline([t]);
    return renderToStaticMarkup(<TornadoPanel data={payload([], { damage })} timeline={timeline} ms={timeline.tracksMs + timeline.finaleMs} closest={t} />);
  };

  it("lists the tornado's pins with the survey's own words and the AI label, in the card and in the text version", () => {
    const html = render(pins);
    expect(html).toContain("2 damage places on the map");
    expect(html).toContain("AI-mapped from the NWS survey");
    expect(html).toContain("<b>Barclay Drive (EF2)</b>");
    expect(html).toContain("<q>EF-2 damage to homes in the Lockeland Springs and Barclay Dr neighborhoods</q>");
    expect(html).toContain("pinned where the street meets the track (the exact spot is not stated)");
    expect(html).toContain("centre of the named area");
    expect(html).toContain("Damage places mapped by AI, by tornado");
    expect(html).toContain("3 damage places on the map were mapped by AI from the NWS survey");
  });

  it("says so when a pin lies beyond the end of the drawn line, and not when all are on it", () => {
    const far = [{ ...pins[0], place: "Tuckers Crossroads", lat: 36.18, lon: -86.2 }];
    expect(render(far)).toContain("beyond the end of the line drawn here");
    expect(render(pins.slice(0, 2))).not.toContain("beyond the end of the line");
  });

  it("shows nothing about damage places when the damage mapper has no pins", () => {
    for (const html of [render(undefined), render([])]) {
      expect(html).not.toContain("AI-mapped");
      expect(html).not.toContain("dmg-det");
    }
  });
});




// ---------------------------------------------------------------- the storm nights picker

describe("storm nights picker", () => {
  const nights = [
    { id: "2021-03-28T03:55", date: "2021-03-27", reports: 18, startUtc: "", endUtc: "" },
    { id: "2016-02-03T14:00", date: "2016-02-03", reports: 6, startUtc: "", endUtc: "" },
    { id: "2019-05-01T01:00", date: "2019-05-01", reports: 4, startUtc: "", endUtc: "" },
    { id: "2018-08-01T01:00", date: "2018-08-01", reports: 3, startUtc: "", endUtc: "" },
    { id: "2017-08-01T01:00", date: "2017-08-01", reports: 2, startUtc: "", endUtc: "" },
    { id: "2024-09-27T12:00", date: "2024-09-27", reports: 1 + 1, startUtc: "", endUtc: "" },
  ];
  const html = renderToStaticMarkup(<NightPicker nights={nights} current={nights[0].id} onNight={async () => ({ ok: false, message: "x" })} />);

  it("has a real label and a native select, with a button that waits for a different choice", () => {
    expect(html).toContain('<label id="night-label" for="night-select">Storm nights</label>');
    expect(html).toContain('<select id="night-select"');
    expect(html).toMatch(/<button id="night-go"[^>]*disabled=""[^>]*>Show<\/button>/);
  });

  it("shows each night's date and report count, busiest first, with the busiest selected", () => {
    expect(html).toContain("Mar 27, 2021, 18 reports");
    expect(html).toMatch(/<option value="2021-03-28T03:55" selected="">Mar 27, 2021, 18 reports<\/option>/);
    expect(html).toContain("Feb 3, 2016, 6 reports");
    expect(html).toContain("Sep 27, 2024, 2 reports");
  });

  it("groups the busiest nights and the recent ones", () => {
    expect(html).toContain('<optgroup label="Busiest nights, most reports first">');
    expect(html).toContain('<optgroup label="Recent nights, 2024 and newer">');
    expect(html.split('<optgroup label="Recent')[1]).toContain("Sep 27, 2024");
  });

  it("is not drawn when there is only one night to choose", () => {
    expect(renderToStaticMarkup(<NightPicker nights={nights.slice(0, 1)} current={nights[0].id} onNight={async () => ({ ok: false, message: "x" })} />)).toBe("");
  });

  it("appears in the storm panel", () => {
    const data = payload(NASHVILLE_NIGHT.concat([flood({ id: "old", start: "2016-02-03T14:00:00-06:00", filed: NASHVILLE, quote: "A" }), flood({ id: "old2", start: "2016-02-03T14:20:00-06:00", filed: NASHVILLE, quote: "B" })]));
    expect(data.stormNights.length).toBe(2);
    expect(panel(data, 1, 0).html).toContain("Storm nights");
  });
});

// ---------------------------------------------------------------- your street's flood trigger, and the 3D switch

import { LiveDrawer } from "@/components/live/LiveDrawer";
import { View3DToggle } from "@/components/map/View3DToggle";
import { TriggerCard } from "@/components/panel/TriggerCard";
import { StormLegend } from "@/components/views/storm/StormLegend";
import type { FloodTrigger } from "@/lib/types";

const READY: FloodTrigger = {
  status: "ready",
  floodDays: 3,
  triggerIn: 2.2,
  history: [
    { date: "2021-04-02", rainIn: 2.2 },
    { date: "2021-07-04", rainIn: 1.8 },
    { date: "2021-09-20", rainIn: 2.6 },
  ],
  forecast: {
    days: [
      { date: "2026-10-08", inches: 0 },
      { date: "2026-10-09", inches: 3.1 },
      { date: "2026-10-10", inches: 0.4 },
    ],
    peak: { date: "2026-10-09", inches: 3.1 },
    verdict: "above",
    updated: null,
  },
  notices: {},
};

describe("the flood trigger card", () => {
  it("leads with the comparison, adds the history, and carries the fine print", () => {
    const html = renderToStaticMarkup(<TriggerCard trigger={READY} />);
    expect(html).toContain("Your street’s flood trigger");
    expect(html).toContain("Tomorrow’s official forecast (3.1 in) is above the typical rain on days with flood reports here.");
    expect(html).toContain("On days with flood reports here, the typical rain was 2.2 in.");
    expect(html).not.toContain("as little as");
    expect(html).toContain("Based on NWS reports near this address and ERA5 rainfall; a history-based signal, not a flood forecast.");
    expect(html).toMatch(/<section class="trigger above"[^>]*aria-labelledby="trig-h"/);
  });

  it("keeps the days behind it in a real table, and says the typical rain is their median (no row is singled out as the lowest)", () => {
    const html = renderToStaticMarkup(<TriggerCard trigger={READY} />);
    expect(html).toContain("The days behind this");
    expect(html).toContain('<th scope="col">Flood reports on</th>');
    expect(html).toContain("The typical rain is the median of these days: 2.20 in.");
    expect(html).not.toContain("(lowest)");
    expect(html).toContain("National Weather Service forecast");
  });

  it("says 'not enough history' plainly, with no number and no table", () => {
    const html = renderToStaticMarkup(<TriggerCard trigger={{ status: "insufficient", floodDays: 2, triggerIn: null, history: [], forecast: null, notices: {} }} />);
    expect(html).toContain("Not enough history at this address yet.");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("flood trigger (");
  });

  it("when the forecast service is down, still shows the history and says what is missing", () => {
    const html = renderToStaticMarkup(<TriggerCard trigger={{ ...READY, forecast: null, notices: { forecast: "The National Weather Service forecast returned an error (HTTP 503)." } }} />);
    expect(html).toContain("On days with flood reports here, the typical rain was 2.2 in.");
    expect(html).toContain("HTTP 503");
    expect(html).not.toContain("official forecast (");
  });

  it("never says a flood will happen", () => {
    for (const trigger of [READY, { ...READY, forecast: { ...READY.forecast!, verdict: "below" as const, peak: { date: "2026-10-09", inches: 0.2 } } }]) {
      const text = renderToStaticMarkup(<TriggerCard trigger={trigger} />).toLowerCase();
      expect(text).not.toMatch(/will flood|will be flood|predict/);
    }
  });

  it("is on the storm panel and in the live drawer", () => {
    const data = payload(NASHVILLE_NIGHT, { floodTrigger: READY });
    expect(panel(data, 1, 0).html).toContain("Tomorrow’s official forecast (3.1 in) is above the typical rain on days with flood reports here.");
    const drawer = renderToStaticMarkup(
      <LiveDrawer live={{ state: "calm", alerts: [], checkedAt: Date.parse("2026-10-08T14:00:00Z"), checking: false, refresh: noop }} lat={36.17} lon={-86.78} trigger={READY} onClose={noop} />,
    );
    expect(drawer).toContain("Tomorrow’s official forecast (3.1 in) is above the typical rain on days with flood reports here.");
    expect(drawer).toContain("the typical rain was 2.2 in.");
    expect(drawer).toContain("a history-based signal, not a flood forecast");
  });
});

describe("the key and the 3D switch", () => {
  it("the key explains colours and pins in one line", () => {
    expect(renderToStaticMarkup(<StormLegend stage={1} canCorrect={false} />)).toContain("Colors = rain at that minute. Pins = flood reports people filed. Floods follow the heavy bands.");
  });

  it("the 3D switch is a toggle button whose visible text is in its name, off by default", () => {
    const off = renderToStaticMarkup(<View3DToggle on={false} onToggle={noop} />);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain("<span>3D</span>");
    expect(off).toContain('type="button"');
    expect(off).toMatch(/aria-describedby="[^"]+"/);
    const on = renderToStaticMarkup(<View3DToggle on onToggle={noop} />);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain("Press to go back to the flat map");
    expect(on).not.toContain("aria-label"); // the name is its visible text (WCAG 2.5.3)
  });
});
