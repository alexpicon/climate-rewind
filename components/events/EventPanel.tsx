"use client";

import { formatAtOffset } from "@/lib/ui/text";
import type { EventEntry } from "@/lib/ui/event-catalog";
import { KT_TO_MPH, categoryOf, kindCounts, type EventFrame, type EventModel } from "@/lib/ui/event-model";

interface Props {
  entry: EventEntry;
  model: EventModel;
  frame: EventFrame;
  field: "speed" | "gust";
  onField: (field: "speed" | "gust") => void;
  showRadar: boolean;
  onRadar: (on: boolean) => void;
  radarNote: string | null;
}

const n = (x: number) => x.toLocaleString("en-US");
const mph = (kt: number) => Math.round((kt * KT_TO_MPH) / 5) * 5;

/** The story panel beside an event replay: what is on the map right now in words, the switches, and the text version. */
export function EventPanel({ entry, model, frame, field, onField, showRadar, onRadar, radarNote }: Props) {
  const at = (ms: number, opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }) => formatAtOffset(ms, entry.offsetMin, opts);
  const counts = kindCounts(model, frame.seen);
  const fix = frame.storm?.fix ?? null;
  const top = frame.topGust;
  const gusts = model.reports.filter((r) => r.gustMph !== null).sort((a, b) => (b.gustMph ?? 0) - (a.gustMph ?? 0)).slice(0, 10);

  return (
    <aside id="panel" className="glass ev-panel" aria-label="Story" tabIndex={-1}>
      <p className="eyebrow">Replay · {entry.when}</p>
      <h1 id="ev-h">{entry.title}</h1>
      <p className="lede">{entry.lede}</p>
      {entry.caveat ? <p className="ev-caveat">{entry.caveat}</p> : null}

      <dl className="ev-now" aria-label="On the map now">
        <div>
          <dt>Model wind, strongest now</dt>
          <dd>
            <b>{n(frame.peak.speed)} mph</b> sustained · gusts to <b>{n(frame.peak.gust)} mph</b>
          </dd>
        </div>
        {fix ? (
          <div>
            <dt>Best track, {at(fix.ms)} {entry.zone}</dt>
            <dd>
              <b>{categoryOf(fix.windKt, fix.status)}</b> · {mph(fix.windKt)} mph · {fix.pressureMb} mb
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Storm reports so far</dt>
          <dd>
            <b>{n(frame.seen)}</b>
            <span className="ev-kinds">
              {counts.gust ? <span className="k-gust">{n(counts.gust)} gusts</span> : null}
              {counts.wind ? <span className="k-wind">{n(counts.wind)} wind reports</span> : null}
              {counts.tornado ? <span className="k-tornado">{n(counts.tornado)} tornado</span> : null}
              {counts.flood ? <span className="k-flood">{n(counts.flood)} flood</span> : null}
              {counts.surge ? <span className="k-surge">{n(counts.surge)} surge</span> : null}
            </span>
          </dd>
        </div>
        <div>
          <dt>Highest gust reported so far</dt>
          <dd>
            {top ? (
              <>
                <b>{top.gustMph} mph</b> {top.measured ? "measured" : "estimated"} · {top.city}, {top.state} · {at(top.ms)}
              </>
            ) : (
              "None yet"
            )}
          </dd>
        </div>
      </dl>

      <div className="ev-switches">
        <div role="group" aria-label="Arrows show" className="ev-seg">
          <button type="button" aria-pressed={field === "speed"} onClick={() => onField("speed")}>
            Sustained wind
          </button>
          <button type="button" aria-pressed={field === "gust"} onClick={() => onField("gust")}>
            Gusts
          </button>
        </div>
        <label className="ev-check">
          <input type="checkbox" checked={showRadar} onChange={(e) => onRadar(e.target.checked)} /> Radar
        </label>
      </div>
      {radarNote ? <p className="note" role="status">{radarNote}</p> : null}

      <details className="ev-text">
        <summary>Text version</summary>
        {model.track.length ? (
          <table>
            <caption>Best track, {entry.zone}</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Strength</th>
                <th scope="col">Wind</th>
                <th scope="col">Pressure</th>
              </tr>
            </thead>
            <tbody>
              {model.track.map((t) => (
                <tr key={t.t}>
                  <td>
                    {at(t.ms, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {t.landfall ? " (landfall)" : ""}
                  </td>
                  <td>{categoryOf(t.windKt, t.status)}</td>
                  <td>{mph(t.windKt)} mph</td>
                  <td>{t.pressureMb} mb</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <h2 className="ev-h2">Highest gusts reported</h2>
        <ol className="ev-gusts">
          {gusts.map((r, i) => (
            <li key={`${r.t}-${i}`}>
              {r.gustMph} mph {r.measured ? "measured" : "estimated"}, {r.city}, {r.state}, {at(r.ms, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} {entry.zone}
            </li>
          ))}
        </ol>
        <h2 className="ev-h2">Sources</h2>
        <ul className="ev-src">
          <li>Wind arrows: {model.pkg.wind.source}.</li>
          {model.pkg.trackSource ? <li>Track and wind reach: {model.pkg.trackSource}.</li> : null}
          <li>Reports: {model.pkg.reportsSource}, verbatim.</li>
          <li>Radar: archived NEXRAD composite reflectivity, through Iowa State University&rsquo;s IEM.</li>
        </ul>
      </details>
    </aside>
  );
}
