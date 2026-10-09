/**
 * How a matched address travels between the page and /api/lookup/<part>: as a handful of query values, so the pieces of a lookup
 * do not each match the address again. Shared by the browser (to build the query) and the route (to read and check it).
 */
import { LOOKUP_PARTS, type LookupAddress, type LookupPart } from "./types";

export function isLookupPart(value: string): value is LookupPart {
  return (LOOKUP_PARTS as readonly string[]).includes(value);
}

export function addressToQuery(address: LookupAddress, night?: string | null): URLSearchParams {
  const params = new URLSearchParams({ address: address.input, matched: address.matched, lat: String(address.lat), lon: String(address.lon), state: address.state });
  if (address.county) params.set("county", address.county);
  if (address.city) params.set("city", address.city);
  if (address.countyFips) params.set("fips", address.countyFips);
  if (night) params.set("night", night);
  return params;
}

const text = (value: string | null, max = 200): string | null => (value && value.length <= max ? value : null);

/** The address in the query, or null when anything is missing or out of range (the route then answers 400). */
export function addressFromQuery(params: URLSearchParams): LookupAddress | null {
  const input = text(params.get("address"));
  const matched = text(params.get("matched"), 300);
  const latText = params.get("lat");
  const lonText = params.get("lon");
  const state = (params.get("state") ?? "").toUpperCase();
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!input || !matched || !latText || !lonText || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < 17 || lat > 72 || lon < -180 || lon > -60 || !/^[A-Z]{2}$/.test(state)) return null;
  const fips = params.get("fips");
  return {
    input,
    matched,
    lat,
    lon,
    state,
    county: text(params.get("county")),
    city: text(params.get("city")),
    countyFips: fips && /^\d{3}$/.test(fips) ? fips : null,
  };
}
