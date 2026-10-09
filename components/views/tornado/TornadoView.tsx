"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { useMapApi } from "@/components/map/map-context";
import { View3DToggle } from "@/components/map/View3DToggle";
import { Dock } from "@/components/panel/Dock";
import { Legend } from "@/components/panel/Legend";
import { ModeBadge } from "@/components/panel/ModeBadge";
import { PreRoll } from "@/components/panel/PreRoll";
import { focusPanelHeadingSoon } from "@/lib/ui/focus";
import { usePlayback } from "@/components/use-playback";
import type { LookupPayload } from "@/lib/types";
import { buildTimeline, cardTornado, closestTornado, efColor, isBig } from "@/lib/ui/tornado-model";
import { niceDate } from "@/lib/ui/text";
import { TornadoEmpty } from "./TornadoEmpty";
import { TornadoPanel } from "./TornadoPanel";
import { TornadoScene } from "./tornado-scene";
import { TornadoFlagsLayer } from "./tornado-flags-layer";
import { useTornadoFlags } from "./use-tornado-flags";
import { flagsAt } from "@/lib/ui/tornado-signatures";

interface Props {
  data: LookupPayload;
  reduced: boolean;
  firstView: boolean;
  /** Arrived from a sample card: skip the intro card and start playing (reduced motion keeps the end state). */
  autoplay?: boolean;
  onSeen: () => void;
  /** The optional 3D map view (terrain and buildings). */
  view3d: boolean;
  onView3d: () => void;
}

export function TornadoView(props: Props) {
  if (props.data.tornadoes.length === 0) return <TornadoEmpty data={props.data} />;
  return <TornadoPlayer {...props} />;
}

function TornadoPlayer({ data, reduced, firstView, autoplay = false, onSeen, view3d, onView3d }: Props) {
  const api = useMapApi();
  const say = useAnnounce();
  const timeline = useMemo(() => buildTimeline(data.tornadoes), [data.tornadoes]);
  const damage = useMemo(() => data.damage ?? [], [data.damage]);
  const origin = useMemo<[number, number]>(() => [data.address.lat, data.address.lon], [data.address.lat, data.address.lon]);
  const closest = useMemo(() => closestTornado(data.tornadoes)!, [data.tornadoes]);
  const [card, setCard] = useState(firstView && !reduced && !autoplay);
  const [sceneVersion, setSceneVersion] = useState(0);
  const sceneRef = useRef<TornadoScene | null>(null);
  // The scene is built once; the 3D switch reaches it through setView3d.
  const view3dRef = useRef(view3d);
  view3dRef.current = view3d;

  useEffect(onSeen, [onSeen]);

  const playback = usePlayback({ durationMs: timeline.totalMs, initialP: reduced ? 1 : 0 });
  const { p, playing } = playback;
  const ms = p * timeline.totalMs;

  useEffect(() => {
    if (autoplay && !reduced) playback.play();
    // On arrival only: later visits to the tab start from the card or the controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const seconds = Math.round(timeline.totalMs / 1000 / playback.speed);

  useEffect(() => {
    if (!api) return;
    const scene = new TornadoScene(api, {
      origin,
      timeline,
      damage,
      reduced,
      view3d: view3dRef.current,
      onPass: (t) => say(`A tornado passed ${t.minDistanceKm.toFixed(2)} kilometres from your address.`),
    });
    scene.enter();
    sceneRef.current = scene;
    setSceneVersion((v) => v + 1);
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [api, origin, timeline, damage, reduced, say]);

  useEffect(() => {
    sceneRef.current?.setView3d(view3d);
  }, [view3d, sceneVersion]);

  useEffect(() => {
    sceneRef.current?.update(ms, playing);
  }, [ms, playing, sceneVersion]);

  // The radar's rotation flags around each tornado, drawn as its track draws. Reduced motion: the closest tornado's, faint and still.
  const flags = useTornadoFlags(data.tornadoes);
  const flagsRef = useRef<TornadoFlagsLayer | null>(null);
  const [flagsVersion, setFlagsVersion] = useState(0);
  useEffect(() => {
    if (!api || !flags.done || flags.byId.size === 0) return;
    const layer = new TornadoFlagsLayer(api);
    layer.enter();
    flagsRef.current = layer;
    setFlagsVersion((v) => v + 1);
    return () => {
      layer.destroy();
      flagsRef.current = null;
    };
  }, [api, flags]);
  useEffect(() => {
    const shownFlags = reduced ? (flags.byId.get(closest.id) ?? []).map((flag) => ({ flag, fresh: 0.5 })) : flagsAt(timeline, flags.byId, ms);
    flagsRef.current?.update(shownFlags);
  }, [ms, timeline, flags, reduced, closest.id, flagsVersion]);

  // Read each NWS survey aloud once, as its card appears.
  const shown = cardTornado(timeline, ms);
  const saidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shown || !playing || saidRef.current === shown.id) return;
    saidRef.current = shown.id;
    say(`${shown.ef} tornado, ${niceDate(shown.start)}. The National Weather Service wrote: ${shown.narrative.slice(0, 300)}`);
  }, [shown, playing, say]);

  const latest = [...timeline.items].reverse().find((i) => ms >= i.startMs)?.tornado ?? null;
  const finale = ms >= timeline.tracksMs;

  // Year labels along the slider, spaced so they never collide.
  const years: Array<{ year: string; x: number }> = [];
  let lastX = -99;
  const width = 600;
  for (const item of timeline.items) {
    const year = item.tornado.start.slice(0, 4);
    const x = (item.startMs / timeline.totalMs) * width;
    if (!years.length || (years[years.length - 1].year !== year && x - lastX > 46 && width - x > 40)) {
      years.push({ year, x: (item.startMs / timeline.totalMs) * 100 });
      lastX = x;
    }
  }

  return (
    <>
      <TornadoPanel data={data} timeline={timeline} ms={ms} closest={closest} flags={flags} />

      <View3DToggle on={view3d} onToggle={onView3d} />

      <ModeBadge mode="replay" scale={<b>One tornado at a time, in date order · about {seconds} s</b>} />

      {card ? (
        <PreRoll
          mode="Replay · real past data"
          sentence="These are the real tornadoes the weather service recorded near your street."
          scale={
            <>
              Real NWS tornado tracks, in date order. <b>One tornado at a time:</b> about {seconds} seconds in all. After each one, the NWS’s own damage notes.
            </>
          }
          buttonLabel="Watch them, one by one"
          takeFocus={false}
          onLeave={focusPanelHeadingSoon}
          onGo={() => {
            setCard(false);
            playback.play();
          }}
        />
      ) : null}

      {!card ? (
        <Legend>
          <b>Each line is one real tornado</b>
          <p className="lg-p">From where it touched down to where it lifted (NWS start and end points). Rings = 5 and 10 km from you.</p>
          {[
            ["EF3", "EF3 or stronger: severe damage"],
            ["EF2", "EF2: considerable"],
            ["EF1", "EF0 to EF1: weaker"],
          ].map(([ef, label]) => (
            <div className="lg-row" key={ef}>
              <i style={{ height: ef === "EF3" ? 5 : ef === "EF2" ? 4 : 3, background: efColor(ef) }} />
              <span>{label}</span>
            </div>
          ))}
          <div className="lg-row lg-note">
            <i className="sw-swath" />
            <span>Faint band: its damage path, up to the NWS max width</span>
          </div>
          <div className="lg-row lg-note">
            <i className="sw-start" />
            <span>Small ring: where it touched down</span>
          </div>
          {damage.length ? (
            <div className="lg-row lg-note">
              <i className="sw-dmg" />
              <span>Diamond: a damage place the AI pinned from the NWS survey. Hover or tap it for the survey’s words.</span>
            </div>
          ) : null}
        </Legend>
      ) : null}

      <Dock
        playback={playback}
        clockMain={latest ? latest.start.slice(0, 4) : "Start"}
        clockSub={finale ? `Closest: ${closest.minDistanceKm.toFixed(2)} km` : latest ? `${niceDate(latest.start)} · ${latest.ef}` : "Starting"}
        sliderLabel="Tornadoes, in date order"
        sliderValueText={latest ? `${niceDate(latest.start)} ${latest.ef}` : "start"}
        captions={["Tornadoes in date order", "Slider shows years"]}
        withYears
        ticks={timeline.items.map((item) => (
          <i
            key={item.tornado.id}
            style={{
              left: `${((item.startMs / timeline.totalMs) * 100).toFixed(2)}%`,
              background: efColor(item.tornado.ef),
              ...(isBig(item.tornado.ef) ? { height: 14, width: 4 } : {}),
            }}
          />
        ))}
        yearLabels={years.map((y) => (
          <span key={y.year} style={{ left: `${y.x.toFixed(2)}%` }}>
            {y.year}
          </span>
        ))}
      />
    </>
  );
}
