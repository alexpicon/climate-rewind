"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { useMapApi } from "@/components/map/map-context";
import { Dock } from "@/components/panel/Dock";
import { Legend } from "@/components/panel/Legend";
import { ModeBadge } from "@/components/panel/ModeBadge";
import { PreRoll } from "@/components/panel/PreRoll";
import { focusPanelHeadingSoon } from "@/lib/ui/focus";
import { usePlayback } from "@/components/use-playback";
import { useRestOnAddress } from "@/components/map/use-rest-on-address";
import { heatCss, heatRgb } from "@/lib/ui/heat-colors";
import { WEEKDAYS, WEEKDAYS_LONG, summarizeGrid, weekdayOf } from "@/lib/ui/heat-model";
import { lerp, smooth } from "@/lib/ui/anim";
import { shortDay } from "@/lib/ui/text";
import type { HeatGrid, LookupPayload } from "@/lib/types";
import { HeatPanel } from "./HeatPanel";
import { HeatScene } from "./heat-scene";

interface Props {
  data: LookupPayload;
  reduced: boolean;
  firstView: boolean;
  onSeen: () => void;
}

const HEAT_MS = 30_000;

/** "12 by 17 degrees" of latitude and longitude, from the grid's own bounds. */
function regionSize(grid: HeatGrid): string {
  const lat = grid.bounds.lat[1] - grid.bounds.lat[0] + grid.step;
  const lon = grid.bounds.lon[1] - grid.bounds.lon[0] + grid.step;
  return `${lat} by ${lon} degree`;
}

export function HeatView(props: Props) {
  const { data, onSeen } = props;
  useEffect(onSeen, [onSeen]);
  // The pre-roll card is decided once, when the tab opens; the regional grid may arrive a moment later.
  const [firstView] = useState(props.firstView);

  const slug = data.heat?.regionalSlug ?? null;
  const [grid, setGrid] = useState<HeatGrid | null>(null);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    fetch(`/api/heat/${slug}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<HeatGrid>) : null))
      .then((g) => setGrid(g))
      .catch(() => setGrid(null));
    return () => controller.abort();
  }, [slug]);

  if (!data.heat) return <HeatEmpty data={data} />;
  if (!grid) return <HeatAddressOnly data={data} />;
  return <HeatRegional {...props} firstView={firstView} grid={grid} />;
}

function HeatEmpty({ data }: { data: LookupPayload }) {
  useRestOnAddress(data.address.lat, data.address.lon);
  return (
    <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
      <section id="v-heat" className="view on" aria-labelledby="heat-h">
        <h1 className="sr" id="heat-h">Heat at this address</h1>
        <p className="eyebrow">Heat at your address</p>
        <div className="big" aria-hidden="true"><span>–</span></div>
        <p className="lede">We could not get heat data for this address right now.</p>
        <p className="note">{data.notices.heat ?? "Please try again in a moment."} That does not mean it was never hot here.</p>
      </section>
    </aside>
  );
}

/** No regional grid for this place: the address chart alone, with the map resting on the address. */
function HeatAddressOnly({ data }: { data: LookupPayload }) {
  useRestOnAddress(data.address.lat, data.address.lon);
  return <HeatPanel data={data} regional={null} />;
}

function HeatRegional({ data, reduced, firstView, grid }: Props & { grid: HeatGrid }) {
  const api = useMapApi();
  const say = useAnnounce();
  const heat = data.heat!;
  const week = heat.worstWeek.daily;
  const summary = useMemo(() => summarizeGrid(grid), [grid]);
  const origin = useMemo<[number, number]>(() => [data.address.lat, data.address.lon], [data.address.lat, data.address.lon]);
  const peakDay = Math.max(0, week.findIndex((d) => d.date === heat.hottest.date));
  const [card, setCard] = useState(firstView && !reduced);
  const [sceneVersion, setSceneVersion] = useState(0);
  const sceneRef = useRef<HeatScene | null>(null);

  const playback = usePlayback({ durationMs: HEAT_MS, initialP: reduced ? peakDay / 6 : 0 });
  const { p } = playback;
  const last = week.length - 1;
  const x = p * last;
  const day = Math.min(last, Math.round(x));
  const d0 = Math.min(last, Math.floor(x));
  const d1 = Math.min(last, d0 + 1);
  const value = lerp(week[d0].feelsF, week[d1].feelsF, smooth(0, 1, x - d0));

  useEffect(() => {
    if (!api) return;
    let scene: HeatScene | null = null;
    let cancelled = false;
    // State outlines are a static file, fetched once; the map still works without them.
    fetch("/data/us-states.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((states) => {
        if (cancelled) return;
        scene = new HeatScene(api, { grid, summary, origin, reduced });
        scene.enter(states);
        sceneRef.current = scene;
        setSceneVersion((v) => v + 1);
      });
    return () => {
      cancelled = true;
      scene?.destroy();
      sceneRef.current = null;
    };
  }, [api, grid, summary, origin, reduced]);

  useEffect(() => {
    sceneRef.current?.update(p, peakDay);
  }, [p, peakDay, sceneVersion]);

  const lastDay = useRef(-1);
  useEffect(() => {
    if (lastDay.current === day) return;
    const first = lastDay.current === -1;
    lastDay.current = day;
    if (first && !playback.playing) return;
    const date = week[day].date;
    say(`${WEEKDAYS_LONG[weekdayOf(date)]} ${shortDay(date)}: ${Math.round(week[day].feelsF)} degrees feels-like at your address.${date === heat.hottest.date ? " The hottest day at this address since the record began in 2000." : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const secondsPerDay = Math.round((HEAT_MS / 1000 / last / playback.speed) * 10) / 10;

  return (
    <>
      <HeatPanel data={data} regional={{ summary, day, value, dayCount: week.length, regionSize: regionSize(grid) }} />

      <ModeBadge mode="replay" scale={<b>One day per step · about {secondsPerDay} s per day</b>} />

      {card ? (
        <PreRoll
          mode="Replay · past weather data"
          sentence="This is what the weather record shows over your street that week."
          scale={
            <>
              Recorded by weather reanalysis (ERA5 via Open-Meteo) across the region, {shortDay(week[0].date)} to {shortDay(week[last].date)}, {week[0].date.slice(0, 4)}. <b>One day per step</b>, about {secondsPerDay} seconds each.
            </>
          }
          buttonLabel="Watch the heat wave"
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
          <b>Feels-like high, °F</b>
          <div
            className="ramp"
            style={{ background: `linear-gradient(90deg,${Array.from({ length: 20 }, (_, i) => heatCss(80 + i * 2)).join(",")},rgb(${heatRgb(118).map(Math.round).join(",")}))` }}
          />
          <div className="rampt">
            {[80, 90, 100, 110].map((v) => (
              <span key={v} style={{ left: `${(((v - 80) / 38) * 100).toFixed(1)}%` }}>
                {v}
              </span>
            ))}
            <span style={{ left: "100%", transform: "translateX(-100%)" }}>118</span>
          </div>
          <div className="lg-row">
            <i className="sw-cell" />
            <span>Each square is about 55 km wide. Feels-like highs from weather reanalysis (ERA5 via Open-Meteo).</span>
          </div>
        </Legend>
      ) : null}

      <Dock
        playback={playback}
        clockMain={
          <>
            Day {day + 1}
            <small>of {week.length}</small>
          </>
        }
        clockSub={`${WEEKDAYS[weekdayOf(week[day].date)]}, ${shortDay(week[day].date)}, ${week[0].date.slice(0, 4)}`}
        sliderLabel="Day of the heat wave"
        sliderValueText={`${WEEKDAYS[weekdayOf(week[day].date)]} ${shortDay(week[day].date)}, ${Math.round(week[day].feelsF)} degrees feels-like at your address`}
        captions={["Heat wave, one day per step", "Tap a day to jump to it"]}
        stepButtons={week.map((d, i) => (
          <button
            key={d.date}
            type="button"
            aria-current={i === day ? "true" : "false"}
            onClick={() => {
              playback.pause();
              playback.setP(i / last);
            }}
          >
            <span className="dw">{WEEKDAYS[weekdayOf(d.date)]}</span>{" "}
            <span className="dn">{shortDay(d.date)}</span>{" "}
            <span className="dv">{Math.round(d.feelsF)}°</span>
            {d.date === heat.hottest.date ? (
              <>
                {" "}
                <span className="pk">PEAK</span>
              </>
            ) : null}
            {/* The name is the visible text first (WCAG 2.5.3), then what the number is. */}
            <span className="sr"> feels-like at your address</span>
            <span className="bar" style={{ background: heatCss(d.feelsF) }} aria-hidden="true" />
          </button>
        ))}
      />
    </>
  );
}
