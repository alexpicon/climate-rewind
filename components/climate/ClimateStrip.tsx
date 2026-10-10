"use client";

import { useEffect, useState } from "react";
import { NavLink } from "@/components/nav-context";
import { fmt1 } from "@/lib/climate/chart-model";
import { signed } from "@/lib/climate/projection";
import { requestFuture } from "@/lib/climate/client";
import { buildStrip, type StripModel, type StripRow } from "@/lib/climate-strip/strip-model";
import "./climate-strip.css";

type State = { status: "loading" } | { status: "ready"; model: StripModel } | { status: "none"; message: string };

function Cell({ label, children, sub }: { label: string; children: string; sub?: string }) {
  return (
    <div className="cs-cell">
      <span className="cs-when">
        {label}
        {sub ? <small> {sub}</small> : null}
      </span>
      <b className="cs-num">{children}</b>
    </div>
  );
}

function Row({ row, model }: { row: StripRow; model: StripModel }) {
  const dash = "—";
  return (
    <li className="cs-row">
      <p className="cs-title">{row.title}</p>
      <p className="sr">{row.summary}</p>
      <div className="cs-line" aria-hidden="true">
        <Cell label={model.thenLabel}>{row.then === null ? dash : fmt1(row.then)}</Cell>
        <span className="cs-arrow">→</span>
        <Cell label={model.nowLabel} sub="last 10 years">
          {row.now === null ? dash : fmt1(row.now)}
        </Cell>
        {row.change ? (
          <p className="cs-models">
            Models project about <b>{signed(row.change.median)}</b> more a year by the {model.projectedDecade} <span className="cs-range">(range {signed(row.change.min)} to {signed(row.change.max)})</span>
          </p>
        ) : null}
      </div>
      <p className={`cs-trend${row.hasTrend ? " yes" : ""}`}>{row.hasTrend ? `A ${row.trend}.` : row.trend ? `Record: ${row.trend.replace(/^./, (c) => c.toUpperCase())}.` : ""}</p>
    </li>
  );
}

/**
 * Climate change at this address in one glance, at the top of "Your history": days a year in the record then (2000s) and now (2016–2025, the
 * last 10 years; the same windows What's changing uses), then the models' own change by the 2040s with the range across models. The numbers come from /api/future, which reads the precomputed file for prepared
 * addresses and the live archive otherwise.
 */
export function ClimateStrip({ lat, lon, address }: { lat: number; lon: number; address: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    void requestFuture(lat, lon).then((result) => {
      if (!live) return;
      if (!result.ok) return setState({ status: "none", message: result.message });
      const model = buildStrip(result.payload);
      setState(model ? { status: "ready", model } : { status: "none", message: result.payload.notices.observed ?? result.payload.notices.projected ?? "The weather record could not be read for this address." });
    });
    return () => {
      live = false;
    };
  }, [lat, lon]);

  return (
    <section className="cs" aria-labelledby="cs-h" aria-busy={state.status === "loading"}>
      <h2 id="cs-h" className="sec-t">
        How the climate here has changed
      </h2>
      {state.status === "loading" ? (
        <div role="status">
          <span className="sr">Reading the climate record for this address…</span>
          <div className="skeleton cs-skel" aria-hidden="true" />
        </div>
      ) : state.status === "none" ? (
        <p className="cs-fine">{state.message} <NavLink address={address} tab="future">See what’s changing</NavLink></p>
      ) : (
        <>
          <ul className="cs-rows">
            {state.model.hot ? <Row row={state.model.hot} model={state.model} /> : null}
            {state.model.rain ? <Row row={state.model.rain} model={state.model} /> : null}
          </ul>
          {state.model.hot?.change ? <p className="cs-caveat">{state.model.caveat}</p> : null}
          <p className="cs-fine">Days a year, averaged over the years shown. From a weather reanalysis, not a thermometer at the address. “Trend” is said only when a Mann-Kendall test gives p under 0.05.</p>
          <p className="cs-more">
            <NavLink address={address} tab="future" className="cs-link">
              See what’s changing<span className="sr"> at this address</span> →
            </NavLink>
          </p>
        </>
      )}
    </section>
  );
}
