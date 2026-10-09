"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { APP_NAME } from "@/lib/brand";
import { AnnounceProvider } from "@/components/announce";
import { MapCanvas } from "@/components/map/MapCanvas";
import { useMapApi, useMapUnavailable } from "@/components/map/map-context";
import { Dock } from "@/components/panel/Dock";
import { usePlayback } from "@/components/use-playback";
import { useReducedMotion } from "@/components/use-reduced-motion";
import type { EventEntry } from "@/lib/ui/event-catalog";
import { buildEventModel, eventFrame, keyMomentP, type EventModel, type EventPackage } from "@/lib/ui/event-model";
import type { RadarProgress } from "@/lib/ui/radar-loader";
import { formatAtOffset } from "@/lib/ui/text";
import { EventLegend } from "./EventLegend";
import { EventPanel } from "./EventPanel";
import { EventScene } from "./event-scene";

const LOAD_TIMEOUT_MS = 8000;

/** A full-screen event replay: the map opens on the storm and starts playing (or holds its key moment, with reduced motion). */
export function EventPlayer({ entry }: { entry: EventEntry }) {
  const reduced = useReducedMotion();
  const [model, setModel] = useState<EventModel | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    fetch(`/data/events/${entry.id}.json`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<EventPackage>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((pkg) => setModel(buildEventModel(pkg)))
      .catch(() => setFailed(true))
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [entry.id]);

  return (
    <AnnounceProvider>
      <a className="skip" href="#main-content">
        Skip to the story panel
      </a>
      <header id="bar" className="ev-bar">
        <a className="brand" href="/" aria-label={`${APP_NAME}, home`}>
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
            <path d="M15 2.5c4.6 6 8.2 10 8.2 14.4A8.2 8.2 0 0 1 6.8 16.9C6.8 12.5 10.4 8.5 15 2.5Z" fill="none" stroke="#FFB45A" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M11 18.2a4.4 4.4 0 0 0 3.8 3.4" fill="none" stroke="#FFB45A" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>{APP_NAME}</span>
        </a>
        <a className="ev-back" href="/#storms-h">
          More storms
        </a>
      </header>
      <MapCanvas address={null} reducedMotion={reduced}>
        <main id="main-content" tabIndex={-1}>
          {model ? (
            <EventStage entry={entry} model={model} reduced={reduced} />
          ) : (
            <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
              <p className="eyebrow">Replay · {entry.when}</p>
              <h1>{entry.title}</h1>
              {failed ? (
                <p className="errcard" role="alert">
                  <b>The replay did not load.</b> Check your connection and try again.
                </p>
              ) : (
                <p className="note" role="status">
                  Loading the wind, the track and the storm reports…
                </p>
              )}
            </aside>
          )}
        </main>
      </MapCanvas>
    </AnnounceProvider>
  );
}

function EventStage({ entry, model, reduced }: { entry: EventEntry; model: EventModel; reduced: boolean }) {
  const api = useMapApi();
  const [field, setField] = useState<"speed" | "gust">(entry.field);
  const [showRadar, setShowRadar] = useState(true);
  const [radar, setRadar] = useState<RadarProgress | null>(null);
  const keyP = useMemo(() => keyMomentP(model), [model]);
  const mapOff = useMapUnavailable();
  // Playback waits for the first radar frames, then for the frame under the playhead and the next, unless the radar is off or out.
  const radarFrames = Math.round((model.endMs - model.startMs) / (entry.radarEveryMin * 60_000)) + 1;
  const sceneRef = useRef<EventScene | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const needed = Math.min(radarFrames, Math.floor(playhead * (radarFrames - 1)) + 2);
  const waiting = showRadar && !mapOff && radar !== null && !radar.done && !radar.gaveUp;
  const radarBusy = waiting && !radar.playable;
  const stalled = radarBusy || (waiting && radar.buffered < needed);
  const playback = usePlayback({ durationMs: entry.durationMs, initialP: reduced ? keyP : 0, stalled });
  const { p, playing } = playback;
  useEffect(() => setPlayhead(p), [p]);

  useEffect(() => {
    if (!reduced) playback.play();
    // Arriving from a card is the request to play; later plays are the visitor's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!api) return;
    const scene = new EventScene(api, { model, entry, reduced, onRadar: setRadar });
    sceneRef.current = scene;
    scene.enter();
    return () => {
      scene.leave();
      sceneRef.current = null;
    };
  }, [api, model, entry, reduced]);

  useEffect(() => {
    sceneRef.current?.setState({ p, playing, field, showRadar });
  }, [p, playing, field, showRadar, api]);

  const frame = eventFrame(model, p);
  const clock = (ms: number) => formatAtOffset(ms, entry.offsetMin, { hour: "numeric", minute: "2-digit" });
  const day = formatAtOffset(frame.ms, entry.offsetMin, { weekday: "short", month: "short", day: "numeric" });
  const tick = (ms: number) => `${(((ms - model.startMs) / (model.endMs - model.startMs)) * 100).toFixed(2)}%`;
  const radarNote = radar?.gaveUp ? "The radar archive is not answering right now; the wind, track and reports still play." : null;

  return (
    <>
      <EventPanel entry={entry} model={model} frame={frame} field={field} onField={setField} showRadar={showRadar} onRadar={setShowRadar} radarNote={radarNote} />
      <EventLegend hurricane={model.track.length > 0} />
      <Dock
        playback={playback}
        busy={radarBusy}
        busyLabel={`Loading the radar: ${radar?.buffered ?? 0} of the first ${Math.min(12, radarFrames)} frames`}
        clockMain={clock(frame.ms)}
        clockSub={`${day} · ${entry.zone}`}
        sliderLabel="Replay time"
        sliderValueText={`${day}, ${clock(frame.ms)} ${entry.zone}`}
        captions={[`${clock(model.startMs)} ${formatAtOffset(model.startMs, entry.offsetMin, { month: "short", day: "numeric" })}`, `${clock(model.endMs)} ${formatAtOffset(model.endMs, entry.offsetMin, { month: "short", day: "numeric" })}`]}
        ticks={model.track
          .filter((t) => t.landfall && t.ms >= model.startMs && t.ms <= model.endMs)
          .map((t) => <i key={t.t} className="ph" style={{ left: tick(t.ms) }} />)
          .concat(model.topGustIdx.length ? [<i key="top" style={{ left: tick(model.reports[model.topGustIdx[model.topGustIdx.length - 1]]?.ms ?? model.startMs) }} />] : [])}
      />
    </>
  );
}
