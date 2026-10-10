"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { useMapApi } from "@/components/map/map-context";
import { usePlayback } from "@/components/use-playback";
import { useReducedMotion } from "@/components/use-reduced-motion";
import type { AreaReplay } from "@/lib/area-replay";
import { AREA_REPLAY_MS, buildReplayModel, finalTint, kindsLabel, onlyKinds, replayDate, replayFrame } from "@/lib/ui/area-replay-model";
import { FAMILIES, FAMILY_ORDER, money } from "@/lib/ui/story-model";
import { AreaReplayLayer } from "./area-replay-layer";

interface Props {
  lat: number;
  lon: number;
  state: string;
  county: string;
  /** Arrived to watch: scroll the card into view and play from Jan 1 of this year (reduced motion: the finished picture). */
  playFrom?: number | null;
  /** Play only these NWS event types at first (a moment card about one hazard); the visitor can show every kind. */
  kinds?: readonly string[] | null;
}

/**
 * "Every event since 2000, replayed": each event the NWS filed for the county and its zones lights its area on the map in its hazard
 * family's colour on its date, while the totals by family count up and the latest deadly or costly event is named. Ends on where it all
 * fell. A real button and a slider drive it; with reduced motion the button shows the finished picture instead of playing.
 */
export function AreaReplayCard({ lat, lon, state, county, playFrom = null, kinds = null }: Props) {
  const api = useMapApi();
  const reduced = useReducedMotion();
  const say = useAnnounce();
  const [replay, setReplay] = useState<AreaReplay | null>(null);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const layerRef = useRef<AreaReplayLayer | null>(null);
  const [layerVersion, setLayerVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), state, county });
    fetch(`/api/area-replay?${params}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<AreaReplay>) : null))
      .then((body) => (body ? setReplay(body) : setFailed(true)))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [lat, lon, state, county]);

  // A moment about one hazard opens on that hazard alone; "Show every kind" lifts the filter.
  const [narrowed, setNarrowed] = useState(Boolean(kinds?.length));
  const shown = useMemo(() => (replay ? (narrowed ? onlyKinds(replay, kinds) : replay) : null), [replay, narrowed, kinds]);
  const model = useMemo(() => (shown ? buildReplayModel(shown) : null), [shown]);
  const tint = useMemo(() => (model ? finalTint(model) : []), [model]);
  const playback = usePlayback({ durationMs: AREA_REPLAY_MS, initialP: 0, onEnd: () => say("Replay finished. The map shows where events were filed most.") });
  const { p, playing } = playback;
  const frame = model ? replayFrame(model, p) : null;
  const sectionRef = useRef<HTMLElement>(null);

  const arrived = useRef(false);
  useEffect(() => {
    if (!model || playFrom === null || arrived.current) return;
    arrived.current = true;
    setStarted(true);
    // After the page has put focus on the panel's heading (which scrolls the panel to its top), bring the replay into view.
    const timer = setTimeout(() => sectionRef.current?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" }), 350);
    if (reduced) {
      playback.setP(1);
      return () => clearTimeout(timer);
    }
    const day = (Date.UTC(playFrom, 0, 1) - Date.UTC(model.since, 0, 1)) / 86_400_000;
    playback.setP(Math.min(1, Math.max(0, day / model.spanDays)));
    playback.play();
    return () => clearTimeout(timer);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, playFrom]);

  useEffect(() => {
    if (!api || !replay || !started) return;
    const layer = new AreaReplayLayer(api, replay);
    layer.enter();
    layerRef.current = layer;
    setLayerVersion((v) => v + 1);
    return () => {
      layer.destroy();
      layerRef.current = null;
    };
  }, [api, replay, started]);

  useEffect(() => {
    if (!frame) return;
    layerRef.current?.update(p >= 1 || (reduced && !playing) ? tint : frame.lit);
    // frame is derived from p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, playing, reduced, tint, layerVersion]);

  if (failed) return null;
  if (!model || !frame || !replay) return null;

  const start = () => {
    setStarted(true);
    if (reduced) {
      playback.setP(1);
      say(`Showing where ${model.events.length} events were filed since ${model.since}.`);
    } else {
      playback.toggle();
    }
  };
  const familyCounts = FAMILY_ORDER.filter((f) => model.counts[f][model.events.length] > 0);
  const lastYear = replayFrame(model, 1).year;
  const label = playing ? "Pause" : reduced ? "Show where events were filed" : started && p < 1 ? "Play" : `Play ${model.since} to ${lastYear}`;

  return (
    <section className="area-replay" aria-labelledby="ar-h" ref={sectionRef}>
      <h2 id="ar-h" className="sec-t">
        Every event since {model.since}, replayed
      </h2>
      <p className="ai-sub">
        Each of the {model.events.length.toLocaleString("en-US")} {narrowed && kinds?.length ? `${kindsLabel(kinds)} events` : "events"} the National Weather Service filed for this county and its forecast zones lights its area on the map, in its colour, on its date.
      </p>
      {kinds?.length && replay ? (
        <p className="ar-filter">
          {narrowed ? `Only ${kindsLabel(kinds)}: ${model.events.length.toLocaleString("en-US")} of ${replay.events.length.toLocaleString("en-US")} events.` : `Every kind: ${replay.events.length.toLocaleString("en-US")} events.`}{" "}
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              playback.pause();
              playback.setP(0);
              setNarrowed((now) => !now);
            }}
          >
            {narrowed ? "Show every kind" : `Only ${kindsLabel(kinds)}`}
          </button>
        </p>
      ) : null}
      <div className="ar-controls">
        <button type="button" className="btn ar-play" onClick={start}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" /> : <path d="M8 5.5v13l11-6.5z" fill="currentColor" />}
          </svg>
          <span>{label}</span>
        </button>
        <input
          type="range"
          className="ar-slider"
          min={0}
          max={1000}
          value={Math.round(p * 1000)}
          aria-label="Replay position"
          aria-valuetext={`${frame.year}, ${frame.total} events so far`}
          onChange={(event) => {
            setStarted(true);
            playback.pause();
            playback.setP(Number(event.target.value) / 1000);
          }}
        />
        <span className="ar-year" aria-hidden="true">
          {frame.year}
        </span>
      </div>
      <ul className="ar-counts" aria-label="Events so far, by kind">
        {familyCounts.map((f) => (
          <li key={f} style={{ "--c": FAMILIES[f].color } as React.CSSProperties}>
            <b>{frame.counts[f].toLocaleString("en-US")}</b> {FAMILIES[f].label.toLowerCase()}
          </li>
        ))}
      </ul>
      <p className="ar-notable" aria-live="off">
        {frame.notable ? (
          <>
            <b>{frame.notable.type}</b>, {replayDate(model, frame.notable.day)}, {replay.areas[frame.notable.area]?.name ?? ""}
            {frame.notable.deaths > 0 ? ` · ${frame.notable.deaths} ${frame.notable.deaths === 1 ? "death" : "deaths"}` : ""}
            {frame.notable.injuries > 0 ? ` · ${frame.notable.injuries} injured` : ""}
            {frame.notable.damageUsd >= 1_000_000 ? ` · ${money(frame.notable.damageUsd)} in damage` : ""}
          </>
        ) : started ? (
          " "
        ) : null}
      </p>
      <p className="note">
        {frame.deaths > 0 ? `${frame.deaths.toLocaleString("en-US")} deaths recorded so far. ` : ""}A county’s events light the forecast zones that cover it. These are filed events, not every storm.
      </p>
    </section>
  );
}
