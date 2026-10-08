"use client";

import { More, TextVersion } from "@/components/panel/Disclosure";
import { WEEKDAYS_LONG, streakAt, weekdayOf, type GridSummary } from "@/lib/ui/heat-model";
import { heatLabels } from "@/lib/ui/data-source";
import { shortDay } from "@/lib/ui/text";
import type { LookupPayload } from "@/lib/types";
import { HeatChart } from "./HeatChart";
import { nearestCity } from "./geography";

interface Props {
  data: LookupPayload;
  /** Present when the regional replay is available. */
  regional: { summary: GridSummary; day: number; value: number; dayCount: number; regionSize: string } | null;
}

/** The heat panel: the address's own number, one sentence, and the chart. The regional replay adds the map and a day strip. */
export function HeatPanel({ data, regional }: Props) {
  const heat = data.heat!;
  const week = heat.worstWeek.daily;
  const hottestYear = heat.hottest.date.slice(0, 4);
  const years = Object.keys(heat.byYear).sort();
  const label = heatLabels(heat);

  let big: number;
  let sentence: React.ReactNode;
  let eyebrow: string;

  if (regional) {
    const { summary, day, value } = regional;
    const today = week[day];
    const hot = summary.hottestByDay[day];
    const hotValue = Math.round(hot.values[day]);
    const pct = Math.round(summary.over100ByDay[day] * 100);
    const isPeak = today.date === heat.hottest.date;
    big = Math.round(value);
    eyebrow = `${shortDay(week[0].date)} – ${shortDay(week[week.length - 1].date)}, ${week[0].date.slice(0, 4)}`;
    sentence = (
      <>
        feels-like high at your address on {WEEKDAYS_LONG[weekdayOf(today.date)]} {shortDay(today.date)}.{" "}
        {isPeak ? <em>The hottest day at this address since {years[0]}.</em> : null} The hottest square on the map is {hotValue}°F near {nearestCity(hot.lat, hot.lon)}; {pct}% of the map is at 100°F or more.
      </>
    );
  } else {
    big = Math.round(heat.hottest.feelsF);
    eyebrow = "Heat at your address";
    sentence = (
      <>
        {label.measure} high on {shortDay(heat.hottest.date)}, {hottestYear}: <em>the hottest day at this address since {years[0]}.</em>
      </>
    );
  }

  const peakTotal = Math.max(...Object.values(heat.byYear));
  const worstYear = Object.keys(heat.byYear).find((y) => heat.byYear[y] === peakTotal) ?? hottestYear;

  return (
    <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
      <section id="v-heat" className="view on" aria-labelledby="heat-h">
        <h1 className="sr" id="heat-h">
          Heat at {data.address.matched}
        </h1>
        <p className="eyebrow">{eyebrow}</p>
        <div className="big" aria-hidden="true">
          <span>{big}</span>
          <small>°F</small>
        </div>
        <p className="lede">
          <span className="sr">{big} degrees Fahrenheit, </span>
          {sentence}
        </p>
        {label.explain ? <p className="note">{label.explain}</p> : null}

        {regional ? null : <HeatChart byYear={heat.byYear} hottestYear={hottestYear} measure={label.measure} />}

        <More>
          {regional ? (
            <>
              <div className="stats" aria-label="Heat wave facts">
                <div className="stat">
                  <b>{Math.round(regional.summary.peak.value)}°F</b>
                  <span>
                    Hottest square on the map, {shortDay(week[regional.summary.peak.dayIndex].date)}
                  </span>
                </div>
                <div className="stat">
                  <b>{streakAt(week, regional.day)}</b>
                  <span>{streakAt(week, regional.day) === 1 ? "day at 100°F or more" : "days in a row at 100°F or more"}</span>
                </div>
              </div>
              <HeatChart byYear={heat.byYear} hottestYear={hottestYear} />
            </>
          ) : (
            <p className="note">No regional map for this place yet, so this is the address alone. A {label.measure} high combines air temperature and humidity.</p>
          )}
          <p className="note">
            {peakTotal > 0 ? `Most days at 100°F or more: ${peakTotal} in ${worstYear}.` : `No day reached 100°F at this address since ${years[0]}, by this measure.`} Daily highs from {label.source}; this shows the past, not a trend or a forecast.
          </p>
          {data.notices.heat ? <p className="note">{data.notices.heat}</p> : null}

          <TextVersion>
            <p>
              {label.measure === "heat index" ? "Heat-index" : "Feels-like"} daily highs at this address, {years[0]} to {years[years.length - 1]}, from {label.source}. The hottest day was {shortDay(heat.hottest.date)}, {hottestYear}, at {Math.round(heat.hottest.feelsF)}°F. The week around it:{" "}
              {week.map((d) => `${shortDay(d.date)}: ${Math.round(d.feelsF)}°F`).join("; ")}.
              {regional
                ? ` The map covers a ${regional.regionSize} area around your address in ${regional.summary.cells.length.toLocaleString("en-US")} squares, each about 55 km wide, and the camera is locked so you can never see past the edge of the data. Each square is one feels-like high from the same reanalysis, not a thermometer reading; nothing is smoothed. Day by day, the hottest square on the map: ${week.map((d, i) => `${shortDay(d.date)}: ${Math.round(regional.summary.hottestByDay[i].values[i])}°F near ${nearestCity(regional.summary.hottestByDay[i].lat, regional.summary.hottestByDay[i].lon)}`).join("; ")}.`
                : ""}
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Days at 100°F or more</th>
                </tr>
              </thead>
              <tbody>
                {years.map((year) => (
                  <tr key={year}>
                    <th scope="row">{year}</th>
                    <td>{heat.byYear[year]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TextVersion>
        </More>
      </section>
    </aside>
  );
}
