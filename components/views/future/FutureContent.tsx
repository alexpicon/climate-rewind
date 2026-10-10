import type { ReactNode } from "react";
import { buildChartModel, fmt1, headline, trendSentence } from "@/lib/climate/chart-model";
import { caveatLine, modelChange, SCENARIO_NOTE, signed } from "@/lib/climate/projection";
import type { FuturePayload, ObservedMeasure } from "@/lib/climate/types";
import { FutureChart } from "./FutureChart";
import "./future.css";

const MEASURE_ORDER = ["feels90", "feels100", "rain1"] as const;

function decadeLine(measure: ObservedMeasure): string {
  return measure.decades.map((d) => `${d.label === "2000s" ? "2000–2009" : d.label.replace(" to ", "–")}: ${fmt1(d.perYear)}`).join(" · ");
}

/** The numbers, in the order a person asks: what the record shows, then what models project, then how sure we are. */
export function FutureContent({ payload, explanation }: { payload: FuturePayload; explanation: ReactNode }) {
  const chart = buildChartModel(payload);
  const lede = headline(payload);
  const obs = payload.observed;
  const proj = payload.projected;
  const change = modelChange(proj);

  return (
    <>
      {lede ? <p className="lede fx-lede">{lede}</p> : null}

      {chart ? (
        <section className="fx-card" aria-labelledby="fx-chart-h">
          <h2 id="fx-chart-h" className="sec-t">
            {chart.title}
          </h2>
          <FutureChart model={chart} />
          {chart.modelNote ? <p className="fx-fine fx-note-model">{chart.modelNote}</p> : null}
          <details className="textver">
            <summary>Text version of the chart</summary>
            <table>
              <caption className="sr">{chart.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Source</th>
                  <th scope="col">Days a year</th>
                </tr>
              </thead>
              <tbody>
                {chart.bars.map((b) => (
                  <tr key={b.label}>
                    <th scope="row">{b.label}</th>
                    <td>Weather record ({b.years} years)</td>
                    <td>{fmt1(b.value)} on average</td>
                  </tr>
                ))}
                {chart.modelPast ? (
                  <tr>
                    <th scope="row">{chart.modelPast.label}</th>
                    <td>Climate models, same years</td>
                    <td>
                      {fmt1(chart.modelPast.spread.min)} to {fmt1(chart.modelPast.spread.max)} (middle {fmt1(chart.modelPast.spread.median)})
                    </td>
                  </tr>
                ) : null}
                {chart.future ? (
                  <tr>
                    <th scope="row">{chart.future.label}</th>
                    <td>Climate models, projected</td>
                    <td>
                      {fmt1(chart.future.spread.min)} to {fmt1(chart.future.spread.max)} (middle {fmt1(chart.future.spread.median)})
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </details>
        </section>
      ) : null}

      <section className="fx-card" aria-labelledby="fx-obs-h">
        <h2 id="fx-obs-h" className="sec-t">
          What the record shows{obs ? `, ${obs.firstYear} to ${obs.lastYear}` : ""}
        </h2>
        {obs ? (
          <ul className="fx-measures">
            {MEASURE_ORDER.map((id) => obs.measures.find((m) => m.id === id))
              .filter((m): m is ObservedMeasure => Boolean(m))
              .map((m) => (
                <li key={m.id}>
                  <b>{m.title}</b>
                  <span className="fx-decades">Average a year, 2000–2009 and the last 10 years: {decadeLine(m)}</span>
                  <span className={`fx-trend${m.trend?.verdict && m.trend.verdict !== "none" ? " yes" : ""}`}>{trendSentence(m)}</span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="fx-note">{payload.notices.observed ?? "The weather record could not be read for this address."}</p>
        )}
        {obs ? <p className="fx-fine">Trend test: Mann-Kendall with Sen slope on yearly counts. A trend is reported only when p is under 0.05; “no clear trend yet” means the years on record are too few or too variable to tell, not that nothing is changing. Counts come from a weather reanalysis on a grid about 25 km wide, not from a thermometer or rain gauge at the address. {obs.source}.</p> : null}
      </section>

      <section className="fx-card" aria-labelledby="fx-proj-h">
        <h2 id="fx-proj-h" className="sec-t">
          What climate models project
        </h2>
        {proj?.future && proj.baseline ? (
          <>
            {change ? (
              <p className="fx-big">
                {signed(change.median)}
                <small> days a year by the {proj.futurePeriod[0]}–{proj.futurePeriod[1]} (the models’ own change; models range from {signed(change.min)} to {signed(change.max)})</small>
              </p>
            ) : null}
            <p className="fx-line">
              Climate models: {fmt1(proj.baseline.median)}/yr ({proj.baselinePeriod[0]}–{proj.baselinePeriod[1]}, models) → {fmt1(proj.future.median)}/yr ({proj.futurePeriod[0]}–{proj.futurePeriod[1]}), days at or above {proj.thresholdF}°F. Middle model shown; the {proj.models.filter((m) => m.future !== null).length} models run from {fmt1(proj.baseline.min)} to {fmt1(proj.baseline.max)} in {proj.baselinePeriod[0]}–{proj.baselinePeriod[1]} and {fmt1(proj.future.min)} to {fmt1(proj.future.max)} in {proj.futurePeriod[0]}–{proj.futurePeriod[1]}.
            </p>
            <details className="textver">
              <summary>Each model</summary>
              <table>
                <caption className="sr">Days a year at or above {proj.thresholdF}°F, by climate model</caption>
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">{proj.baselinePeriod[0]}–{proj.baselinePeriod[1]}</th>
                    <th scope="col">{proj.futurePeriod[0]}–{proj.futurePeriod[1]}</th>
                  </tr>
                </thead>
                <tbody>
                  {proj.models.map((m) => (
                    <tr key={m.model}>
                      <th scope="row">{m.model.replace(/_/g, " ")}</th>
                      <td>{m.baseline === null ? "no data" : fmt1(m.baseline)}</td>
                      <td>{m.future === null ? "no data" : fmt1(m.future)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <p className="fx-note">{payload.notices.projected ?? "The climate models could not be read for this address."}</p>
        )}
        <p className="fx-caveat">{caveatLine(chart?.modelRun ?? null)}</p>
        <p className="fx-fine">{SCENARIO_NOTE}</p>
      </section>

      {explanation}
    </>
  );
}
