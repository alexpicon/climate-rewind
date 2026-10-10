"use client";

import { useEffect, useState } from "react";
import { NavLink } from "@/components/nav-context";
import { fmt1 } from "@/lib/climate/chart-model";
import { requestFuture } from "@/lib/climate/client";
import { buildStrip, type StripModel, type StripRow } from "@/lib/climate-strip/strip-model";
import "./climate-strip.css";

type State = { status: "loading" } | { status: "ready"; model: StripModel } | { status: "none"; message: string };

function Cell({ label, children, tone }: { label: string; children: string; tone?: "future" }) {
  return (
    <div className={`cs-cell${tone === "future" ? " cs-future" : ""}`}>
      <span className="cs-when">{label}</span>
      <b className="cs-num">{children}</b>
    </div>
  );
}

function Row({ row, period, model }: { row: StripRow; period: string | null; model: StripModel }) {
  const dash = "—";
  return (
    <li className="cs-row">
      <p className="cs-title">{row.title}</p>
      <p className="sr">{row.summary}</p>
      <div className="cs-line" aria-hidden="true">
        <Cell label={model.thenLabel}>{row.then === null ? dash : fmt1(row.then)}</Cell>
        <span className="cs-arrow">→</span>
        <Cell label={model.nowLabel}>{row.now === null ? dash : fmt1(row.now)}</Cell>
        {row.projected ? (
          <>
            <span className="cs-arrow">→</span>
            <Cell label={`${period?.slice(0, 4)}s, models`} tone="future">
              {`${fmt1(row.projected.min)}–${fmt1(row.projected.max)}`}
            </Cell>
          </>
        ) : null}
      </div>
      <p className={`cs-trend${row.hasTrend ? " yes" : ""}`}>{row.hasTrend ? `A ${row.trend}.` : row.trend ? `Record: ${row.trend.replace(/^./, (c) => c.toUpperCase())}.` : ""}</p>
    </li>
  );
}

/**
 * Climate change at this address in one glance, at the top of "Your history": days a year then (2000s), now (2016–2025) and projected
 * (2040s, the range across climate models). The numbers come from /api/future, which reads the precomputed file for prepared
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
            {state.model.hot ? <Row row={state.model.hot} period={state.model.projectedPeriod} model={state.model} /> : null}
            {state.model.rain ? <Row row={state.model.rain} period={null} model={state.model} /> : null}
          </ul>
          {state.model.hot?.projected ? (
            <p className="cs-caveat">
              The {state.model.projectedPeriod?.slice(0, 4)}s range is from climate models (CMIP6), not a forecast: the lowest to the highest of the models, on a grid about 25 km wide.
              {state.model.hotModelNote ? ` ${state.model.hotModelNote}` : ""}
            </p>
          ) : null}
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
