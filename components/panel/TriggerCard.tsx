import type { FloodTrigger } from "@/lib/types";
import { niceDate, titleWords } from "@/lib/ui/text";
import { dayPossessive, TRIGGER_TITLE, triggerCopy, triggerFinePrint } from "@/lib/ui/trigger-text";
import { gaugeDays, POWER_NAME } from "@/lib/ui/data-source";

/**
 * "Your street's flood trigger": the typical (median) rain on days with flood reports here, beside the official forecast.
 * Calm by design: one sentence, one line of history, fine print, and the days behind a disclosure. Never says a flood will happen.
 */
export function TriggerCard({ trigger }: { trigger: FloodTrigger }) {
  const copy = triggerCopy(trigger);
  const forecast = trigger.forecast;
  return (
    <section className={`trigger ${copy.tone}`} aria-labelledby="trig-h" data-tone={copy.tone}>
      <h2 className="trig-t" id="trig-h">
        {TRIGGER_TITLE}
      </h2>
      <p className="trig-h">{copy.headline}</p>
      {copy.context.map((line) => (
        <p className="trig-c" key={line}>
          {line}
        </p>
      ))}
      {copy.notice ? <p className="trig-n">{copy.notice}</p> : null}
      {trigger.status === "ready" ? (
        <details className="trig-days">
          <summary>The days behind this</summary>
          <table>
            <caption className="sr">Days with flood reports within 5 km, and the rain at this address</caption>
            <thead>
              <tr>
                <th scope="col">Flood reports on</th>
                <th scope="col">Rain (inches)</th>
              </tr>
            </thead>
            <tbody>
              {trigger.history.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{niceDate(day.date)}</th>
                  <td>
                    {day.rainIn.toFixed(2)}
                    <small className="trig-src">{day.station ? ((day.gauges ?? 1) > 1 ? `median of ${day.gauges} gauges, nearest ${day.stationKm} km` : `${titleCase(day.station)} gauge, ${day.stationKm} km`) : "grid"}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="trig-n">The typical rain is the median of these days: {trigger.triggerIn?.toFixed(2)} in.</p>
          {gaugeDays(trigger).measured > 0 ? (
            <p className="trig-n">
              Where it says “gauge”, the rain was measured by NOAA rain gauges within 25 km (GHCN-Daily: airports, weather observers and
              CoCoRaHS volunteers), and where several read the day, it is the median of them. Each gauge counts its largest daily total
              from the day before to the day itself at an airport, or to the day after at a gauge read each morning, since an evening storm
              is filed under the next morning’s date.
            </p>
          ) : null}
          {gaugeDays(trigger).measured < trigger.history.length ? (
          <p className="trig-n">
            {gaugeDays(trigger).measured > 0 ? "Where it says “grid”, the" : "Rain is the"} larger of that day’s total and the day before’s, from{" "}
            {trigger.rainSource === "nasa-power"
              ? `${POWER_NAME} (Open-Meteo was not answering; about a 50 km grid`
              : trigger.rainSource === "mixed"
                ? `ERA5 and ${POWER_NAME} (Open-Meteo did not answer for some dates; about a 25 to 50 km grid`
                : "ERA5 (about a 25 km grid"}
            , which can miss a small storm, so a low total does not mean it was a light rain on the street).
          </p>
          ) : null}
          {forecast ? (
            <table>
              <caption className="sr">Official forecast, rain per day</caption>
              <thead>
                <tr>
                  <th scope="col">National Weather Service forecast</th>
                  <th scope="col">Rain (inches)</th>
                </tr>
              </thead>
              <tbody>
                {forecast.days.map((day, i) => (
                  <tr key={day.date}>
                    <th scope="row">{dayPossessive(i, day.date).replace(/’s$/, "")}</th>
                    <td>{day.inches.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </details>
      ) : null}
      <p className="trig-fine">{triggerFinePrint(trigger)}</p>
    </section>
  );
}

/** "NASHVILLE INTERNATIONAL AIRPORT, TN US" as "Nashville International Airport". */
function titleCase(station: string): string {
  return titleWords(station.replace(/,\s*[A-Z]{2}\s+US$/, "").toLowerCase());
}
