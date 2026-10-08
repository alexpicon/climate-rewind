"use client";

import type { Live } from "./use-live";

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const untilOf = (iso: string | null) => (iso ? ` · until ${timeOf(Date.parse(iso))}` : "");

/** Small dot plus short text: green when quiet, red only for a real active warning. Opens the drawer. */
export function LiveStrip({ live, open, onToggle }: { live: Live; open: boolean; onToggle: () => void }) {
  const when = live.checkedAt ? timeOf(live.checkedAt) : "";
  const first = live.alerts[0];
  const more = live.alerts.length - 1;

  let full: string;
  let short: string;
  switch (live.state) {
    case "loading":
      full = "Live: checking NWS alerts for this address…";
      short = "Live: checking…";
      break;
    case "error":
      full = "Live: couldn’t reach the NWS · tap to retry";
      short = "Live: no connection";
      break;
    case "calm":
      full = `Live: no NWS alerts for this address right now · checked ${when}`;
      short = "Live: no alerts";
      break;
    default:
      full = `Live: ${first.event}${more > 0 ? ` + ${more} more` : ""}${untilOf(first.ends)}`;
      short = `Live: ${first.event}`;
  }

  const alerting = live.state === "watch" || live.state === "warn";

  return (
    <>
    <button
      type="button"
      id="live"
      className="live"
      data-state={live.state}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="drawer"
      aria-describedby="live-desc"
      onClick={() => (live.state === "error" ? live.refresh() : onToggle())}
    >
      <span className="ld" aria-hidden="true" />
      {/* The accessible name is the visible text (WCAG 2.5.3); the hidden one of the two spans is display:none, so it is not read. */}
      <span className="lt">
        <span className="lf">{full}</span>
        <span className="ls">{short}</span>
      </span>
      {alerting ? <span className="sr"> for this address</span> : null}
      <svg className="lchev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
    <span className="sr" id="live-desc">
      {live.state === "loading" ? "" : "Opens the live alerts drawer."}
    </span>
    </>
  );
}
