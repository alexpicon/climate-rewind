"use client";

import { HistoryNav } from "@/components/panel/HistoryNav";
import { FemaCard } from "@/components/panel/FemaCard";
import { Pending } from "@/components/panel/LoadSteps";
import { TriggerCard } from "@/components/panel/TriggerCard";
import { More, TextVersion } from "@/components/panel/Disclosure";
import { compassWord } from "@/lib/geo";
import type { LookupPayload } from "@/lib/types";
import { NightPicker } from "./NightPicker";
import type { ReplayResult } from "@/lib/ui/lookup-client";
import { currentCorrection, replayCountsText, reportsSoFar, tallyCorrections, TIER_LABEL, type ReplayReport, type StormModel } from "@/lib/ui/storm-model";
import { rainNoteText, type RainLink } from "@/lib/ui/rain-link";
import type { LightningNight } from "@/lib/ui/lightning";
import { StormSignals } from "./StormSignals";
import type { SignatureState } from "./use-signatures";
import { excerpt, formatAtOffset, niceDate, placeName, readableCase } from "@/lib/ui/text";

interface Props {
  data: LookupPayload;
  model: StormModel;
  stage: 1 | 2;
  p: number;
  onStage: (stage: 1 | 2) => void;
  replayDate: string;
  zone: string;
  onNight: (id: string) => Promise<ReplayResult>;
  /** Heavy rain at a report's spot in the prior hour, from the loaded radar (null when the radar does not show it). */
  rainOf?: (report: ReplayReport) => RainLink | null;
  /** The satellite lightning of this night, when it was extracted for this sample (else null). */
  lightning?: LightningNight | null;
  /** The radar's hail and rotation flags for this night. */
  signatures?: SignatureState;
}

/** The storm panel: one big number, one sentence, everything else behind "More". */
export function StormPanel({ data, model, stage, p, onStage, replayDate, zone, onNight, rainOf, lightning = null, signatures }: Props) {
  const replay = data.stormReplay!;
  const origin: [number, number] = [data.address.lat, data.address.lon];
  const total = model.reports.length;
  const tally = tallyCorrections(model.corrections);
  const now = model.startMs + p * (model.endMs - model.startMs);
  const filed = reportsSoFar(model, now);
  const atEnd = p >= 0.995;

  // Correction step: how many reports have been re-filed so far.
  const count = model.corrections.length;
  const current = currentCorrection(p, count);
  const refiled = stage === 2 ? model.corrections.filter((c, i) => c.placement.dest && (atEnd || (current && i < current.index) || (current?.index === i && current.phase === "done"))).length : 0;
  const placedTotal = tally.verified + tally.sample;

  const notRun = stage === 2 && !model.canCorrect;
  const big = stage === 1 ? filed : notRun ? data.floods.reports.length : refiled;
  // "1 of 5 reports re-filed": the number is labelled, never a bare digit.
  const unit = stage === 2 && !notRun ? <small>of {count}</small> : null;
  const sentence =
    stage === 1
      ? atEnd
        ? "flood reports across this map that night. Each dot is one report, shown when it was filed."
        : `flood reports filed so far, of ${total}.`
      : notRun
        ? data.floods.reports.length === 0
          ? `reports within 5 km in the records we have. ${notRunSentence(model.detective)}`
          : `reports within 5 km, shown where the NWS filed them. ${notRunSentence(model.detective)}`
        : atEnd
          ? `reports re-filed from their own words.${tally.unknown ? ` ${tally.unknown} stays put: too vague to place.` : ""}`
          : "reports re-filed so far. Read the words, then watch the note move to the place they name.";
  const bigSr = stage === 2 && !notRun ? `${big} of ${count} ` : `${big} `;

  const nearNight = replay.reportIds.length;
  const countsText = replayCountsText(nearNight, total, model.bounds);
  const latest = model.reports.filter((r) => r.ms <= now).slice(-3).reverse();
  const { tierCounts, reports: nearby } = data.floods;

  return (
    <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
      <section id="v-storm" className="view on" aria-labelledby="storm-h">
        <HistoryNav current="storm" address={data.address.input} />
        <h1 className="sr" id="storm-h">
          Storm replay: flood reports on the night of {replayDate}
        </h1>
        <p className="eyebrow">{stage === 1 ? `Replay · ${replayDate}` : "Correction"}</p>

        <NightPicker nights={data.stormNights} current={replay.nightId} onNight={onNight} />

        <div className="steps" role="group" aria-label="Story step">
          <button type="button" aria-pressed={stage === 1} onClick={() => stage !== 1 && onStage(1)}>
            1 · Replay the storm
          </button>
          <button type="button" aria-pressed={stage === 2} onClick={() => stage !== 2 && onStage(2)}>
            {model.canCorrect ? "2 · Correct the pins" : "2 · AI detective"}
          </button>
        </div>

        <div className={`big${stage === 2 && !notRun ? " verified" : ""}`} aria-hidden="true">
          <span>{big}</span>
          {unit}
        </div>
        <p className="lede">
          <span className="sr">{bigSr}</span>
          {sentence}
          {stage === 2 && tally.sample > 0 && atEnd ? <> <span className="tag sample">{tally.sample} Sample</span></> : null}
        </p>

        {stage === 1 ? <p className="note storm-counts">{countsText}</p> : null}

        {stage === 1 ? <StormSignals lightning={lightning} signatures={signatures} nowMs={model.startMs + p * (model.endMs - model.startMs)} /> : null}

        {data.pending?.includes("trigger") ? <Pending label="Reading the rain on past flood days…" /> : <TriggerCard trigger={data.floodTrigger} />}

        <More>
          {stage === 1 ? (
            <>
              <p className="note">
                {countsText}. The reports beyond 15 km are the rest of the region that night. Shows NWS reports we could place near you, not every flood.
              </p>
              <h2 className="h3">Latest reports</h2>
              {latest.length === 0 ? (
                <div className="feed-empty">Quiet so far. The first flood reports arrive within the hour.</div>
              ) : (
                <ol className="feed" aria-label="Latest flood reports">
                  {latest.map((r) => {
                    const cityPoint = model.corrections.some((c) => c.report.id === r.id);
                    const rain = rainOf?.(r) ?? null;
                    return (
                      <li key={r.id} className={cityPoint ? "ph" : undefined}>
                        <div className="meta">
                          <time>{formatAtOffset(r.ms, model.offsetMin, { hour: "numeric", minute: "2-digit" })}</time>
                          <span>
                            {placeName(r.row.city)}, {r.row.county} Co.
                          </span>
                          {cityPoint ? <span className="chip">PINNED TO CITY POINT</span> : null}
                        </div>
                        <q>{readableCase(r.row.quote, [r.row.city, r.row.county])}</q>
                        {rain ? <span className="rainchip">{rainNoteText(rain).text}</span> : null}
                      </li>
                    );
                  })}
                </ol>
              )}
              <h2 className="h3">Within 5 km of your address</h2>
              <p className="note">
                {nearby.length === 0
                  ? "No reports in the records we have."
                  : `${nearby.length} reports in the records we have: ${tierCounts.mentioned} placed from an address in their text, ${tierCounts.about1km} filed at a point (about 1 km), ${tierCounts.citywide} filed at a city point only.`}
              </p>
            </>
          ) : notRun ? (
            <NotRunDetails data={data} model={model} />
          ) : (
            <>
              <div className="tally" aria-label="Honest tally">
                <div className="tal v"><b>{tally.verified}</b><span>verified</span></div>
                <div className="tal s"><b>{tally.sample}</b><span>sample</span></div>
                <div className="tal u"><b>{tally.unknown}</b><span>“I don’t know”</span></div>
              </div>
              <p className="note">
                The NWS filed all {count} of these reports at one city point{model.cityPointKm !== null ? `, ${model.cityPointKm.toFixed(2)} km from your address` : ""}. We don’t guess when the words are vague. Placements tagged <span className="tag sample">Sample</span> are illustrative until the detective runs on this report. The real NWS text and times are not. Only <span className="tag real">Verified</span> placements come from a real street address match.
              </p>
              <h2 className="h3">What the detective found</h2>
              <ol className="dlist">
                {model.corrections.map((c, i) => {
                  const done = atEnd || (current ? i < current.index || (current.index === i && current.phase === "done") : false);
                  const names = [c.report.row.city, c.report.row.county, ...c.placement.place, ...c.placement.support, ...c.placement.vague];
                  return (
                    <li key={c.report.id} className={`${done ? "done " : ""}${c.placement.dest ? "" : "unk"}`}>
                      <span className="n">{c.placement.dest ? c.number : "?"}</span>
                      <div>
                        <b>
                          {c.placement.dest ? c.placement.label : "I don’t know"}{" "}
                          {c.placement.status === "sample" ? <span className="tag sample">Sample</span> : c.placement.dest ? <span className="tag real">{c.placement.status === "verified" ? "Verified" : "Area"}</span> : null}
                        </b>
                        <q className="dq">{readableCase(c.report.row.quote, names)}</q>
                        <span className="s">
                          {c.placement.dest ? `${c.km?.toFixed(2)} km ${compassWord(origin, c.placement.dest)} of you. ` : ""}
                          {c.placement.why}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="note">
                {placedTotal} of {count} placed · {tally.unknown} left unplaced.
              </p>
            </>
          )}
          <FemaCard fema={data.fema} notice={data.notices.fema} pending={data.pending?.includes("fema")} />
          {data.notices.index ? <p className="note">{data.notices.index}</p> : null}

          <TextVersion>
            <p>
              <b>Replay.</b> On {replayDate}, between {formatAtOffset(model.startMs, model.offsetMin, { hour: "numeric", minute: "2-digit" })} and{" "}
              {formatAtOffset(model.endMs, model.offsetMin, { hour: "numeric", minute: "2-digit" })} ({zone}), the National Weather Service filed flood and flash flood reports in the region around {data.address.matched}. {countsText}. This is a time-lapse of real NWS radar, 1 second of animation for {replay.frameMinutes} minutes of storm. Each dot is a flood report shown at the minute it was filed. The dots do not move; the rain does.
            </p>
            {!model.canCorrect ? (
              <>
                <p>
                  <b>Flood detective.</b> {notRunSentence(model.detective)} The {data.floods.reports.length} reports within 5 km of the address are listed exactly as the NWS filed them, with how precisely each was placed.
                </p>
                {data.floods.reports.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Distance</th>
                        <th scope="col">How it was placed</th>
                        <th scope="col">NWS words (excerpt)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.floods.reports.map((r) => (
                        <tr key={r.id}>
                          <th scope="row">{niceDate(r.start)}</th>
                          <td>{r.distanceKm.toFixed(2)} km</td>
                          <td>{TIER_LABEL[r.tier]}</td>
                          <td>{readableCase(excerpt(r.quote, 200).text, [r.city, r.county])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </>
            ) : null}
            {count > 0 ? (
              <p>
                <b>Flood detective.</b> Each pin is a written flood report, not a storm. {count} of the reports were filed by the NWS at one city point{model.cityPointKm !== null ? `, ${model.cityPointKm.toFixed(2)} km from the address` : ""}. For each one the screen shows its own words with the place words underlined and moves the pin to the place they name.{" "}
                {model.corrections.map((c) => `Report ${c.number}: ${c.placement.dest ? `${c.placement.label}, ${c.km?.toFixed(2)} km ${compassWord(origin, c.placement.dest)}${c.placement.status === "sample" ? " (sample placement)" : ""}` : "too vague, not placed"}.`).join(" ")}
              </p>
            ) : null}
          </TextVersion>
        </More>
      </section>
    </aside>
  );
}

export function notRunSentence(state: StormModel["detective"]): string {
  return state === "nothing-to-move"
    ? "The AI detective has run here, and no group of reports was pinned to one city point, so there was nothing to move."
    : "The AI detective hasn’t run for this area yet.";
}

/** Step 2 before the detective has results: the reports as filed, with their precision tiers. Moves nothing. */
function NotRunDetails({ data, model }: { data: LookupPayload; model: StormModel }) {
  const { reports, tierCounts } = data.floods;
  const nearest = reports.slice(0, 6);
  return (
    <>
      <div className="tally" aria-label="How precisely the NWS placed the reports within 5 km">
        <div className="tal"><b>{tierCounts.mentioned}</b><span>placed from their words</span></div>
        <div className="tal"><b>{tierCounts.about1km}</b><span>filed at a point (about 1 km)</span></div>
        <div className="tal"><b>{tierCounts.citywide}</b><span>filed at a city point only</span></div>
      </div>
      <p className="note">
        {model.detective === "nothing-to-move"
          ? "Nothing here is a guess: these are the NWS’s own points."
          : "No pin has moved. When the detective runs, it reads each city-point report and moves it to the street its words name, or says it doesn’t know. Nothing here is a guess: these are the NWS’s own points."}
      </p>
      {nearest.length > 0 ? (
        <>
          <h2 className="h3">Nearest reports, as filed</h2>
          <ol className="feed" aria-label="Nearest flood reports, as the NWS filed them">
            {nearest.map((r) => (
              <li key={r.id} className={r.tier === "citywide" ? "ph" : undefined}>
                <div className="meta">
                  <time>{niceDate(r.start)}</time>
                  <span>{r.distanceKm.toFixed(2)} km away</span>
                  <span className="tiertag">{TIER_LABEL[r.tier]}</span>
                </div>
                <q>{readableCase(excerpt(r.quote, 170).text, [r.city, r.county])}</q>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </>
  );
}

