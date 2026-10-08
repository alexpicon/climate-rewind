import type { ReactNode } from "react";
import { More } from "@/components/panel/Disclosure";
import {
  ERO_LABEL,
  type EroRecordKey,
  type OutlookPayload,
  type TornadoRecordKey,
} from "@/lib/outlook-types";
import {
  dayLabel,
  dayName,
  floodRecordLine,
  heatIsNotable,
  heatRankText,
  heatRiskText,
  percentText,
  tornadoRecordLine,
  worstLevel,
  worstTornadoPercent,
} from "@/lib/ui/ahead-text";
import { niceDate } from "@/lib/ui/text";

const fmt = (n: number) => n.toLocaleString("en-US");

function Days({ label, items }: { label: string; items: Array<{ key: string; day: string; value: string; tone: string }> }) {
  return (
    <ul className="odays" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} data-tone={item.tone}>
          <span className="od-d">{item.day}</span>
          <span className="od-v">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Hazard({ id, title, who, children }: { id: string; title: string; who: string; children: ReactNode }) {
  return (
    <section className="haz" aria-labelledby={id}>
      <h3 id={id}>
        {title} <span className="who">{who}</span>
      </h3>
      {children}
    </section>
  );
}

/**
 * The three official outlooks at the address (flood, tornado, heat), each with one line on how that kind of day has played out here.
 * The outlooks are the agencies'. The lines under them are counts of past days at this address, not predictions.
 */
export function OutlookCards({ outlook }: { outlook: OutlookPayload }) {
  const { flood, tornado, heat } = outlook;

  const floodWorst = flood.days ? worstLevel(flood.days) : null;
  const floodLine = flood.days && flood.record && floodWorst ? floodRecordLine(floodWorst, flood.record) : null;
  const torPercent = tornado.days ? worstTornadoPercent(tornado.days) : 0;
  const torLine = tornado.days && tornado.record ? tornadoRecordLine(torPercent, tornado.record) : null;

  const forecast = heat.forecast ?? [];
  const hottest = forecast.length ? forecast.reduce((a, b) => (b.feelsF > a.feelsF ? b : a)) : null;

  return (
    <section className="outlooks" aria-labelledby="out-h">
      <h2 id="out-h" className="sec-t">
        Official outlooks at your address
      </h2>

      <Hazard id="haz-flood" title="Flood" who="Weather Prediction Center">
        {flood.days ? (
          <Days
            label="Excessive rainfall outlook, next 3 days"
            items={flood.days.map((d) => ({ key: d.date, day: dayLabel(d.day, d.date), value: d.level === "none" ? "No risk area" : ERO_LABEL[d.level], tone: d.level }))}
          />
        ) : (
          <p className="hz-note">{flood.notice ?? "The outlook could not be read right now."}</p>
        )}
        {floodLine ? (
          <p className="rec">
            <span className="rec-t">How this has played out here</span>
            {floodLine.sentence}
            {floodLine.few ? " That is too few days to say anything firm." : ""}
          </p>
        ) : null}
      </Hazard>

      <Hazard id="haz-tor" title="Tornado" who="Storm Prediction Center">
        {tornado.days ? (
          <Days
            label="Tornado outlook, next 3 days"
            items={tornado.days.map((d) => ({
              key: d.date,
              day: dayLabel(d.day, d.date),
              value: d.percent > 0 ? `${d.percent}%${d.kind === "severe" ? " any severe" : ""}` : d.kind === "severe" ? "No severe risk" : "No risk area",
              tone: d.percent > 0 ? "on" : "none",
            }))}
          />
        ) : (
          <p className="hz-note">{tornado.notice ?? "The outlook could not be read right now."}</p>
        )}
        {torLine ? (
          <p className="rec">
            <span className="rec-t">How this has played out here</span>
            {torLine.sentence}
            {torLine.few ? " That is too few days to say anything firm." : ""}
          </p>
        ) : null}
      </Hazard>

      <Hazard id="haz-heat" title="Heat" who="NWS HeatRisk (experimental)">
        {heat.risk ? (
          <Days
            label="HeatRisk, next 3 days"
            items={heat.risk.map((d) => ({ key: d.date, day: dayLabel(d.day, d.date), value: d.level === null ? "No value" : `${d.level} of 4`, tone: d.level === null ? "none" : String(d.level) }))}
          />
        ) : (
          <p className="hz-note">{heat.notices.risk ?? "HeatRisk could not be read right now."}</p>
        )}
        {heat.risk ? <p className="od-note">{heat.risk.map((d) => `${dayLabel(d.day, d.date)}: ${heatRiskText(d).toLowerCase()}`).join(". ")}.</p> : null}
        {hottest ? (
          <p className="rec">
            <span className="rec-t">{hottest.rank ? "Where the forecast ranks here" : "Forecast feels-like"}</span>
            {`${dayName(hottest.date)}: the National Weather Service forecasts a feels-like high of ${Math.round(hottest.feelsF)} F.`}
            {hottest.rank ? ` At this address, ${heatRankText(hottest.rank).all}${heatIsNotable(hottest) ? ` ${heatRankText(hottest.rank).season}` : ""}` : ""}
          </p>
        ) : heat.notices.forecast ? (
          <p className="hz-note">{heat.notices.forecast}</p>
        ) : null}
        {outlook.recordSlug && !heat.hasHistory ? <p className="hz-note">{heat.notices.history}</p> : null}
      </Hazard>

      {outlook.recordNotice ? <p className="hz-note">{outlook.recordNotice}</p> : null}

      <More label="The numbers behind this">
        <p className="note">
          Outlooks are the agencies’ own, read at your address.
          {flood.record || tornado.record ? " The lines marked “How this has played out here” count past days with the same outlook at this address; they are not forecasts and not the chance of anything tomorrow." : ""}
        </p>
        {flood.record ? (
          <table className="rtable">
            <caption>
              Flood reports within {flood.record.radiusKm} km, by the Weather Prediction Center’s morning outlook for this point, {niceDate(flood.record.window.start)} to {niceDate(flood.record.window.end)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Outlook</th>
                <th scope="col">Days</th>
                <th scope="col">With a flood report</th>
                <th scope="col">Since {niceDate(flood.record.redefined)}</th>
              </tr>
            </thead>
            <tbody>
              {(["none", "MRGL", "SLGT", "MDT", "HIGH"] as EroRecordKey[]).map((key) => {
                const all = flood.record!.byCategory[key];
                const since = flood.record!.sinceRedefinition[key];
                return (
                  <tr key={key}>
                    <th scope="row">{key === "none" ? "No risk area" : ERO_LABEL[key]}</th>
                    <td>{fmt(all.days)}</td>
                    <td>
                      {fmt(all.hitDays)} ({percentText(all.hitDays, all.days)})
                    </td>
                    <td>
                      {fmt(since.hitDays)} of {fmt(since.days)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {flood.record ? (
          <p className="note">
            Since {niceDate(flood.record.redefined)} the Weather Prediction Center’s levels mean at least this chance that rain exceeds flash flood guidance within 25 miles of a point: Marginal 5%, Slight 15%, Moderate 40%, High 70%. It changed them on that date, so the last column uses today’s meaning. “With a flood report” counts days with an NWS flood report that has a known location within {flood.record.radiusKm} km, which is not the event the outlook forecasts.
          </p>
        ) : null}
        {tornado.record ? (
          <table className="rtable">
            <caption>
              Tornado tracks within {tornado.record.radiusMi} miles, by the Storm Prediction Center’s morning probability for this point, {niceDate(tornado.record.window.start)} to {niceDate(tornado.record.window.end)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Tornado probability</th>
                <th scope="col">Days</th>
                <th scope="col">With a tornado track</th>
              </tr>
            </thead>
            <tbody>
              {(["none", "2", "5", "10+"] as TornadoRecordKey[]).map((key) => {
                const c = tornado.record!.byProbability[key];
                return (
                  <tr key={key}>
                    <th scope="row">{key === "none" ? "No risk area" : key === "10+" ? "10% or more" : `${key}%`}</th>
                    <td>{fmt(c.days)}</td>
                    <td>
                      {fmt(c.hitDays)} ({percentText(c.hitDays, c.days)})
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {heat.forecast && heat.forecast.some((d) => d.rank) ? (
          <table className="rtable">
            <caption>Forecast feels-like highs against this address’s own daily highs since 2000</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Forecast</th>
                <th scope="col">Hot as this, all days</th>
                <th scope="col">Hot as this, same time of year</th>
              </tr>
            </thead>
            <tbody>
              {heat.forecast.map((d) => (
                <tr key={d.date}>
                  <th scope="row">{dayName(d.date)}</th>
                  <td>{Math.round(d.feelsF)} F</td>
                  <td>{d.rank ? `${fmt(d.rank.allAtLeast)} of ${fmt(d.rank.allTotal)} (${percentText(d.rank.allAtLeast, d.rank.allTotal)})` : "n/a"}</td>
                  <td>{d.rank ? `${fmt(d.rank.seasonAtLeast)} of ${fmt(d.rank.seasonTotal)} (${percentText(d.rank.seasonAtLeast, d.rank.seasonTotal)})` : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="note">
          Flood reports are written NWS reports with a known place, not every flood. HeatRisk is experimental. The forecast feels-like and the history come from different methods (NWS forecast and ERA5 reanalysis), so a ranking is a rough guide.
        </p>
      </More>
    </section>
  );
}
