import { compassWord } from "@/lib/geo";
import { highlightSegments, formatAtOffset, readableCase } from "@/lib/ui/text";
import type { CurrentCorrection, Correction, StormModel } from "@/lib/ui/storm-model";
import type { Coord } from "@/lib/types";

const STATE_TEXT = {
  read: "Reading the words…",
  line: "The words are marked",
  move: "Re-filing the note…",
} as const;

interface Props {
  model: StormModel;
  correction: Correction;
  progress: CurrentCorrection;
  origin: Coord;
}

/** The written report being re-filed: its own words with the place words marked, then "its words say…". */
export function ReportCard({ model, correction, progress, origin }: Props) {
  const { report, placement, number } = correction;
  const row = report.row;
  const names = [row.city, row.county, ...placement.place, ...placement.support, ...placement.vague];
  const segments = highlightSegments(readableCase(row.quote, names), { place: placement.place, support: placement.support, vague: placement.vague });
  const time = formatAtOffset(report.ms, model.offsetMin, { hour: "numeric", minute: "2-digit" });
  const total = model.corrections.length;
  const dest = placement.dest;

  const state =
    progress.phase === "done"
      ? dest
        ? `Re-filed: ${placement.label} · ${correction.km?.toFixed(1)} km ${compassWord(origin, dest)}`
        : "Not placed: too vague"
      : !dest
        ? "Reading the words…"
        : progress.phase === "in" || progress.phase === "read"
          ? STATE_TEXT.read
          : progress.phase === "line"
            ? STATE_TEXT.line
            : STATE_TEXT.move;

  const say = placement.place.join(" and ");
  const cityKm = model.cityPointKm !== null ? `, ${model.cityPointKm.toFixed(1)} km from your address` : "";

  return (
    <section id="repcard" className="glass swap" key={number} aria-label="The written report being re-filed" data-ph={progress.phase}>
      <div className="rc-head">
        <span className="rc-note">
          <svg width="22" height="26" viewBox="0 0 34 42" aria-hidden="true" focusable="false">
            <path d="M3 2h20l8 8v30H3z" fill="#F5F0E7" stroke="#1b1204" strokeWidth="2.6" strokeLinejoin="round" />
            <path d="M23 2v8h8" fill="#CFC6B3" stroke="#1b1204" strokeWidth="2.6" strokeLinejoin="round" />
            <path d="M9 20h16M9 26h16M9 32h10" stroke="#1b1204" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <b>No. {number}</b>
        </span>
        <span className="rc-meta">
          {row.source === "LSR" ? "NWS Local Storm Report" : "NWS Storm Events"} · {time} {model.zone}
        </span>
        <span className="rc-state">{state}</span>
        <span className="rc-count">
          {number} of {total}
        </span>
      </div>
      <q className="rc-quote">
        {segments.map((segment, i) =>
          segment.mark ? (
            <mark key={i} className={segment.mark === "place" ? "pw" : segment.mark === "support" ? "pw2" : "pwv"}>
              {segment.text}
            </mark>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </q>
      <p className="rc-line">
        {dest ? (
          <>
            The NWS filed this note at a city point{cityKm}. Its words say <b>{say}</b>.
          </>
        ) : (
          <>
            The NWS filed this note at a city point{cityKm}. Its words only name <b>“{placement.vague[0] ?? "a region"}”</b>: a region, not a place. So the pin stays.
          </>
        )}
        {placement.status === "sample" ? <> <span className="tag sample">Sample</span></> : null}
      </p>
    </section>
  );
}
