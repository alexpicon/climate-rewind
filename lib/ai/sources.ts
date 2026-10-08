/**
 * Turns an address's real data into the list of sources the model may cite. Server only (it may read data/damage).
 *
 * Everything in a source is a fact we already hold: the NWS report text word for word, the detective's placement, the official
 * outlooks, the counted track record, the heat history, the flood trigger and the live alerts. Percentages and totals are worked
 * out HERE, in code, and written into the text, so the model never has to calculate (and the verifier can check what it copies).
 */
import { triggerCopy } from "../ui/trigger-text";
import { dayName, FEW_DAYS, percentText } from "../ui/ahead-text";
import { excerpt, niceDate } from "../ui/text";
import type { LookupPayload, NearbyFlood, NearbyTornado } from "../types";
import {
  ERO_LABEL,
  ERO_MEANING,
  HEATRISK_LABEL,
  type EroLevel,
  type EroRecordKey,
  type OutlookPayload,
  type RecordCount,
  type TornadoRecordKey,
} from "../outlook-types";
import { damageWhere } from "../ui/tornado-model";
import { damageNear, type DamageRow } from "./damage";
import type { AiSource } from "./types";

/** How many flood reports and tornadoes the model gets to read in full. */
export const MAX_REPORT_SOURCES = 8;
export const MAX_TORNADO_SOURCES = 4;

export { dayName, FEW_DAYS, percentText };

/** "2021-03-27T22:55:00-05:00" -> "March 27, 2021, 10:55 pm local time" (read as written, no time zone shifting) */
export function localMoment(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m;
  const hour = Number(h);
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${mi} ${hour < 12 ? "am" : "pm"}`;
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(mo) - 1];
  return `${month} ${Number(d)}, ${y}, ${clock} local time`;
}

const num = (n: number) => n.toLocaleString("en-US");

const sanitize = (text: string) => text.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- the outlooks

const DAY_WORD = (day: number, date: string) => `Day ${day} (${dayName(date)})`;

function floodOutlookSource(outlook: OutlookPayload): AiSource {
  const days = outlook.flood.days;
  const origin = "Weather Prediction Center (WPC) Excessive Rainfall Outlook, read at this point through the Iowa Environmental Mesonet";
  if (!days) {
    return { id: "flood-outlook", kind: "outlook", chip: "WPC outlook", title: "WPC flood outlook", origin, text: `The WPC outlook could not be read just now. ${outlook.flood.notice ?? ""}`.trim(), href: "https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php" };
  }
  const lines = days.map((d) => `${DAY_WORD(d.day, d.date)}: ${d.level === "none" ? "no risk area at this address" : `${ERO_LABEL[d.level]} risk`}.`);
  const levels = [...new Set(days.map((d) => d.level).filter((l): l is Exclude<EroLevel, "none"> => l !== "none"))];
  const meaning = levels.length
    ? `What the level means, per WPC: ${levels.map((l) => `${ERO_LABEL[l]} is ${ERO_MEANING[l]}`).join("; ")}.`
    : "A day with no risk area means WPC drew no Marginal-or-higher area over this address.";
  return {
    id: "flood-outlook",
    kind: "outlook",
    chip: "WPC outlook",
    title: "WPC Excessive Rainfall Outlook at this address",
    origin,
    text: `${lines.join("\n")}\n${meaning} This is the Weather Prediction Center's own outlook, not ours.`,
    href: "https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php",
  };
}

const ERO_RECORD_ORDER: EroRecordKey[] = ["none", "MRGL", "SLGT", "MDT", "HIGH"];
const recordLine = (name: string, c: RecordCount) =>
  c.days === 0 ? `${name}: 0 such days` : `${name}: a flood was reported within 10 km on ${num(c.hitDays)} of ${num(c.days)} days (${percentText(c.hitDays, c.days)})${c.days < FEW_DAYS ? ", too few days to say anything firm" : ""}`;

function floodRecordSource(outlook: OutlookPayload): AiSource | null {
  const record = outlook.flood.record;
  if (!record) return null;
  const name = (key: EroRecordKey) => (key === "none" ? "Days with no risk area" : `Days rated ${ERO_LABEL[key]}`);
  const all = ERO_RECORD_ORDER.map((key) => recordLine(name(key), record.byCategory[key]));
  const since = ERO_RECORD_ORDER.filter((key) => record.sinceRedefinition[key].days > 0).map((key) => recordLine(name(key), record.sinceRedefinition[key]));
  return {
    id: "flood-record",
    kind: "record",
    chip: "Local record",
    title: "How WPC's flood outlooks have played out at this address",
    origin: "Our count of past days: WPC morning Day 1 outlooks (Iowa Environmental Mesonet archive) against NWS flood reports with a known location",
    text:
      `This is a count of past days, not a forecast. From ${niceDate(record.window.start)} to ${niceDate(record.window.end)}, ${num(record.days)} days had a WPC morning Day 1 outlook here. ` +
      `A flood report with a known location within ${record.radiusKm} km of this address was filed on ${num(record.hitDays)} of those days.\n` +
      `${all.join(".\n")}.\n` +
      `WPC changed what its categories mean on ${niceDate(record.redefined)}. Counting only days since then:\n${since.join(".\n")}.\n` +
      "Only reports with a usable location are counted, so these are floods that were reported, not every flood.",
  };
}

const TOR_RECORD_ORDER: TornadoRecordKey[] = ["none", "2", "5", "10+"];
const TOR_NAME: Record<TornadoRecordKey, string> = {
  none: "Days with no SPC tornado risk area",
  "2": "Days when SPC gave this point 2%",
  "5": "Days when SPC gave this point 5%",
  "10+": "Days when SPC gave this point 10% or more",
};

function tornadoOutlookSource(outlook: OutlookPayload): AiSource {
  const days = outlook.tornado.days;
  const origin = "Storm Prediction Center (SPC) Day 1 to 3 outlooks, read at this point through the Iowa Environmental Mesonet";
  const href = "https://www.spc.noaa.gov/products/outlook/";
  if (!days) return { id: "tornado-outlook", kind: "outlook", chip: "SPC outlook", title: "SPC tornado outlook", origin, text: `The SPC outlook could not be read just now. ${outlook.tornado.notice ?? ""}`.trim(), href };
  const lines = days.map((d) => {
    const label = DAY_WORD(d.day, d.date);
    if (d.kind === "severe") return `${label}: ${d.percent > 0 ? `${d.percent}% chance of any severe weather (tornado, damaging wind or hail combined; Day 3 has no separate tornado probability) within 25 miles of this point` : "no severe-weather risk area at this point (Day 3 gives only a combined severe probability, not a tornado one)"}.`;
    return `${label}: ${d.percent > 0 ? `${d.percent}% tornado probability within 25 miles of this point` : "no tornado risk area at this point (under 2%)"}.`;
  });
  return { id: "tornado-outlook", kind: "outlook", chip: "SPC outlook", title: "SPC tornado outlook at this address", origin, text: `${lines.join("\n")}\nThis is the Storm Prediction Center's own outlook, not ours.`, href };
}

function tornadoRecordSource(outlook: OutlookPayload): AiSource | null {
  const record = outlook.tornado.record;
  if (!record) return null;
  const lines = TOR_RECORD_ORDER.map((key) => {
    const c = record.byProbability[key];
    return c.days === 0 ? `${TOR_NAME[key]}: 0 such days` : `${TOR_NAME[key]}: a tornado track passed within ${record.radiusMi} miles on ${num(c.hitDays)} of ${num(c.days)} days (${percentText(c.hitDays, c.days)})${c.days < FEW_DAYS ? ", too few days to say anything firm" : ""}`;
  });
  return {
    id: "tornado-record",
    kind: "record",
    chip: "Local record",
    title: "How SPC's tornado outlooks have played out at this address",
    origin: "Our count of past days: SPC 06Z Day 1 tornado probabilities against NCEI Storm Events tornado tracks",
    text:
      `This is a count of past days, not a forecast. From ${niceDate(record.window.start)} to ${niceDate(record.window.end)}, ${num(record.days)} days had an SPC morning Day 1 outlook here. ` +
      `A tornado track passed within ${record.radiusMi} miles of this address (SPC's own distance) on ${num(record.hitDays)} of those days.\n${lines.join(".\n")}.`,
  };
}

// ---------------------------------------------------------------- heat

const pctOf = (atLeast: number, total: number) => percentText(atLeast, total);

function heatRiskSource(outlook: OutlookPayload): AiSource {
  const risk = outlook.heat.risk;
  const origin = "NWS HeatRisk (experimental), read at this point from the National Weather Service map service";
  const href = "https://www.wpc.ncep.noaa.gov/heatrisk/";
  if (!risk) return { id: "heatrisk", kind: "heat", chip: "HeatRisk", title: "NWS HeatRisk", origin, text: `HeatRisk could not be read just now. ${outlook.heat.notices.risk ?? ""}`.trim(), href };
  const lines = risk.map((d) => `${DAY_WORD(d.day, d.date)}: ${d.level === null ? "no value" : `level ${d.level} of 4 (${HEATRISK_LABEL[d.level]})`}.`);
  return { id: "heatrisk", kind: "heat", chip: "HeatRisk", title: "NWS HeatRisk at this address", origin, text: `${lines.join("\n")}\nHeatRisk runs from level 0 (little to no risk) to level 4 (extreme) and weighs how unusual the heat is for the time of year, how long it lasts and the health risk. It is experimental.`, href };
}

function heatForecastSource(outlook: OutlookPayload): AiSource | null {
  const forecast = outlook.heat.forecast;
  if (!forecast) return null;
  const lines = forecast.map((d) => {
    const base = `${dayName(d.date)}: forecast feels-like high ${Math.round(d.feelsF)} F`;
    if (!d.rank) return `${base}.`;
    const r = d.rank;
    return (
      `${base}. At this address ${num(r.allAtLeast)} of ${num(r.allTotal)} days since ${r.since} were that hot or hotter (${pctOf(r.allAtLeast, r.allTotal)} of all days); ` +
      `for days within a week of ${dayName(d.date).replace(/^\w+ /, "")} in any year, ${num(r.seasonAtLeast)} of ${num(r.seasonTotal)} (${pctOf(r.seasonAtLeast, r.seasonTotal)}).`
    );
  });
  return {
    id: "heat-forecast",
    kind: "heat",
    chip: "Feels-like",
    title: "Forecast feels-like highs, and where they rank here",
    origin: "National Weather Service gridpoint forecast (apparent temperature), ranked against this address's Open-Meteo/ERA5 daily highs since 2000",
    text: `${lines.join("\n")}\nThe forecast and the history come from different methods, so the ranking is a rough guide.`,
  };
}

function heatHistorySource(lookup: LookupPayload): AiSource | null {
  const heat = lookup.heat;
  if (!heat) return null;
  const years = Object.keys(heat.byYear).sort();
  const recent = years.slice(-5);
  const total = years.reduce((sum, y) => sum + heat.byYear[y], 0);
  return {
    id: "heat-history",
    kind: "heat",
    chip: "Heat history",
    title: "Hot days at this address since 2000",
    origin: "Open-Meteo archive (ERA5 reanalysis), daily feels-like high, at this address",
    text:
      `Days with a feels-like high of 100 F or more: ${recent.map((y) => `${y}: ${heat.byYear[y]}`).join(", ")}; ${total} in all since ${years[0]}. ` +
      `The hottest day since ${years[0]} was ${niceDate(heat.hottest.date)}, with a feels-like high of ${heat.hottest.feelsF} F. This is a model of past weather, not a thermometer at the address, and it shows no trend.`,
  };
}

// ---------------------------------------------------------------- flood trigger, FEMA, alerts

function triggerSource(lookup: LookupPayload): AiSource | null {
  const t = lookup.floodTrigger;
  if (t.status !== "ready" || t.triggerIn === null) return null;
  const copy = triggerCopy(t);
  const forecast = t.forecast ? ` The National Weather Service rain forecast by day: ${t.forecast.days.map((d) => `${dayName(d.date)} ${d.inches.toFixed(2)} in`).join(", ")}.` : "";
  return {
    id: "trigger",
    kind: "trigger",
    chip: "Flood trigger",
    title: "Your street's flood trigger",
    origin: "NWS flood reports within 5 km, ERA5 rainfall at the address (Open-Meteo), and the NWS rain forecast",
    text: `${t.floodDays} dates had flood reports within 5 km of this address. ${copy.headline} ${copy.context.join(" ")}${forecast} This compares past rain with forecast rain. It is a history-based signal, not a flood forecast.`.replace(/\s+/g, " "),
  };
}

function femaSource(lookup: LookupPayload): AiSource | null {
  if (!lookup.fema) return null;
  return {
    id: "fema",
    kind: "fema",
    chip: "FEMA zone",
    title: "FEMA flood zone at this address",
    origin: "FEMA National Flood Hazard Layer",
    text: `FEMA maps this address in flood zone ${lookup.fema.zone}${lookup.fema.subtype ? ` (${lookup.fema.subtype.toLowerCase()})` : ""}. It is ${lookup.fema.sfha ? "" : "not "}in a Special Flood Hazard Area. FEMA maps describe river and coastal flood hazard, and many street-level floods happen outside them.`,
    href: "https://msc.fema.gov/portal/home",
  };
}

function alertsSource(lookup: LookupPayload): AiSource {
  const base = { id: "alerts", kind: "alert" as const, chip: "Live alerts", title: "Active National Weather Service alerts", origin: "api.weather.gov alerts for this address", href: "https://www.weather.gov/" };
  const live = lookup.live;
  if (!live) return { ...base, text: `Live alerts could not be checked just now. ${lookup.notices.live ?? ""}`.trim() };
  const checked = live.checkedAt.replace("T", " ").slice(0, 16);
  if (live.alerts.length === 0) return { ...base, text: `The National Weather Service had no active alerts for this address when we checked (${checked} UTC).` };
  const list = live.alerts.slice(0, 5).map((a) => `${sanitize(a.event)}${a.headline ? `: ${sanitize(a.headline)}` : ""}${a.ends ? ` (ends ${a.ends.slice(0, 16).replace("T", " ")})` : ""}`);
  return { ...base, text: `Active alerts for this address (checked ${checked} UTC): ${list.join(" | ")}.` };
}

// ---------------------------------------------------------------- the past: reports and tornadoes

const TIER_TEXT: Record<NearbyFlood["tier"], string> = {
  mentioned: "the report's own words name an address or intersection",
  about1km: "filed at a precise or rounded point, about a kilometre of uncertainty",
  citywide: "filed only at a city placeholder, so the distance is not meaningful",
};

function ncdcLink(id: string): string | undefined {
  return id.startsWith("SE-") ? `https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=${id.replace(/^SE-/, "")}` : undefined;
}

/** Which reports the model reads: the ones the detective placed first, then those whose own words name a place, then the nearest. */
export function pickReports(reports: NearbyFlood[], limit = MAX_REPORT_SOURCES): NearbyFlood[] {
  const rank = (r: NearbyFlood) => (r.detective?.verdict === "placed" ? 0 : r.tier === "mentioned" ? 1 : r.tier === "about1km" ? 2 : 3);
  return [...reports].sort((a, b) => rank(a) - rank(b) || a.distanceKm - b.distanceKm).slice(0, limit);
}

function floodHistorySource(lookup: LookupPayload): AiSource | null {
  const { reports, tierCounts } = lookup.floods;
  if (reports.length === 0) {
    return { id: "flood-history", kind: "history", chip: "Flood reports", title: "Flood reports near this address", origin: "NWS Local Storm Reports and NCEI Storm Events, 2015 to 2025", text: "No flood report within 5 km of this address is in our records (reports we could place near you; not every flood is reported)." };
  }
  const years = reports.map((r) => r.start.slice(0, 4)).sort();
  const newest = [...reports].sort((a, b) => (a.start < b.start ? 1 : -1))[0];
  const replay = lookup.stormReplay;
  const placed = reports.filter((r) => r.detective?.verdict === "placed").length;
  return {
    id: "flood-history",
    kind: "history",
    chip: "Flood reports",
    title: "Flood reports near this address",
    origin: "NWS Local Storm Reports and NCEI Storm Events, 2015 to 2025",
    text:
      `${reports.length} flood reports within 5 km of this address are in our records (${years[0]} to ${years[years.length - 1]}): ${tierCounts.mentioned} whose own words name an address or intersection, ${tierCounts.about1km} filed at a precise or rounded point, ${tierCounts.citywide} filed only at a city placeholder. ` +
      `The most recent was ${niceDate(newest.start)}. ` +
      (replay ? `The busiest night within 15 km was ${niceDate(replay.date)}, with ${replay.reportIds.length} reports. ` : "") +
      (placed > 0 ? `The AI detective placed ${placed} of these reports from the words in the report. ` : "") +
      "A report is a written NWS report of flooding, not a measurement; this shows reports we could place near you, not every flood.",
  };
}

function reportSource(report: NearbyFlood, n: number): AiSource {
  const d = report.detective;
  const detective =
    d?.verdict === "placed"
      ? ` The AI detective placed it at ${sanitize(d.match ?? "a named place")} (${d.matchType ?? "place"}, ${d.confidence ?? "unrated"} confidence) using the clues ${d.clues.map((c) => `"${sanitize(c)}"`).join(", ")}.`
      : d
        ? " The AI detective read it and said it could not tell where this was, so it is not moved."
        : "";
  return {
    id: `report-${n}`,
    kind: "report",
    chip: `Report ${n}`,
    title: `NWS ${sanitize(report.type).toLowerCase()} report, ${niceDate(report.start)}`,
    origin: report.source === "StormEvents" ? "NCEI Storm Events" : "NWS Local Storm Report",
    text: `${sanitize(report.type)} report from ${report.source === "StormEvents" ? "NCEI Storm Events" : "an NWS Local Storm Report"}, ${localMoment(report.start)}, ${sanitize(report.city || report.county)}, ${sanitize(report.county)} County. It is ${report.distanceKm.toFixed(1)} km from this address (${TIER_TEXT[report.tier]}).${detective}`,
    quote: sanitize(report.quote),
    href: ncdcLink(report.id),
  };
}

function tornadoHistorySource(lookup: LookupPayload): AiSource | null {
  const list = lookup.tornadoes;
  if (list.length === 0) {
    return { id: "tornado-history", kind: "history", chip: "Tornado records", title: "Tornado tracks near this address", origin: "NCEI Storm Events tornado records", text: "No tornado track within 10 km of this address is in our records." };
  }
  const closest = [...list].sort((a, b) => a.minDistanceKm - b.minDistanceKm)[0];
  const strongest = [...list].sort((a, b) => Number(b.ef.replace(/\D/g, "") || 0) - Number(a.ef.replace(/\D/g, "") || 0))[0];
  return {
    id: "tornado-history",
    kind: "history",
    chip: "Tornado records",
    title: "Tornado tracks near this address",
    origin: "NCEI Storm Events tornado records",
    text: `${list.length} tornado tracks passed within 10 km of this address in our records. The closest, an ${closest.ef} on ${niceDate(closest.start)}, passed ${closest.minDistanceKm.toFixed(2)} km away. The strongest was an ${strongest.ef} on ${niceDate(strongest.start)}, ${strongest.minDistanceKm.toFixed(1)} km away. Tracks join the NWS start and end points.`,
  };
}

function tornadoSource(t: NearbyTornado, n: number): AiSource {
  const casualties = [t.deaths ? `${t.deaths} deaths` : "", t.injuries ? `${t.injuries} injuries` : ""].filter(Boolean).join(" and ");
  return {
    id: `tornado-${n}`,
    kind: "tornado",
    chip: `${t.ef} ${t.start.slice(0, 4)}`,
    title: `${t.ef} tornado, ${niceDate(t.start)}`,
    origin: "NCEI Storm Events",
    text: `${t.ef} tornado on ${niceDate(t.start)}. Its track passed ${t.minDistanceKm.toFixed(2)} km from this address. Recorded width up to ${t.widthYd} yards and length ${t.lengthMi} miles${casualties ? `; ${casualties} recorded for the county part of the track` : ""}.`,
    quote: sanitize(excerpt(t.narrative, 520).text),
    href: ncdcLink(t.id),
  };
}

function damageSource(row: DamageRow & { distanceKm: number }, n: number, tornadoes: NearbyTornado[]): AiSource {
  const tornado = tornadoes.find((t) => t.id === row.tornadoId);
  return {
    id: `damage-${n}`,
    kind: "damage",
    chip: "Damage map",
    title: `Damage place from the NWS narrative${tornado ? `, ${tornado.ef} tornado ${niceDate(tornado.start)}` : ""}`,
    origin: "AI damage mapper: a place named in the NWS tornado narrative, pinned by a geocoder match checked against the tornado track",
    text: `The NWS narrative names ${sanitize(row.place)} as a place with damage${row.ef ? ` (rated ${row.ef} there)` : ""}. The damage mapper pinned it ${row.distanceKm.toFixed(1)} km from this address (${damageWhere(row.matchType)}, ${row.confidence ?? "unrated"} confidence).`,
    quote: sanitize(row.phrase),
    href: tornado ? ncdcLink(tornado.id) : undefined,
  };
}

// ---------------------------------------------------------------- everything

export interface SourceInputs {
  lookup: LookupPayload;
  outlook: OutlookPayload;
  /** All placed damage rows for the address's state (data/damage). */
  damage: readonly DamageRow[];
}

/** The ordered list of sources for one address. The order is the order the model reads them. */
export function buildSources({ lookup, outlook, damage }: SourceInputs): AiSource[] {
  const sources: Array<AiSource | null> = [
    alertsSource(lookup),
    floodOutlookSource(outlook),
    floodRecordSource(outlook),
    tornadoOutlookSource(outlook),
    tornadoRecordSource(outlook),
    heatRiskSource(outlook),
    heatForecastSource(outlook),
    heatHistorySource(lookup),
    triggerSource(lookup),
    femaSource(lookup),
    floodHistorySource(lookup),
    ...pickReports(lookup.floods.reports).map((r, i) => reportSource(r, i + 1)),
    tornadoHistorySource(lookup),
  ];
  const nearby = [...lookup.tornadoes];
  const chosen = [...nearby].sort((a, b) => a.minDistanceKm - b.minDistanceKm).slice(0, MAX_TORNADO_SOURCES);
  chosen.forEach((t, i) => sources.push(tornadoSource(t, i + 1)));
  damageNear(damage, new Set(nearby.map((t) => t.id)), [lookup.address.lat, lookup.address.lon]).forEach((row, i) => sources.push(damageSource(row, i + 1, nearby)));
  return sources.filter((s): s is AiSource => s !== null);
}

/** The context the model reads: each source in its own tag, tagged as data. */
export function renderContext(sources: readonly AiSource[]): string {
  return sources
    .map((s) => `<source id="${s.id}" title="${s.title.replace(/"/g, "'")}">\n${s.text}${s.quote ? `\nVerbatim text: "${s.quote}"` : ""}\n</source>`)
    .join("\n");
}
