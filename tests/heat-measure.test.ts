/**
 * The heat tab's daily high (lib/heat-measure.ts): the air temperature or the feels-like, whichever is higher, so dry heat
 * (Albuquerque) counts as well as humid heat; and how the summary, the sources and the words use it.
 */
import { describe, expect, it } from "vitest";
import { dayHigh, dayHighKind, hasAirTemps } from "@/lib/heat-measure";
import { summarizeHeat } from "@/lib/lookup";
import { heatDaysFromPower } from "@/lib/nasa-power";
import { heatDaysFromArchive } from "@/lib/sources";
import { dayHighWords, heatHighWords } from "@/lib/ui/data-source";
import type { HeatDay } from "@/lib/types";

/** A dry summer: the air reaches 100°F but it never feels that hot. */
const dry: HeatDay[] = [
  { date: "2023-07-24", feelsF: 95.1, airF: 99.4 },
  { date: "2023-07-25", feelsF: 98.2, airF: 101.3 },
  { date: "2023-07-26", feelsF: 97, airF: 100.2 },
  { date: "2023-07-27", feelsF: 90, airF: 94 },
];

describe("dayHigh", () => {
  it("is the air temperature in dry heat and the feels-like in humid heat", () => {
    expect(dayHigh(dry[1])).toBe(101.3);
    expect(dayHighKind(dry[1])).toBe("air");
    const humid = { date: "2021-06-28", feelsF: 114.7, airF: 104 };
    expect(dayHigh(humid)).toBe(114.7);
    expect(dayHighKind(humid)).toBe("feels");
  });

  it("is the feels-like for a day without an air temperature (an older snapshot)", () => {
    expect(dayHigh({ date: "2012-06-29", feelsF: 113 })).toBe(113);
    expect(hasAirTemps([{ date: "2012-06-29", feelsF: 113 }])).toBe(false);
    expect(hasAirTemps(dry)).toBe(true);
  });
});

describe("summarizeHeat with air temperatures", () => {
  it("counts the dry 100°F days and picks the hottest by the air temperature", () => {
    const heat = summarizeHeat(dry)!;
    expect(heat.byYear["2023"]).toBe(2);
    expect(heat.hottest).toEqual({ date: "2023-07-25", feelsF: 98.2, airF: 101.3 });
    expect(heat.worstWeek.daily[1]).toEqual({ date: "2023-07-25", feelsF: 98.2, airF: 101.3 });
  });

  it("would have counted none on the feels-like alone", () => {
    const heat = summarizeHeat(dry.map(({ date, feelsF }) => ({ date, feelsF })))!;
    expect(heat.byYear["2023"]).toBe(0);
  });
});

describe("the sources", () => {
  it("reads both highs from the Open-Meteo archive, keeping a day that lacks the air temperature", () => {
    const days = heatDaysFromArchive({ daily: { time: ["2023-07-25", "2023-07-26"], apparent_temperature_max: [98.2, 97], temperature_2m_max: [101.3, null] } });
    expect(days).toEqual([
      { date: "2023-07-25", feelsF: 98.2, airF: 101.3 },
      { date: "2023-07-26", feelsF: 97 },
    ]);
  });

  it("passes NASA POWER's air temperature through beside its heat index", () => {
    const days = heatDaysFromPower({ properties: { parameter: { T2M_MAX: { "20230725": 38.5 }, RH2M: { "20230725": 10 } } } });
    expect(days).toHaveLength(1);
    expect(days[0].airF).toBe(101.3);
    expect(days[0].feelsF).toBeLessThan(days[0].airF!);
  });
});

describe("the words", () => {
  it("names the combined high only when the data has air temperatures", () => {
    expect(heatHighWords({ hottest: dry[1] })).toEqual({ short: "high", rule: "the air temperature, or the feels-like where humidity made it feel hotter" });
    expect(heatHighWords({ hottest: { date: "2012-06-29", feelsF: 113 } })).toEqual({ short: "feels-like high", rule: null });
    expect(heatHighWords({ hottest: dry[1], provider: "nasa-power" }).rule).toBe("the air temperature, or the heat index where humidity made it feel hotter");
  });

  it("says one day's high with the other measure beside it", () => {
    expect(dayHighWords(dry[1], "feels-like")).toBe("101°F air temperature (feels-like 98°F)");
    expect(dayHighWords({ date: "2021-06-28", feelsF: 114.7, airF: 104 }, "feels-like")).toBe("115°F feels-like (air temperature 104°F)");
    expect(dayHighWords({ date: "2012-06-29", feelsF: 113 }, "feels-like")).toBe("113°F feels-like");
  });
});
