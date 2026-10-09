/**
 * "Moments the records caught" on the landing page (lib/ui/landing-moments.ts) and the record-flash replay's model
 * (lib/ui/record-flash-model.ts): every number a card states is read back from the shipped data here.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { segmentDistance } from "@/lib/geo";
import { LANDING_MOMENTS, momentLookup } from "@/lib/ui/landing-moments";
import { lightningFileFor, type LightningIndex } from "@/lib/ui/lightning";
import { buildRecordModel, GLOW_MS, recordFrame, type RecordFlashFile } from "@/lib/ui/record-flash-model";
import { VISIBLE_TABS } from "@/lib/ui/tabs";
import type { AreaEvent, TornadoRow } from "@/lib/types";

const gz = <T,>(file: string) => JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as T;
const moment = (id: string) => LANDING_MOMENTS.find((m) => m.id === id)!;
/** Where the Census geocoder puts each address (looked up once; a test must not call it). */
const GEOCODED: Record<string, [number, number]> = {
  mayfield: [36.741570704769, -88.635704510878],
  "rolling-fork": [32.908372685663, -90.876237438021],
  ida: [40.758019717113, -73.829301134074],
};

describe("each moment opens a replay, playing", () => {
  it("as a lookup on its own address and view, with the night, tornado or year it plays from", () => {
    for (const m of LANDING_MOMENTS) {
      const lookup = momentLookup(m);
      expect(VISIBLE_TABS).toContain(lookup.tab);
      expect(lookup.address).toBe(m.address);
      expect(lookup.night).toBe(m.night);
      expect(lookup.tornado).toBe(m.tornado);
      expect(lookup.replayFrom).toBe(m.replayFrom);
      expect(lookup.replayKinds).toBe(m.replayKinds);
      expect(m.action).toMatch(/^Play /);
    }
  });

  it("tornado moments start at their tornado; story moments play the years instead of opening a card", () => {
    expect(momentLookup(moment("mayfield")).tornado).toBe("SE-994196");
    expect(momentLookup(moment("rolling-fork")).tornado).toBe("SE-1102153");
    for (const id of ["lahaina", "ian"]) {
      const lookup = momentLookup(moment(id));
      expect(lookup.replayFrom).toBeLessThanOrEqual(Number(moment(id).kicker.match(/\d{4}/)![0]));
      expect(lookup.event).toBeUndefined();
    }
    // A card about one hazard plays that hazard's events, not everything filed for the area.
    expect(momentLookup(moment("lahaina")).replayKinds).toEqual(["Wildfire"]);
    expect(momentLookup(moment("ian")).replayKinds).toContain("Hurricane (Typhoon)");
  });
});

describe("the tornado moments match the state index", () => {
  it.each([
    ["mayfield", "KY", "SE-994196", "2021-12-10", 0.65, 24, 210],
    ["rolling-fork", "MS", "SE-1102153", "2023-03-24", 0.3, 14, 150],
  ] as const)("%s", (id, state, tornadoId, day, km, deaths, injuries) => {
    const index = gz<{ tornadoes: TornadoRow[] }>(`data/index/${state}.json.gz`);
    const row = index.tornadoes.find((t) => t.id === tornadoId)!;
    expect(row.ef).toBe("EF4");
    expect(row.start.slice(0, 10)).toBe(day);
    expect(row.deaths).toBe(deaths);
    expect(row.injuries).toBe(injuries);
    expect(segmentDistance(GEOCODED[id], row.begin, row.end).km).toBeCloseTo(km, 1);
    const m = moment(id);
    expect(m.big).toBe(String(km));
    expect(m.line).toContain(`${deaths} deaths and ${injuries} injuries`);
    // Both struck after dark: 8:03 pm and 9:16 pm local.
    expect(Number(row.start.slice(11, 13))).toBeGreaterThanOrEqual(20);
  });
});

describe("the record moments match the NCEI events they open", () => {
  it.each([
    ["lahaina", "HI", "HIZ018", "Wildfire", 102, 5_500_000_000],
    ["ian", "FL", "FLZ165", "Hurricane (Typhoon)", 60, 7_000_000_000],
  ] as const)("%s", (id, state, area, type, deaths, damage) => {
    const m = moment(id);
    const events = gz<{ events: AreaEvent[] }>(`data/events/${state}/${area}.json.gz`).events;
    const event = events.find((e) => e.id === m.event)!;
    expect(event.type).toBe(type);
    expect(event.deaths).toBe(deaths);
    expect(event.damageUsd).toBe(damage);
    expect(`${m.big} ${m.unit} ${m.line}`).toContain(String(deaths));
    expect(`${m.big} ${m.unit} ${m.line}`).toContain(`$${damage / 1e9}`);
  });
});

describe("the Ida moment", () => {
  it("has its night's lightning shipped, and Queens's flash-flood deaths that night add up to 11", () => {
    const m = moment("ida");
    const index = JSON.parse(readFileSync("public/data/lightning/index.json", "utf8")) as LightningIndex;
    expect(lightningFileFor(index, ...GEOCODED.ida, m.night)).not.toBeNull();
    const queens = gz<{ events: AreaEvent[] }>("data/events/NY/NYC081.json.gz").events;
    const deaths = queens.filter((e) => e.type === "Flash Flood" && e.start.startsWith("2021-09-01")).reduce((sum, e) => sum + e.deaths, 0);
    expect(deaths).toBe(11);
    expect(m.line).toContain("11 deaths were recorded in Queens");
  });
});

describe("the record flash", () => {
  const file = JSON.parse(readFileSync("public/data/lightning/record-2020-04-29.json", "utf8")) as RecordFlashFile;
  const model = buildRecordModel(file);

  it("holds the certified record's facts and ten seconds of light, sorted", () => {
    expect(file.record).toEqual(expect.objectContaining({ lengthKm: 768, lengthMi: 477, began: "2020-04-29T14:32:39.016Z" }));
    expect(model.durationMs).toBe(10_000);
    expect(file.groups.length).toBeGreaterThan(5000);
    for (let i = 1; i < file.groups.length; i += 1) expect(file.groups[i][0]).toBeGreaterThanOrEqual(file.groups[i - 1][0]);
  });

  it("the light spreads west to east over the seconds, ending near the file's own span", () => {
    const early = recordFrame(model, 1500 / 10_000);
    const late = recordFrame(model, 1);
    expect(early.spanKm).toBeLessThan(late.spanKm);
    expect(late.spanKm).toBe(file.spanKm);
    expect(late.clock).toBe("14:32:48.0");
  });

  it("a group glows for GLOW_MS after its moment, then only its trace remains", () => {
    const frame = recordFrame(model, 0.5);
    for (let i = frame.glowFrom; i < frame.seen; i += 1) expect(frame.ms - file.groups[i][0]).toBeLessThanOrEqual(GLOW_MS);
    if (frame.glowFrom > 0) expect(frame.ms - file.groups[frame.glowFrom - 1][0]).toBeGreaterThan(GLOW_MS);
  });
});
