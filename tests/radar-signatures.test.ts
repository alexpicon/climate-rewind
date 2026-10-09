/** NEXRAD hail detections and tornado vortex signatures from NOAA's SWDI (lib/radar-signatures.ts), with a fake fetch. */
import { describe, expect, it } from "vitest";
import { fetchRadarSignatures, MAX_WINDOW_MS, parseSignatureQuery, pointOf, swdiTime, type SignatureQuery } from "@/lib/radar-signatures";

const START = Date.parse("2021-03-28T03:05:00Z");
let unique = 0;
/** A distinct query each time, so the module's cache never answers one test with another's result. */
const query = (): SignatureQuery => ({ bounds: [-88.1, 35.08, -85.44, 37.25 + (unique += 0.001)], startMs: START, endMs: START + 3 * 3_600_000 });

const hailRow = (ztime: string, prob: string, size: string) => ({ PROB: prob, SEVPROB: "50", MAXSIZE: size, WSR_ID: "KHTX", CELL_ID: "C6", ZTIME: ztime, SHAPE: "POINT (-87.2000988 35.8346955)" });
const tvsRow = (ztime: string) => ({ CELL_TYPE: "TVS", MAX_SHEAR: "52", MXDV: "98", WSR_ID: "KBNA", CELL_ID: "O6", ZTIME: ztime, SHAPE: "POINT (-87.2508804 35.7847495)" });

function fakeFetch(answers: { hail?: unknown; tvs?: unknown; hailStatus?: number }) {
  const urls: string[] = [];
  const fn = async (url: string) => {
    urls.push(url);
    const isHail = url.includes("/nx3hail/");
    if (isHail && answers.hailStatus) return new Response("", { status: answers.hailStatus });
    return Response.json({ result: isHail ? (answers.hail ?? []) : (answers.tvs ?? []) });
  };
  return { fn, urls };
}

describe("swdiTime and pointOf", () => {
  it("writes the service's minute-precision UTC range format", () => {
    expect(swdiTime(START)).toBe("202103280305");
  });

  it("reads a WKT point as lat, lon, and refuses anything else", () => {
    expect(pointOf("POINT (-87.2000988 35.8346955)")).toEqual([35.8346955, -87.2000988]);
    expect(pointOf("LINESTRING (0 0, 1 1)")).toBeNull();
    expect(pointOf(undefined)).toBeNull();
  });
});

describe("parseSignatureQuery", () => {
  const params = (bbox: string, start: string, end: string) => new URLSearchParams({ bbox, start, end });

  it("accepts a US box and a night", () => {
    expect(parseSignatureQuery(params("-88.1,35.08,-85.44,37.25", "2021-03-28T03:05:00Z", "2021-03-28T10:10:00Z"))).toEqual({
      bounds: [-88.1, 35.08, -85.44, 37.25],
      startMs: START,
      endMs: Date.parse("2021-03-28T10:10:00Z"),
    });
  });

  it.each([
    ["outside the US", "0,0,1,1", "2021-03-28T03:05:00Z", "2021-03-28T04:00:00Z"],
    ["a box too large", "-100,30,-80,45", "2021-03-28T03:05:00Z", "2021-03-28T04:00:00Z"],
    ["an inverted box", "-85,35,-88,37", "2021-03-28T03:05:00Z", "2021-03-28T04:00:00Z"],
    ["a window over a day", "-88.1,35.08,-85.44,37.25", "2021-03-28T00:00:00Z", new Date(START + MAX_WINDOW_MS + 3_600_000).toISOString()],
    ["an end before the start", "-88.1,35.08,-85.44,37.25", "2021-03-28T05:00:00Z", "2021-03-28T04:00:00Z"],
    ["no times", "-88.1,35.08,-85.44,37.25", "", ""],
  ])("refuses %s", (_label, bbox, start, end) => {
    expect(parseSignatureQuery(params(bbox, start, end))).toBeNull();
  });
});

describe("fetchRadarSignatures", () => {
  it("asks both products for the night's box and window, and reads their rows", async () => {
    const { fn, urls } = fakeFetch({ hail: [hailRow("2021-03-28T03:05:32Z", "100", "1.75")], tvs: [tvsRow("2021-03-28T03:05:40Z")] });
    const q = query();
    const result = await fetchRadarSignatures(q, fn);
    expect(urls.map((u) => u.split("?")[0])).toEqual([
      "https://www.ncei.noaa.gov/swdiws/json/nx3hail/202103280305:202103280606",
      "https://www.ncei.noaa.gov/swdiws/json/nx3tvs/202103280305:202103280606",
    ]);
    expect(result.hail).toEqual([{ t: Date.parse("2021-03-28T03:05:32Z"), lat: 35.8346955, lon: -87.2000988, maxIn: 1.75, prob: 100, severeProb: 50, radar: "KHTX" }]);
    expect(result.vortex).toEqual([{ t: Date.parse("2021-03-28T03:05:40Z"), lat: 35.7847495, lon: -87.2508804, kind: "TVS", shear: 52, deltaV: 98, radar: "KBNA" }]);
    expect(result.notice).toBeUndefined();
  });

  it("leaves out weak hail flags and rows outside the window, and sorts by time", async () => {
    const { fn } = fakeFetch({
      hail: [hailRow("2021-03-28T04:00:00Z", "100", "1"), hailRow("2021-03-28T03:30:00Z", "30", "0.5"), hailRow("2021-03-28T03:10:00Z", "60", "0.75"), hailRow("2021-03-29T00:00:00Z", "100", "2")],
    });
    const result = await fetchRadarSignatures(query(), fn);
    expect(result.hail.map((h) => h.maxIn)).toEqual([0.75, 1]);
  });

  it("a failed product is empty with a plain notice, the other still arrives, and nothing is cached", async () => {
    const q = query();
    const first = fakeFetch({ hailStatus: 503, tvs: [tvsRow("2021-03-28T03:05:40Z")] });
    const result = await fetchRadarSignatures(q, first.fn);
    expect(result.hail).toEqual([]);
    expect(result.vortex).toHaveLength(1);
    expect(result.notice).toBe("NOAA's radar hail detections returned an error (HTTP 503).");
    const again = fakeFetch({ hail: [], tvs: [] });
    await fetchRadarSignatures(q, again.fn);
    expect(again.urls).toHaveLength(2);
  });

  it("a complete answer is cached: the same night asks NOAA once", async () => {
    const q = query();
    const first = fakeFetch({});
    await fetchRadarSignatures(q, first.fn);
    const second = fakeFetch({});
    await fetchRadarSignatures(q, second.fn);
    expect(second.urls).toHaveLength(0);
  });
});
