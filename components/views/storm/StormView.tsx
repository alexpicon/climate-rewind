"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { useMapApi, useMapUnavailable } from "@/components/map/map-context";
import { View3DToggle } from "@/components/map/View3DToggle";
import { Dock } from "@/components/panel/Dock";
import { Legend } from "@/components/panel/Legend";
import { ModeBadge } from "@/components/panel/ModeBadge";
import { PreRoll } from "@/components/panel/PreRoll";
import { usePanelHeight } from "@/components/panel/use-panel-height";
import { usePlayback } from "@/components/use-playback";
import type { LookupPayload } from "@/lib/types";
import type { ReplayResult } from "@/lib/ui/lookup-client";
import { MS_PER_FRAME, CORRECTION_MS, buildStormModel, currentCorrection, reportsSoFar, type ReplayReport } from "@/lib/ui/storm-model";
import { rainNoteText, type RainLink } from "@/lib/ui/rain-link";
import { focusPanelHeadingSoon } from "@/lib/ui/focus";
import { unplacedSentence } from "@/lib/ui/placements";
import { formatAtOffset, niceDate, placeName } from "@/lib/ui/text";
import { ReportCard } from "./ReportCard";
import { StormEmpty } from "./StormEmpty";
import { StormLegend } from "./StormLegend";
import { notRunSentence, StormPanel } from "./StormPanel";
import { StormScene, type RadarStatus } from "./storm-scene";
import { satelliteName } from "@/lib/ui/lightning";
import { useLightning } from "./use-lightning";
import { useSignatures } from "./use-signatures";
import { useStormOverlays } from "./use-storm-overlays";

interface Props {
  data: LookupPayload;
  reduced: boolean;
  firstView: boolean;
  /** Arrived from a sample card: skip the intro card and start playing (reduced motion keeps the end state). */
  autoplay?: boolean;
  onSeen: () => void;
  /** Switch to another storm night from the picker. */
  onNight: (id: string) => Promise<ReplayResult>;
  /** The optional 3D map view (terrain and buildings). */
  view3d: boolean;
  onView3d: () => void;
}

export function StormView(props: Props) {
  if (!props.data.stormReplay) return <StormEmpty data={props.data} />;
  return <StormReplayView {...props} />;
}

type Card = "intro" | "next" | null;

function StormReplayView({ data, reduced, firstView, autoplay = false, onSeen, onNight, view3d, onView3d }: Props) {
  const api = useMapApi();
  const say = useAnnounce();
  const origin = useMemo<[number, number]>(() => [data.address.lat, data.address.lon], [data.address.lat, data.address.lon]);
  const replay = data.stormReplay!;
  const model = useMemo(() => buildStormModel(replay, data.address, data.floods.reports), [replay, data.address, data.floods.reports]);

  const [stage, setStage] = useState<1 | 2>(1);
  const [card, setCard] = useState<Card>(firstView && !reduced && !autoplay ? "intro" : null);
  const [radar, setRadar] = useState<RadarStatus>({ total: model.frameCount, ready: 0, missing: 0, buffered: 0, playable: false, done: false, gaveUp: false });
  const [sceneVersion, setSceneVersion] = useState(0);
  const sceneRef = useRef<StormScene | null>(null);
  // The scene is built once per night; the 3D switch reaches it through setView3d, so toggling never reloads the radar.
  const view3dRef = useRef(view3d);
  view3dRef.current = view3d;
  const playAfterStage = useRef(false);
  // A brief note when a report pops in and the loaded radar shows heavy rain at its spot in the hour before. Otherwise nothing.
  const [rainNote, setRainNote] = useState<{ key: string; text: string; detail: string; when: string; place: string } | null>(null);
  const rainTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(rainTimer.current), []);

  useEffect(onSeen, [onSeen]);
  usePanelHeight();

  // Play waits only for the first dozen frames; the rest keep loading ahead of the playhead.
  // Without a map there is no radar to wait for: the replay runs on the panel's clock and reports alone.
  const mapOff = useMapUnavailable();
  const radarBusy = stage === 1 && !radar.playable && !mapOff;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const [playhead, setPlayhead] = useState(0);
  // The playhead needs its frame and the next one settled; otherwise it pauses ("buffering") until they arrive.
  const needed = Math.min(model.frameCount, Math.floor(playhead * (model.frameCount - 1)) + 2);
  const buffering = stage === 1 && !radar.done && !mapOff && radar.buffered < needed;
  const playback = usePlayback({
    durationMs: stage === 1 ? (model.frameCount - 1) * MS_PER_FRAME : CORRECTION_MS,
    initialP: reduced ? 1 : 0,
    stalled: radarBusy || buffering,
    onEnd: () => {
      if (stageRef.current === 1 && !reduced) {
        say(model.canCorrect ? "Radar replay finished. Next step: the correction." : `Radar replay finished. Next step: the AI detective. ${notRunSentence(model.detective)}`);
        setCard("next");
      }
    },
  });
  const { p, playing } = playback;
  useEffect(() => setPlayhead(p), [p]);

  useEffect(() => {
    // On arrival only. The clock waits for the first radar frames by itself (stalled), so playing now is safe.
    if (autoplay && !reduced) playback.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The map scene lives as long as this view does.
  useEffect(() => {
    if (!api) return;
    const scene = new StormScene(api, {
      model,
      origin,
      reduced,
      view3d: view3dRef.current,
      onRadar: setRadar,
      onPop: (report: ReplayReport, rain: RainLink | null) => {
        if (!rain) return;
        const { text, detail } = rainNoteText(rain);
        const when = `${formatAtOffset(report.ms, model.offsetMin, { hour: "numeric", minute: "2-digit" })} ${model.zone}`;
        setRainNote({ key: report.id, text, detail, when, place: placeName(report.row.city) });
        clearTimeout(rainTimer.current);
        rainTimer.current = setTimeout(() => setRainNote(null), 6000);
      },
    });
    scene.enter();
    sceneRef.current = scene;
    setSceneVersion((v) => v + 1);
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [api, model, origin, reduced]);

  useEffect(() => {
    sceneRef.current?.setView3d(view3d);
  }, [view3d, sceneVersion]);

  // The satellite's lightning (sample nights) and the radar's own hail and rotation flags (any address), on the replay's clock.
  const lightning = useLightning(data.address.lat, data.address.lon, replay.nightId);
  const signatures = useSignatures(replay.bounds, replay.startUtc, replay.endUtc);
  const flagged = signatures.status === "ready" ? signatures.signatures : null;
  useStormOverlays(api, lightning, flagged, reduced, model.startMs + p * (model.endMs - model.startMs), stage === 1);

  useEffect(() => {
    sceneRef.current?.setStage(stage);
  }, [stage, sceneVersion]);

  useEffect(() => {
    sceneRef.current?.update(p, playing);
  }, [p, playing, stage, sceneVersion]);

  useEffect(() => {
    if (radar.playable && !radar.done) say("Radar ready. Press play. The rest of the night keeps loading while it plays.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radar.playable]);

  useEffect(() => {
    if (!radar.done) return;
    if (radar.gaveUp) say(`The radar could not be loaded fully. ${radar.ready} of ${radar.total} frames loaded; the replay skips the rest.`);
    else if (radar.missing > 0) say(`${radar.missing} radar frame${radar.missing > 1 ? "s" : ""} could not load; the replay skips over ${radar.missing > 1 ? "them" : "it"}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radar.done]);

  const goStage = useCallback(
    (next: 1 | 2, autoplay: boolean) => {
      setRainNote(null);
      playback.pause();
      setCard(null);
      setStage(next);
      playback.setP(reduced ? 1 : 0);
      playAfterStage.current = autoplay && !reduced;
    },
    [playback, reduced],
  );

  useEffect(() => {
    if (playAfterStage.current) {
      playAfterStage.current = false;
      playback.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Step 2 with no detective results: say so, once, when the step opens.
  useEffect(() => {
    if (stage === 2 && !model.canCorrect) {
      say(`${notRunSentence(model.detective)} Showing the ${data.floods.reports.length} reports within 5 kilometres as the National Weather Service filed them.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Announce each report as the correction reaches it.
  const current = stage === 2 ? currentCorrection(p, model.corrections.length) : null;
  const announcedRef = useRef(-1);
  useEffect(() => {
    if (!current || !playing) {
      if (!current) announcedRef.current = -1;
      return;
    }
    if (announcedRef.current === current.index) return;
    announcedRef.current = current.index;
    const c = model.corrections[current.index];
    say(
      `Report ${c.number} of ${model.corrections.length}. It says: ${c.report.row.quote}. ` +
        (c.placement.dest ? `The NWS filed it at the city center. Its words say ${c.placement.place.join(" and ")}.` : unplacedSentence(c.placement)),
    );
  }, [current, playing, model.corrections, say]);

  const now = model.startMs + p * (model.endMs - model.startMs);
  const filed = reportsSoFar(model, now);
  const startLabel = formatAtOffset(model.startMs, model.offsetMin, { hour: "numeric", minute: "2-digit" });
  const endLabel = formatAtOffset(model.endMs, model.offsetMin, { hour: "numeric", minute: "2-digit" });
  const zone = model.zone;
  const minutesPerSecond = (replay.frameMinutes * playback.speed) / (MS_PER_FRAME / 1000);

  const watch = () => {
    setCard(null);
    playback.play();
  };

  return (
    <>
      <StormPanel
        data={data}
        model={model}
        stage={stage}
        p={p}
        onStage={(next) => goStage(next, next === 2 && model.canCorrect)}
        replayDate={niceDate(replay.date)}
        zone={zone}
        onNight={onNight}
        rainOf={(report) => sceneRef.current?.rainFor(report) ?? null}
        lightning={lightning}
        signatures={signatures}
      />

      <ModeBadge
        mode={stage === 1 ? "replay" : "correct"}
        title={
          stage === 1
            ? undefined
            : model.canCorrect
              ? "Each pin is a written flood report, not a storm. We’re fixing where the map filed it."
              : "Each dot is a written flood report, shown where the NWS filed it."
        }
        scale={stage === 1 ? <b>1 s ≈ {minutesPerSecond % 1 === 0 ? minutesPerSecond : minutesPerSecond.toFixed(1)} min</b> : undefined}
      />

      <View3DToggle on={view3d} onToggle={onView3d} />

      {stage === 1 ? (
        <div id="rainnote-live" role="status">
          {rainNote && !card ? (
            <p id="rainnote" className="glass" key={rainNote.key}>
              <span className="rn-ic" aria-hidden="true" />
              <span>
                <b>{rainNote.text}</b>
                <small>
                  {rainNote.when} · {rainNote.place} · {rainNote.detail}
                </small>
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      {stage === 1 && !radar.done && !mapOff ? <RadarProgressBar radar={radar} buffering={buffering} /> : null}
      {stage === 1 && radar.done && radar.missing > 0 ? (
        <p id="radarnote" className="glass" role="status">
          {radar.gaveUp ? `Radar frames are not arriving: ${radar.ready} of ${radar.total} loaded. The dots still show when each report was filed.` : `${radar.missing} of ${radar.total} radar frames unavailable; the replay skips them.`}
        </p>
      ) : null}

      {card === "intro" ? (
        <PreRoll
          mode="Replay · real past data"
          sentence="This is what really happened over your street that night."
          scale={
            <>
              A time-lapse of real NWS radar from {niceDate(replay.date)}, {startLabel} to {endLabel} ({zone}). <b>1 second ≈ {replay.frameMinutes} minutes.</b> Flood reports appear at the minute they were filed.
            </>
          }
          buttonLabel="Watch the night"
          busy={radarBusy}
          takeFocus={false}
          onLeave={focusPanelHeadingSoon}
          onGo={watch}
        />
      ) : null}
      {card === "next" ? (
        <PreRoll
          mode={model.canCorrect ? "Next · a different kind of motion" : "Next · the AI detective"}
          sentence={model.canCorrect ? "The rain is done. Now the pins move: a correction, not more storm." : notRunSentence(model.detective)}
          scale={
            model.canCorrect ? (
              <>
                The NWS pinned some reports to one city point. We move each one to the street its own text names. <b>The rain is paused.</b>
              </>
            ) : (
              <>
                So nothing moves here. We show the reports near you as the NWS filed them, and how precisely each one was placed.
              </>
            )
          }
          buttonLabel={model.canCorrect ? "Show the correction" : "See the filed reports"}
          onLeave={focusPanelHeadingSoon}
          onGo={() => goStage(2, model.canCorrect)}
          altLabel="Watch the storm again"
          onAlt={() => {
            setCard(null);
            playback.setP(0);
            playback.play();
          }}
        />
      ) : null}

      {stage === 2 && current ? <ReportCard model={model} correction={model.corrections[current.index]} progress={current} origin={origin} /> : null}

      {!card ? <StormLegend stage={stage} canCorrect={model.canCorrect} lightning={lightning ? satelliteName(lightning.source) : null} radarFlags={flagged !== null && (flagged.hail.length > 0 || flagged.vortex.length > 0)} /> : null}

      {stage === 1 || model.canCorrect ? (
      <Dock
        playback={playback}
        busy={radarBusy}
        busyLabel="Loading the first radar frames"
        clockMain={
          stage === 1 ? (
            <>
              {formatAtOffset(now, model.offsetMin, { hour: "numeric", minute: "2-digit" })}
              <small>{zone}</small>
            </>
          ) : current ? (
            <>
              Report {current.index + 1}
              <small>of {model.corrections.length}</small>
            </>
          ) : p >= 0.995 ? (
            "Done"
          ) : (
            "Ready"
          )
        }
        clockSub={
          stage === 1
            ? `${formatAtOffset(now, model.offsetMin, { weekday: "short", month: "short", day: "numeric" })}`
            : current
              ? model.corrections[current.index].placement.dest
                ? `Re-filing at ${model.corrections[current.index].placement.label}`
                : model.corrections[current.index].placement.vague.length > 0
                  ? "Reading: region-wide words"
                  : "Reading: no single spot to pin"
              : "Storm time is paused"
        }
        sliderLabel={stage === 1 ? "Storm time" : "Correction progress"}
        sliderValueText={
          stage === 1
            ? `${formatAtOffset(now, model.offsetMin, { weekday: "long", hour: "numeric", minute: "2-digit" })}, ${filed} reports`
            : `Report ${Math.min(model.corrections.length, (current?.index ?? 0) + 1)} of ${model.corrections.length}`
        }
        captions={stage === 1 ? [`The storm night, ${startLabel} to ${endLabel}`, "Ticks = flood reports filed"] : ["The correction, one report at a time", "Storm time is paused"]}
        ticks={
          stage === 1
            ? model.reports.map((r) => (
                <i
                  key={r.id}
                  className={model.corrections.some((c) => c.report.id === r.id) ? "ph" : undefined}
                  style={{ left: `${(((r.ms - model.startMs) / (model.endMs - model.startMs)) * 100).toFixed(2)}%` }}
                />
              ))
            : null
        }
        showSpeed={stage === 1}
      />
      ) : null}
    </>
  );
}

/** Honest progress: frames actually loaded out of the total, and what is waiting on what. */
function RadarProgressBar({ radar, buffering }: { radar: RadarStatus; buffering: boolean }) {
  const first = Math.min(12, radar.total);
  const text = !radar.playable
    ? `Loading the night’s radar: ${radar.buffered} of the first ${first} frames`
    : buffering
      ? `Waiting for radar frames: ${radar.ready} of ${radar.total} loaded`
      : `Radar: ${radar.ready} of ${radar.total} frames loaded, the rest load while it plays`;
  const share = radar.playable ? radar.ready / radar.total : radar.buffered / first;
  return (
    <div id="radarload" className="glass" role="status">
      <div className="bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <span>{text}</span>
    </div>
  );
}
