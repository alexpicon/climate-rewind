/**
 * NASA POWER (MERRA-2 reanalysis): the fallback when Open-Meteo is rate limited or down. Free, no key. Server only.
 *
 *   Heat  The daily highest air temperature (T2M_MAX) and the humidity, turned into a heat index with the National Weather
 *         Service's Rothfusz formula. This is NOT the same measure as Open-Meteo's feels-like (apparent temperature), so the
 *         numbers differ; the page says which one it is showing.
 *   Rain  PRECTOTCORR, the day's corrected precipitation, in millimetres, converted to inches.
 *
 * Days are local solar time (`time-standard=LST`), so an evening storm is not split across two UTC dates. POWER runs a few days
 * behind the present, which does not matter here: both uses are past years. Like every outside call this one has the 8 s timeout
 * and degrades to a plain notice.
 */
import { describeFailure, fetchJson, type FetchLike } from "./http";
import { gridKey, LruCache } from "./lru";
import type { HeatDay } from "./types";

export const POWER_LABEL = "NASA POWER (MERRA-2)";
const POWER_FIRST_YEAR = 2000;
/** POWER writes this for a missing value. */
const FILL = -999;
const MM_PER_INCH = 25.4;

interface PowerReply {
  properties?: { parameter?: Record<string, Record<string, number> | undefined> };
}

export interface PowerOk<T> {
  value: T;
  notice?: undefined;
}
export interface PowerFail {
  value: null;
  notice: string;
}

// ---------------------------------------------------------------- heat index (NWS Rothfusz)

/**
 * The National Weather Service heat index, in degrees Fahrenheit, from air temperature (F) and relative humidity (%).
 * https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml : the simple formula first; if its average with the temperature
 * reaches 80 F, the Rothfusz regression with the NWS's two adjustments for very dry and for humid-and-mild air.
 */
export function heatIndexF(tempF: number, humidity: number): number {
  const t = tempF;
  const rh = Math.min(100, Math.max(0, humidity));
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if ((simple + t) / 2 < 80) return simple;
  let hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * rh -
    0.22475541 * t * rh -
    0.00683783 * t * t -
    0.05481717 * rh * rh +
    0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh -
    0.00000199 * t * t * rh * rh;
  if (rh < 13 && t >= 80 && t <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  else if (rh > 85 && t >= 80 && t <= 87) hi += ((rh - 85) / 10) * ((87 - t) / 5);
  return hi;
}

const cToF = (c: number) => (c * 9) / 5 + 32;

/** Saturation vapour pressure over water, kPa (Tetens), temperature in C. */
const saturationKpa = (c: number) => 0.6108 * Math.exp((17.27 * c) / (c + 237.3));

/**
 * The relative humidity at the day's highest temperature. The humidity POWER reports (RH2M) is a whole-day average, and the air is
 * driest when it is hottest, so it would overstate the heat. The day's specific humidity (QV2M, g/kg) barely moves in a day, so with
 * the surface pressure (PS, kPa) it gives the vapour pressure, and dividing by the saturation pressure at the high gives the
 * humidity at the high. Where QV2M or PS is missing, RH2M is used.
 */
export function humidityAtHigh(highC: number, specificGkg: number | undefined, pressureKpa: number | undefined, dailyMeanRh: number | undefined): number | null {
  if (isValue(specificGkg) && isValue(pressureKpa) && pressureKpa > 0) {
    const q = specificGkg / 1000;
    const vapour = (q * pressureKpa) / (0.622 + 0.378 * q);
    return Math.min(100, Math.max(0, (100 * vapour) / saturationKpa(highC)));
  }
  return isValue(dailyMeanRh) ? Math.min(100, Math.max(0, dailyMeanRh)) : null;
}

const isValue = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n !== FILL;

const compact = (date: string) => date.replaceAll("-", "");
const dashed = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

// ---------------------------------------------------------------- requests

/** The POWER daily request for a point, as a URL. The point is snapped to its 0.05 degree cell (POWER's own grid is about 50 km). */
export function powerUrl(lat: number, lon: number, parameters: string[], startDate: string, endDate: string): string {
  return (
    "https://power.larc.nasa.gov/api/temporal/daily/point" +
    `?parameters=${parameters.join(",")}&community=RE&longitude=${lon.toFixed(2)}&latitude=${lat.toFixed(2)}` +
    `&start=${compact(startDate)}&end=${compact(endDate)}&format=JSON&time-standard=LST`
  );
}

/** Daily heat-index highs (and the air temperature highs they come from) from a POWER reply. A day missing its temperature or its humidity is left out. */
export function heatDaysFromPower(data: PowerReply): HeatDay[] {
  const p = data.properties?.parameter ?? {};
  const highs = p.T2M_MAX ?? {};
  const days: HeatDay[] = [];
  for (const key of Object.keys(highs).sort()) {
    const highC = highs[key];
    if (!isValue(highC)) continue;
    const rh = humidityAtHigh(highC, p.QV2M?.[key], p.PS?.[key], p.RH2M?.[key]);
    if (rh === null) continue;
    days.push({ date: dashed(key), feelsF: Math.round(heatIndexF(cToF(highC), rh) * 10) / 10, airF: Math.round(cToF(highC) * 10) / 10 });
  }
  return days;
}

/** Date to inches of rain from a POWER reply. A day with no value is left out (never counted as dry). */
export function rainFromPower(data: PowerReply): Map<string, number | null> {
  const mm = data.properties?.parameter?.PRECTOTCORR ?? {};
  const rain = new Map<string, number | null>();
  for (const key of Object.keys(mm).sort()) {
    const value = mm[key];
    rain.set(dashed(key), isValue(value) && value >= 0 ? Math.round((value / MM_PER_INCH) * 1000) / 1000 : null);
  }
  return rain;
}

const CACHE_MS = 6 * 60 * 60 * 1000;
const heatCache = new LruCache<HeatDay[]>(60, CACHE_MS);
const rainCache = new LruCache<Map<string, number | null>>(100, CACHE_MS);

export function clearPowerCaches(): void {
  heatCache.clear();
  rainCache.clear();
}

/** Daily heat-index highs since 2000 through the end of last year, at a point. One request. */
export async function fetchPowerHeat(lat: number, lon: number, fetchFn: FetchLike, now: () => Date = () => new Date()): Promise<PowerOk<HeatDay[]> | PowerFail> {
  const lastYear = now().getUTCFullYear() - 1;
  const cell = gridKey(lat, lon);
  const key = `${cell.key},${lastYear}`;
  const cached = heatCache.get(key, now().getTime());
  if (cached) return { value: cached };

  const result = await fetchJson<PowerReply>(fetchFn, powerUrl(cell.lat, cell.lon, ["T2M_MAX", "QV2M", "PS", "RH2M"], `${POWER_FIRST_YEAR}-01-01`, `${lastYear}-12-31`));
  if (!result.ok) return { value: null, notice: describeFailure(`The ${POWER_LABEL} weather archive`, result) };
  const days = heatDaysFromPower(result.data);
  if (days.length === 0) return { value: null, notice: `The ${POWER_LABEL} weather archive had no temperature data for this address.` };
  heatCache.set(key, days, now().getTime());
  return { value: days };
}

/** Daily rain (inches) at a point for a range of dates. One request. */
export async function fetchPowerRain(lat: number, lon: number, startDate: string, endDate: string, fetchFn: FetchLike, now: () => Date = () => new Date()): Promise<PowerOk<Map<string, number | null>> | PowerFail> {
  const cell = gridKey(lat, lon);
  const key = `${cell.key},${startDate},${endDate}`;
  const cached = rainCache.get(key, now().getTime());
  if (cached) return { value: cached };

  const result = await fetchJson<PowerReply>(fetchFn, powerUrl(cell.lat, cell.lon, ["PRECTOTCORR"], startDate, endDate));
  if (!result.ok) return { value: null, notice: describeFailure(`The ${POWER_LABEL} weather archive`, result) };
  const rain = rainFromPower(result.data);
  if (rain.size === 0) return { value: null, notice: `The ${POWER_LABEL} weather archive had no rainfall records for this address.` };
  rainCache.set(key, rain, now().getTime());
  return { value: rain };
}
