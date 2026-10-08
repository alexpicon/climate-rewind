import type { FloodTrigger } from "@/lib/types";
import { niceDate } from "@/lib/ui/text";
import { dayPossessive, TRIGGER_FINE_PRINT, TRIGGER_TITLE, triggerCopy } from "@/lib/ui/trigger-text";

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
                  <td>{day.rainIn.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="trig-n">The typical rain is the median of these days: {trigger.triggerIn?.toFixed(2)} in.</p>
          <p className="trig-n">
            Rain is the larger of that day’s total and the day before’s, from ERA5 (about a 25 km grid, which can miss a small storm, so a low total does not mean it was a light rain on the street).
          </p>
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
      <p className="trig-fine">{TRIGGER_FINE_PRINT}</p>
    </section>
  );
}
