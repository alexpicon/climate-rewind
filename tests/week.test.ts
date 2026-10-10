import { beforeEach, describe, expect, it } from "vitest";
import { AnswerCache, RateLimiter, TokenBudget } from "@/lib/ai/guard";
import type { AiDeps } from "@/lib/ai/service";
import type { AiAnswer } from "@/lib/ai/types";
import type { OutlookPayload } from "@/lib/outlook-types";
import type { HeatDay } from "@/lib/types";
import { GUIDANCE } from "@/lib/ready/guidance";
import { allowedGuidance, officialActions, verifyWeekActions, type ActionDay } from "@/lib/week/actions";
import { buildWeekBase, clearWeekCache, withActions, type WeekDeps } from "@/lib/week/build";
import { classifyDay, floodLevel, heatLevel, stormLevel, windLevel } from "@/lib/week/classify";
import { weekFromGrid } from "@/lib/week/forecast";
import { dayHeading, quietDetail } from "@/lib/week/format";
import { beforeLine, heatClimate, heatClimateLine, lastAtLeast, yearlyCounts, type LocalRecord } from "@/lib/week/history";
import type { DayForecast, DayOfficial } from "@/lib/week/types";
import { fakeClient, modelReply } from "./ai-fixtures";

const NO_OFFICIAL: DayOfficial = { heatRisk: null, ero: null, spc: null };
const calm = (over: Partial<DayForecast> = {}): DayForecast => ({ date: "2026-10-10", highF: 75, lowF: 58, feelsF: 75, rainChance: 10, rainIn: 0, snowIn: 0, gustMph: 12, words: "Sunny", ...over });

describe("which days are notable", () => {
  it("leaves an ordinary day quiet", () => {
    expect(classifyDay(calm(), NO_OFFICIAL, 3)).toEqual([]);
    // Marginal rain risk and a 1% tornado chance are not worth a card
    expect(classifyDay(calm(), { heatRisk: 1, ero: "MRGL", spc: { percent: 0, kind: "tornado" } }, 0)).toEqual([]);
  });

  it("flags heat from HeatRisk Moderate or a 100 F feels-like, and says it in plain words", () => {
    expect(heatLevel(99, 1)).toBe(0);
    expect(heatLevel(99, 2)).toBe(1);
    expect(heatLevel(104, 0)).toBe(1);
    expect(heatLevel(105, null)).toBe(2);
    expect(heatLevel(90, 4)).toBe(3);
    const [heat] = classifyDay(calm({ feelsF: 104.4 }), { ...NO_OFFICIAL, heatRisk: 3 }, 2);
    expect(heat.kind).toBe("heat");
    expect(heat.level).toBe(2);
    expect(heat.plain).toContain("104°F");
    // no jargon on the main line; the official names are in the small source text
    expect(heat.plain).not.toMatch(/HeatRisk|NWS|WPC|SPC/);
    expect(heat.source).toContain("NWS HeatRisk: Major (level 3 of 4)");
  });

  it("flags rain from a Slight risk or an inch of forecast rain", () => {
    expect(floodLevel("MRGL", 0.2)).toBe(0);
    expect(floodLevel("SLGT", 0)).toBe(1);
    expect(floodLevel("MDT", null)).toBe(3);
    expect(floodLevel(null, 1.2)).toBe(1);
    expect(floodLevel(null, 3)).toBe(2);
    const [rain] = classifyDay(calm({ rainIn: 0.77 }), { ...NO_OFFICIAL, ero: "SLGT" }, 1);
    expect(rain.plain).toContain("About 0.8 in of rain");
    expect(rain.plain).not.toMatch(/Excessive|WPC|Slight/);
    expect(rain.source).toContain("Excessive Rainfall Outlook, Day 2: Slight risk");
  });

  it("flags storms by the SPC percent (Days 1-2 tornado, Day 3 any severe) and wind by gusts", () => {
    expect(stormLevel({ percent: 2, kind: "tornado" })).toBe(1);
    expect(stormLevel({ percent: 5, kind: "tornado" })).toBe(2);
    expect(stormLevel({ percent: 10, kind: "tornado" })).toBe(3);
    expect(stormLevel({ percent: 5, kind: "severe" })).toBe(0);
    expect(stormLevel({ percent: 15, kind: "severe" })).toBe(1);
    expect(stormLevel(null)).toBe(0);
    expect(windLevel(44)).toBe(0);
    expect(windLevel(45)).toBe(1);
    expect(windLevel(66)).toBe(3);
    const hazards = classifyDay(calm({ gustMph: 52 }), { ...NO_OFFICIAL, spc: { percent: 5, kind: "tornado" } }, 0);
    // worst first
    expect(hazards.map((h) => h.kind)).toEqual(["storm", "wind"]);
  });
});

describe("the NWS grid to seven local days", () => {
  const hours = (start: string, count: number, value: number) => ({ validTime: `${start}/PT${count}H`, value });
  const grid = {
    temperature: { values: [hours("2026-10-10T05:00:00+00:00", 24, 20), hours("2026-10-11T05:00:00+00:00", 5, 30)] },
    apparentTemperature: { values: [hours("2026-10-10T05:00:00+00:00", 24, 25), hours("2026-10-10T20:00:00+00:00", 2, 40)] },
    quantitativePrecipitation: { values: [hours("2026-10-10T05:00:00+00:00", 6, 12.7)] },
    probabilityOfPrecipitation: { values: [hours("2026-10-10T05:00:00+00:00", 24, 40)] },
    windGust: { values: [hours("2026-10-10T05:00:00+00:00", 24, 64.4)] },
  };

  it("converts to F, inches and mph, and leaves a barely covered day empty rather than calling it calm", () => {
    const days = weekFromGrid(grid, [{ startTime: "2026-10-10T06:00:00-05:00", isDaytime: true, shortForecast: "Showers And Thunderstorms" }], "America/Chicago", new Date("2026-10-10T12:00:00Z"), 3);
    expect(days.map((d) => d.date)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(days[0]).toMatchObject({ highF: 68, lowF: 68, rainIn: 0.5, rainChance: 40, gustMph: 40, words: "Showers And Thunderstorms" });
    expect(days[0].feelsF).toBe(104);
    // October 11 has only 5 hours of grid (fewer than the minimum) and October 12 has none, so nothing is claimed for them
    expect(days[1]).toMatchObject({ highF: null, rainIn: null });
    expect(days[2]).toMatchObject({ highF: null, rainIn: null, gustMph: null, words: null });
  });
});

describe("decade averages and the trend rule", () => {
  /** One value per day for each year; `hotDays(year)` days of that year reach 100 F. */
  function history(hotDays: (year: number) => number, from = 2000, to = 2025): HeatDay[] {
    const days: HeatDay[] = [];
    for (let year = from; year <= to; year += 1) {
      const hot = hotDays(year);
      for (let d = 0; d < 365; d += 1) {
        const date = new Date(Date.UTC(year, 0, 1 + d)).toISOString().slice(0, 10);
        days.push({ date, feelsF: d < hot ? 101 : 80 });
      }
    }
    return days;
  }

  it("counts days at or above the threshold per year, skipping years with too little data", () => {
    const days = [...history(() => 3, 2001, 2001), ...history(() => 3, 2002, 2002).slice(0, 100)];
    const counts = yearlyCounts(days, 100);
    expect(counts.get(2001)).toBe(3);
    expect(counts.has(2002)).toBe(false);
  });

  it("states both decade averages and claims no trend when the counts do not trend", () => {
    const flat = history((year) => (year % 2 === 0 ? 4 : 6));
    const climate = heatClimate(flat, 100);
    expect(climate).toMatchObject({ first: 5, last: 5, trend: "none" });
    const line = heatClimateLine(flat, 100.9) as string;
    expect(line).toBe("Days this hot (feels like 100°F or more) averaged 5 a year here in 2000–2009 and 5 a year in 2016–2025.");
    expect(line).not.toMatch(/trend/i);
  });

  it("mentions a trend only when Mann-Kendall says p < 0.05", () => {
    const rising = history((year) => (year - 2000) * 2);
    expect(heatClimate(rising, 100)?.trend).toBe("increasing");
    expect(heatClimateLine(rising, 100)).toContain("clear upward trend");
    // a lot of noise with a tiny drift: the averages differ, the test does not call it
    const noisy = history((year) => [9, 1, 8, 2, 7, 3, 9, 0, 6, 4, 8, 1, 7, 2, 9, 3, 6, 5, 8, 2, 7, 4, 9, 1, 8, 3][year - 2000]);
    expect(heatClimate(noisy, 100)?.trend).toBe("none");
  });

  it("says nothing when the history is too short or no day was ever this hot", () => {
    expect(heatClimateLine(history(() => 5, 2010, 2025), 100)).toBeNull();
    expect(heatClimateLine(history(() => 0), 110)).toBeNull();
    expect(heatClimateLine(null, 100)).toBeNull();
    expect(heatClimateLine(history(() => 5), null)).toBeNull();
  });

  it("finds the last time it was this hot", () => {
    const days: HeatDay[] = [
      { date: "2021-06-28", feelsF: 114.7 },
      { date: "2023-08-01", feelsF: 103.9 },
      { date: "2024-07-04", feelsF: 99 },
    ];
    expect(lastAtLeast(days, 104)).toBe("2021-06-28");
    expect(lastAtLeast(days, 103)).toBe("2023-08-01");
    expect(lastAtLeast(days, 120)).toBeNull();
  });
});

describe("what it meant here before", () => {
  const record = (over: Partial<LocalRecord> = {}): LocalRecord => ({ heatDays: null, floodRecord: null, tornadoRecord: null, floods: [], tornadoes: [], events: [], ...over });
  const floodRecord = { radiusKm: 10, window: { start: "2016-01-01", end: "2025-12-31" }, byCategory: { none: { days: 3000, hitDays: 100 }, MRGL: { days: 400, hitDays: 20 }, SLGT: { days: 118, hitDays: 10 }, MDT: { days: 5, hitDays: 2 }, HIGH: { days: 0, hitDays: 0 } } } as never;

  it("uses the existing outlook track record, with its own counts", () => {
    const line = beforeLine({ kind: "flood" }, calm(), { ...NO_OFFICIAL, ero: "SLGT" }, record({ floodRecord }));
    expect(line).toBe("On 10 of 118 past Slight-risk days here, flooding was reported within 10 km.");
    expect(beforeLine({ kind: "flood" }, calm(), { ...NO_OFFICIAL, ero: "MDT" }, record({ floodRecord }))).toContain("On 2 of 5 past Moderate-risk days");
    expect(beforeLine({ kind: "flood" }, calm(), { ...NO_OFFICIAL, ero: "MDT" }, record({ floodRecord }))).toContain("too few days");
  });

  it("falls back to the most recent real event, and to nothing", () => {
    const events = [
      { id: "a", type: "Flash Flood", start: "2022-05-01T10:00:00-05:00", area: { kind: "C", code: "TNC037", name: "Davidson" } },
      { id: "b", type: "Flash Flood", start: "2023-04-03T10:00:00-05:00", area: { kind: "C", code: "TNC037", name: "Davidson" } },
      { id: "c", type: "High Wind", start: "2024-01-12T10:00:00-05:00", area: { kind: "C", code: "TNC037", name: "Davidson" } },
    ] as never;
    expect(beforeLine({ kind: "flood" }, calm(), { ...NO_OFFICIAL, ero: "SLGT" }, record({ events }))).toBe("The most recent flooding the NWS recorded for this area was a flash flood on Apr 3, 2023.");
    expect(beforeLine({ kind: "wind" }, calm(), NO_OFFICIAL, record({ events }))).toBe("The most recent high wind the NWS recorded for this area was on Jan 12, 2024.");
    expect(beforeLine({ kind: "wind" }, calm(), NO_OFFICIAL, record())).toBeNull();
    expect(beforeLine({ kind: "storm" }, calm(), { ...NO_OFFICIAL, spc: { percent: 2, kind: "tornado" } }, record())).toBeNull();
  });

  it("names the last hot day, or says there was none in the records", () => {
    const heatDays: HeatDay[] = [{ date: "2021-06-28", feelsF: 114.7 }, { date: "2000-01-01", feelsF: 40 }];
    expect(beforeLine({ kind: "heat" }, calm({ feelsF: 104.6 }), NO_OFFICIAL, record({ heatDays }))).toBe("The last time it felt like 104°F or more here was Jun 28, 2021.");
    expect(beforeLine({ kind: "heat" }, calm({ feelsF: 120 }), NO_OFFICIAL, record({ heatDays }))).toBe("Our records since 2000 show no day when it felt like 120°F or more here.");
    expect(beforeLine({ kind: "heat" }, calm({ feelsF: 104 }), NO_OFFICIAL, record())).toBeNull();
  });
});

describe("the actions the AI writes", () => {
  const days: ActionDay[] = [
    { date: "2026-10-10", when: "tomorrow", kinds: ["flood"], expect: "Heavy rain could flood streets." },
    { date: "2026-10-13", when: "Tuesday", kinds: ["heat"], expect: "It will feel like 104°F." },
  ];

  it("keeps an action that cites an offered guidance line and shows OUR line as the source", () => {
    const out = verifyWeekActions({ days: [{ date: "2026-10-10", actions: [{ text: "Tomorrow, do not drive through flood waters; turn around instead.", guidance: ["flood-turn-around"] }] }] }, days);
    const kept = out.byDate.get("2026-10-10") ?? [];
    expect(kept).toHaveLength(1);
    expect(kept[0].guidance[0]).toMatchObject({ id: "flood-turn-around", source: "Ready.gov, Floods" });
    expect(out.dropped).toBe(0);
  });

  it("drops anything uncited, mis-cited, over-cited or with a number the guidance does not contain", () => {
    const out = verifyWeekActions(
      {
        days: [
          {
            date: "2026-10-10",
            actions: [
              { text: "Move your car to higher ground tomorrow.", guidance: [] },
              { text: "Keep a fan running all day tomorrow.", guidance: ["heat-fan"] },
              { text: "Turn around at flooded roads tomorrow.", guidance: ["made-up-id"] },
              { text: "Leave within 30 minutes of the first alert.", guidance: ["flood-turn-around"] },
              { text: "Stay out of flood waters tomorrow, as six inches of moving water can knock you down.", guidance: ["flood-turn-around", "flood-six-inches", "flood-nws-cars"] },
              { text: "Stay out of flood waters, as six inches of moving water can knock you down.", guidance: ["flood-six-inches"] },
            ],
          },
          { date: "2026-10-20", actions: [{ text: "A day that is not on the page at all.", guidance: ["flood-turn-around"] }] },
        ],
      },
      days,
    );
    // only the last item of the first day is good
    expect(out.byDate.get("2026-10-10")?.map((a) => a.guidance[0].id)).toEqual(["flood-six-inches"]);
    expect(out.byDate.has("2026-10-20")).toBe(false);
    expect(out.dropped).toBe(6);
  });

  it("keeps at most three per day and no repeats, and ignores replies that are not the right shape", () => {
    const action = (n: number) => ({ text: `Check on neighbors and older adults, this ${["morning", "evening", "weekend", "week"][n]}.`, guidance: ["heat-check-on"] });
    const out = verifyWeekActions({ days: [{ date: "2026-10-13", actions: [action(0), action(0), action(1), action(2), action(3)] }] }, days);
    expect(out.byDate.get("2026-10-13")).toHaveLength(3);
    expect(verifyWeekActions("nonsense", days).byDate.size).toBe(0);
    expect(verifyWeekActions({ days: "no" }, days).byDate.size).toBe(0);
  });

  it("offers each day only the guidance for its own hazards", () => {
    const flood = allowedGuidance(["flood"]).map((g) => g.id);
    expect(flood).toContain("flood-turn-around");
    expect(flood).not.toContain("heat-fan");
    expect(allowedGuidance(["heat"]).map((g) => g.id)).toContain("outage-food");
  });

  it("has official lines, word for word, for when the AI is not answering", () => {
    const lines = officialActions(["heat", "flood"]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) expect(GUIDANCE.find((g) => g.id === line.guidance[0].id)?.text).toBe(line.text);
  });
});

describe("day headings", () => {
  it("names today, tomorrow and then the weekday", () => {
    expect(dayHeading(0, "2026-10-09")).toMatchObject({ label: "Today", full: "Friday, Oct 9", dateText: "Friday, Oct 9" });
    expect(dayHeading(1, "2026-10-10").label).toBe("Tomorrow");
    expect(dayHeading(4, "2026-10-13")).toMatchObject({ label: "Tuesday", dateText: "Oct 13" });
    expect(quietDetail(calm({ words: "MOSTLY SUNNY" }))).toBe("Mostly sunny · 75° / 58°");
    expect(quietDetail(calm({ words: null, highF: null, lowF: null }))).toBe("Forecast not available yet");
  });
});

// ---------------------------------------------------------------- the whole thing, with a fake network and a fake model

const NOW = Date.parse("2026-10-10T15:00:00Z");

function fixtureFetch(url: string): Promise<Response> {
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  if (url.includes("/points/")) return json({ properties: { forecast: "https://api.weather.gov/gridpoints/X/1,1/forecast", forecastGridData: "https://api.weather.gov/gridpoints/X/1,1", timeZone: "America/Chicago" } });
  if (url.endsWith("/forecast")) return json({ properties: { periods: [{ startTime: "2026-10-10T07:00:00-05:00", isDaytime: true, shortForecast: "Sunny" }] } });
  if (url.includes("gridpoints/X/1,1")) {
    const hourly = (c: number) => ({ values: [{ validTime: "2026-10-10T05:00:00+00:00/PT168H", value: c }] });
    // 40 C = 104 F feels-like on every hour: every day is a hot day
    return json({ properties: { temperature: hourly(35), apparentTemperature: hourly(40), probabilityOfPrecipitation: hourly(0), quantitativePrecipitation: hourly(0), windGust: hourly(10), snowfallAmount: hourly(0) } });
  }
  if (url.includes("NWS_HeatRisk")) return json({ value: "3" });
  throw new Error(`unexpected fetch ${url}`);
}

const outlook: OutlookPayload = {
  checkedAt: new Date(NOW).toISOString(),
  recordSlug: null,
  flood: { days: [{ day: 1, date: "2026-10-09", level: "none" }, { day: 2, date: "2026-10-10", level: "none" }, { day: 3, date: "2026-10-11", level: "none" }], record: null },
  tornado: { days: [{ day: 1, date: "2026-10-09", kind: "tornado", percent: 0 }, { day: 2, date: "2026-10-10", kind: "tornado", percent: 0 }, { day: 3, date: "2026-10-11", kind: "severe", percent: 0 }], record: null },
  heat: { risk: null, forecast: null, hasHistory: false, notices: {} },
  recordNotice: null,
};

function weekDeps(reply: unknown, over: Partial<WeekDeps> = {}) {
  const client = fakeClient(() => modelReply(reply));
  const ai = { client, budget: new TokenBudget(1_000_000), limiter: new RateLimiter(10, 60_000), cache: new AnswerCache<AiAnswer>(), now: () => NOW } as unknown as AiDeps;
  const deps: WeekDeps = {
    fetch: fixtureFetch as never,
    now: () => new Date(NOW),
    outlook: async () => outlook,
    record: async () => ({ input: { indexed: true, floods: [], tornadoes: [], heat: null, events: [] }, notices: [] }),
    heatDays: async () => [{ date: "2021-06-28", feelsF: 105 }],
    ai: () => ai,
    ...over,
  };
  return { deps, calls: client.calls };
}

beforeEach(() => clearWeekCache());

describe("the week, end to end with no network", () => {
  it("builds seven cards, marks the hot days, and keeps only actions that cite official guidance", async () => {
    const reply = {
      days: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-10-${String(10 + i)}`,
        actions: [
          { text: "Check on family members, older adults and neighbors.", guidance: ["heat-check-on"] },
          { text: "A line that cites nothing is removed.", guidance: [] },
        ],
      })),
    };
    const { deps, calls } = weekDeps(reply);
    const base = await buildWeekBase(36.1682, -86.7775, "TN", deps);
    expect(base.state).toBe("ok");
    expect(base.days).toHaveLength(7);
    expect(base.days[0].date).toBe("2026-10-10");
    expect(base.days.every((d) => d.notable && d.hazards[0].kind === "heat")).toBe(true);
    expect(base.days[0].hazards[0].before).toBe("The last time it felt like 104°F or more here was Jun 28, 2021.");
    expect(calls).toHaveLength(0);

    const done = await withActions(base, deps, "36.168,-86.778");
    expect(done.refuse).toBeUndefined();
    // ONE model call for all the days
    expect(calls).toHaveLength(1);
    expect(done.payload.ai.state).toBe("ok");
    expect(done.payload.ai.dropped).toBe(7);
    expect(done.payload.days.find((d) => d.date === "2026-10-10")?.actions.map((a) => a.guidance[0].id)).toEqual(["heat-check-on"]);
    expect(done.payload.days.find((d) => d.date === "2026-10-10")?.actionsFrom).toBe("ai");

    // the same set of notable days within the hour: no second call
    const again = await withActions(base, deps, "36.168,-86.778");
    expect(calls).toHaveLength(1);
    expect(again.payload.ai.cached).toBe(true);
    expect(again.payload.days[3].actions).toHaveLength(1);
  });

  it("shows the official lines when the AI is off or answers nothing usable", async () => {
    const off = weekDeps({ days: [] });
    const base = await buildWeekBase(36.1682, -86.7775, "TN", off.deps);
    const offOutcome = await withActions(base, { ...off.deps, ai: () => ({ ...off.deps.ai(), client: null }) as AiDeps }, "x", () => ({ status: 503, body: { state: "unavailable", message: "off" } }));
    expect(offOutcome.payload.ai.state).toBe("problem");
    expect(offOutcome.payload.days[0].actionsFrom).toBe("official");
    expect(offOutcome.payload.days[0].actions.length).toBeGreaterThan(0);

    const useless = await withActions(base, off.deps, "y");
    expect(useless.payload.days[0].actionsFrom).toBe("official");
  });

  it("refuses a rate-limited request instead of faking an answer, and reports a missing forecast", async () => {
    const { deps } = weekDeps({ days: [] });
    const base = await buildWeekBase(36.1682, -86.7775, "TN", deps);
    const refused = await withActions(base, deps, "z", () => ({ status: 429, body: { state: "rate_limited", message: "slow down", retryAfter: 5 } }));
    expect(refused.refuse?.status).toBe(429);

    clearWeekCache();
    const down = weekDeps({ days: [] }, { fetch: (() => Promise.resolve(new Response("no", { status: 503 }))) as never });
    const problem = await buildWeekBase(36.1682, -86.7775, "TN", down.deps);
    expect(problem.state).toBe("problem");
    expect(problem.days).toEqual([]);
    expect(problem.notices[0]).toMatch(/National Weather Service/);
  });
});

describe("the heat line says why it feels hotter", () => {
  it("names the humidity when the feels-like runs well above the air temperature", () => {
    const [humid] = classifyDay(calm({ highF: 90, feelsF: 104 }), { ...NO_OFFICIAL, heatRisk: 2 }, 0);
    expect(humid.plain).toContain("The air will reach about 90°F, and the humidity will make it feel like 104°F.");
    const [dry] = classifyDay(calm({ highF: 104, feelsF: 105 }), { ...NO_OFFICIAL, heatRisk: 2 }, 0);
    expect(dry.plain).toContain("It will feel like 105°F at the hottest.");
  });
});
