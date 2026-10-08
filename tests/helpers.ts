import type { FetchLike } from "@/lib/http";
import type { FloodRow, HeatDay, TornadoRow } from "@/lib/types";

/** The sample address used across the tests (Nashville city hall area). */
export const NASHVILLE: [number, number] = [36.168175, -86.777516];

export function flood(overrides: Partial<FloodRow> & { id: string }): FloodRow {
  return {
    source: "LSR",
    type: "Flash Flood",
    start: "2021-03-27T22:55:00-05:00",
    county: "Davidson",
    wfo: "OHX",
    city: "NASHVILLE",
    quote: "ROAD FLOODED",
    filed: NASHVILLE,
    coordPrecision: "rounded",
    placed: null,
    detective: null,
    dupOf: null,
    ...overrides,
  };
}

export function tornado(overrides: Partial<TornadoRow> & { id: string }): TornadoRow {
  return {
    start: "2020-03-03T00:32:00-06:00",
    ef: "EF1",
    begin: [36.2, -86.9],
    end: [36.2, -86.8],
    widthYd: 100,
    lengthMi: 5,
    deaths: 0,
    injuries: 0,
    narrative: "Damage.",
    episodeNarrative: "",
    ...overrides,
  };
}

/** A year of days, every day 90 F, with overrides by date. */
export function heatYear(year: number, overrides: Record<string, number> = {}): HeatDay[] {
  const days: HeatDay[] = [];
  for (let ms = Date.UTC(year, 0, 1); ms < Date.UTC(year + 1, 0, 1); ms += 86_400_000) {
    const date = new Date(ms).toISOString().slice(0, 10);
    days.push({ date, feelsF: overrides[date] ?? 90 });
  }
  return days;
}

type Route = (url: string) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const CENSUS_NASHVILLE = {
  result: {
    addressMatches: [
      {
        matchedAddress: "100 JAMES ROBERTSON PKWY, NASHVILLE, TN, 37201",
        coordinates: { x: NASHVILLE[1], y: NASHVILLE[0] },
        addressComponents: { state: "TN", city: "NASHVILLE" },
        geographies: { Counties: [{ NAME: "Davidson County" }] },
      },
    ],
  },
};

export const FEMA_ZONE_X = {
  features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } }],
};

export const NO_ALERTS = { features: [] };

/** Open-Meteo reply for 2012 with a clear peak on June 29. */
export function openMeteoReply(days: HeatDay[]) {
  return {
    daily: { time: days.map((d) => d.date), apparent_temperature_max: days.map((d) => d.feelsF) },
  };
}

/**
 * A fetch that answers by URL. Any host without a route throws, so a test can never
 * quietly reach the real network.
 */
export function fakeFetch(routes: { census?: Route; fema?: Route; nws?: Route; meteo?: Route; power?: Route }): FetchLike {
  return async (url) => {
    const pick = (host: string, route?: Route) => {
      if (!url.includes(host)) return null;
      if (!route) throw new Error(`unexpected request to ${host}`);
      return route(url);
    };
    const hit =
      pick("geocoding.geo.census.gov", routes.census) ??
      pick("hazards.fema.gov", routes.fema) ??
      pick("api.weather.gov", routes.nws) ??
      pick("archive-api.open-meteo.com", routes.meteo) ??
      pick("power.larc.nasa.gov", routes.power);
    if (!hit) throw new Error(`unrouted URL in test: ${url}`);
    return hit;
  };
}

export const ok = (body: unknown) => json(body);
export const httpError = (status: number) => json({ error: "nope" }, status);
/** Never answers, like a hung server. */
export const hang = () => new Promise<Response>(() => undefined);
