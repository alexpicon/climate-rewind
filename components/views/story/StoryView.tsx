"use client";

import { HistoryNav } from "@/components/panel/HistoryNav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { useRestOnAddress } from "@/components/map/use-rest-on-address";
import { storyEvents } from "@/lib/ai/event-sources";
import { ExtremesCard, isQuiet, QuietCard } from "@/components/panel/QuietCard";
import { More } from "@/components/panel/Disclosure";
import { PrecomputedNote } from "@/components/panel/PrecomputedNote";
import type { StoryAnswer } from "@/lib/ai/types";
import type { AreaEvent, LookupPayload } from "@/lib/types";
import { requestStory, type StoryResult } from "@/lib/ui/ahead-client";
import { NEARBY_ZONE_KM } from "@/lib/constants";
import { currentZone, eventLabel, FAMILIES, familyOf, otherZonesLine, tierLabel, zoneLabel } from "@/lib/ui/story-model";
import { ClimateStrip } from "@/components/climate/ClimateStrip";
import { AiProblem } from "../ahead/AiProblem";
import { AreaReplayCard } from "./AreaReplayCard";
import { EventCard } from "./EventCard";
import { StoryMap } from "./StoryMap";
import { Timeline } from "./Timeline";

type Story = { status: "loading" } | { status: "done"; result: StoryResult };
/** Where the open event was chosen: its card opens right there, so it is never off screen. */
type Selection = { id: string; from: "story" | "timeline" } | null;

/**
 * "Your area's story": the AI's cited account of the area's biggest events, what they did, a timeline of the events since 2000 with
 * the National Weather Service's own words one click away, and, for a quiet address, the closer-to-home facts. Every address gets one.
 */
export function StoryView({
  data,
  openEvent = null,
  replayFrom = null,
  replayKinds = null,
}: {
  data: LookupPayload;
  openEvent?: string | null;
  replayFrom?: number | null;
  replayKinds?: readonly string[] | null;
}) {
  const area = data.areaEvents ?? null;
  // With area events the map view frames your zone itself (StoryMap); without them it just rests on the address.
  useRestOnAddress(data.address.lat, data.address.lon, 9, !area);
  const say = useAnnounce();
  const address = data.address.input;

  const [story, setStory] = useState<Story>({ status: "loading" });
  const [selection, setSelection] = useState<Selection>(null);
  // Events a story sentence asked to show on the map (the open event, if there is one, wins).
  const [focus, setFocus] = useState<string[]>([]);
  const [now] = useState(() => new Date());
  const run = useRef(0);
  const cardRef = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const loadStory = useCallback(async () => {
    const id = ++run.current;
    setStory({ status: "loading" });
    const result = await requestStory(address);
    if (id !== run.current) return;
    setStory({ status: "done", result });
    say(result.ok ? (result.story.state === "ok" ? `The story is ready: ${result.story.sentences.length} checked sentences, each with its sources.` : (result.story.message ?? "No story.")) : result.message);
  }, [address, say]);

  useEffect(() => {
    if (!area) return;
    void loadStory();
    return () => {
      run.current += 1;
    };
  }, [area, loadStory]);

  useEffect(() => {
    say("Your area’s story.");
  }, [say]);

  const byId = useMemo(() => new Map((area?.top ?? []).map((event) => [event.id, event])), [area]);
  const answer: StoryAnswer | null = story.status === "done" && story.result.ok ? story.result.story : null;
  const selected = selection ? (byId.get(selection.id) ?? null) : null;

  // The events the map is about: the ones the story cites once it is in, else the ten it was asked to write about.
  const mapEvents = useMemo(() => {
    if (!area) return [];
    if (answer) {
      const cited = new Set([...answer.sentences.flatMap((s) => s.cites), ...answer.impactLines.flatMap((l) => l.eventIds)]);
      const own = [...cited].map((id) => byId.get(id)).filter((e): e is AreaEvent => !!e);
      if (own.length) return own;
    }
    return storyEvents(area);
  }, [area, answer, byId]);
  const highlightIds = useMemo(() => (selection ? [selection.id] : focus), [selection, focus]);
  const showOnMap = (ids: string[]) => {
    setSelection(null);
    setFocus((current) => (current.join() === ids.join() ? [] : ids));
    say(ids.length ? "Highlighted on the map." : "Map highlight cleared.");
  };

  const select = (id: string, from: "story" | "timeline") => {
    setFocus([]);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection((current) => (current?.id === id && current.from === from ? null : { id, from }));
    const event = byId.get(id);
    if (event) say(`Showing ${eventLabel(event)}.`);
  };
  const close = () => {
    setSelection(null);
    opener.current?.focus();
  };
  // Arrived from a sample card that names one record: open it once. The timer lets the page put focus on the heading first,
  // so the card's own focus (and its scroll into view) comes last.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !openEvent || !byId.has(openEvent)) return;
    const timer = setTimeout(() => {
      opened.current = true;
      select(openEvent, "timeline");
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEvent, byId]);

  // Bring a freshly opened card into view and put the reading position on it.
  useEffect(() => {
    if (selection) cardRef.current?.focus({ preventScroll: false });
  }, [selection]);

  const card = (from: "story" | "timeline") =>
    selected && selection?.from === from ? (
      <EventCard ref={cardRef} event={selected} currentZoneCode={currentZone(area?.zones)?.code ?? null} impacts={answer?.impacts.filter((i) => i.eventId === selected.id) ?? []} onClose={close} />
    ) : null;

  const zone = zoneLabel(area?.countyName ?? null);
  const quiet = isQuiet(data);

  if (!area) {
    return (
      <aside id="panel" className="glass ahead story" aria-label="Story" tabIndex={-1}>
        <section id="v-story" className="view on" aria-labelledby="story-h">
          <HistoryNav current="story" address={data.address.input} />
          <p className="eyebrow">Your area’s story</p>
          <h1 id="story-h" className="ahead-h">
            Your area’s story
          </h1>
          <p className="ahead-addr">{data.address.matched}</p>
          <ClimateStrip lat={data.address.lat} lon={data.address.lon} address={data.address.input} />
          <p className="lede">{data.notices.areaEvents ?? "We have no area events for this address yet."}</p>
          {quiet ? <QuietCard data={data} showStoryLink={false} /> : null}
          <ExtremesCard data={data} />
          <p className="ahead-fine">Events come from NCEI Storm Events, filed by the National Weather Service. For warnings, use weather.gov.</p>
        </section>
      </aside>
    );
  }

  return (
    <>
    <StoryMap area={area} lat={data.address.lat} lon={data.address.lon} state={data.address.state} events={mapEvents} highlightIds={highlightIds} onSelect={(id) => select(id, "story")} />
    <aside id="panel" className="glass ahead story" aria-label="Story" tabIndex={-1}>
      <section id="v-story" className="view on" aria-labelledby="story-h">
        <HistoryNav current="story" address={data.address.input} />
        <p className="eyebrow">Your area’s story · NWS Storm Events since {area.since}</p>
        <h1 id="story-h" className="ahead-h">
          Your area’s story
        </h1>
        <p className="ahead-addr">
          {data.address.matched}
          {zone ? ` · ${zone} County` : ""}
        </p>

        <ClimateStrip lat={data.address.lat} lon={data.address.lon} address={data.address.input} />

        <div className="big story-big" aria-hidden="true">
          <span>{area.total.toLocaleString("en-US")}</span>
        </div>
        <p className="lede">
          weather events recorded for your county, your forecast zone and nearby zones since {area.since}.
        </p>
        {currentZone(area.zones) ? (
          <p className="ai-sub story-zones">
            Your zone: <b>{zoneLabel(currentZone(area.zones)!.name) ?? currentZone(area.zones)!.code}</b>
          </p>
        ) : null}
        {otherZonesLine(area.zones) ? (
          <More label="Other zone names counted">
            <p className="ai-sub">{otherZonesLine(area.zones)}</p>
          </More>
        ) : null}

        {/* The replay comes before the AI story: the story is written live and arrives later, and must not push the replay away. */}
        {area.county ? <AreaReplayCard lat={data.address.lat} lon={data.address.lon} state={data.address.state} county={area.county} playFrom={replayFrom} kinds={replayKinds} /> : null}

        <section className="ai-brief" aria-labelledby="story-ai-h">
          <h2 id="story-ai-h" className="sec-t">
            <span className="tag ai" aria-hidden="true">
              AI
            </span>
            <span aria-hidden="true">The story</span>
            <span className="sr">The AI story</span>
          </h2>
          <p className="ai-sub">Written by an AI from the {Math.min(10, area.top.length)} most significant recorded events here. Only sentences a record backs up are shown; select a source to read the National Weather Service’s own words.</p>
          {answer?.precomputed ? <PrecomputedNote at={answer.precomputed.at} what="story" /> : null}
          {story.status === "loading" ? (
            <>
              <p className="ai-wait" role="status">
                Reading the area’s most significant events…
              </p>
              <div className="skeleton" aria-hidden="true" />
            </>
          ) : !story.result.ok ? (
            <AiProblem result={story.result} onRetry={() => void loadStory()} />
          ) : story.result.story.state !== "ok" ? (
            <div className="ai-msg">
              <p>{story.result.story.message}</p>
            </div>
          ) : (
            <StorySentences answer={story.result.story} byId={byId} selectedId={selection?.from === "story" ? selection.id : null} onSelect={(id) => select(id, "story")} focus={focus} onShow={showOnMap} />
          )}
          {card("story")}
        </section>

        {answer && (answer.impactLines.length > 0 || answer.totalsLine) ? (
          <section className="impacts" aria-labelledby="impacts-h">
            <h2 id="impacts-h" className="sec-t">
              What these events did
            </h2>
            <ul className="impact-list">
              {answer.impactLines.map((line) => (
                <li key={`${line.type}|${line.tag}`}>
                  {line.text}
                  <span className="cites" role="group" aria-label="Events behind this line">
                    {line.eventIds.map((id) => {
                      const event = byId.get(id);
                      return event ? (
                        <button key={id} type="button" className="cite" aria-expanded={selection?.id === id && selection.from === "timeline"} onClick={() => select(id, "timeline")}>
                          {event.start.slice(0, 4)}
                          <span className="sr"> {event.type}</span>
                        </button>
                      ) : null;
                    })}
                  </span>
                </li>
              ))}
            </ul>
            {answer.totalsLine ? <p className="impact-totals">{answer.totalsLine}</p> : null}
            <p className="note quiet-note">Tags are the AI’s reading, kept only where the event’s own narrative says it. The counts and totals are added up by code from the records.</p>
          </section>
        ) : null}

        <section className="timeline" aria-labelledby="tl-h">
          <h2 id="tl-h" className="sec-t">
            Timeline, {area.since} to today
          </h2>
          <p className="ai-sub">
            The {area.top.length} most significant of {area.total.toLocaleString("en-US")} events. Bigger dots are more severe (deaths, injuries, damage, strength). Select one to read what the National Weather Service wrote.
          </p>
          <Timeline events={area.top} selectedId={selection?.from === "timeline" ? selection.id : null} onSelect={(id) => select(id, "timeline")} now={now} />
          {card("timeline")}
          <More label={`All ${area.top.length} events as a list`}>
            <ol className="ev-list">
              {[...area.top]
                .sort((a, b) => (a.start < b.start ? 1 : -1))
                .map((event) => (
                  <li key={event.id}>
                    <button type="button" aria-expanded={selection?.id === event.id && selection.from === "timeline"} onClick={() => select(event.id, "timeline")}>
                      <span className="ev-year">{event.start.slice(0, 4)}</span>
                      <span>
                        {FAMILIES[familyOf(event.type)].label.split(",")[0]}: {eventLabel(event)}
                        {event.tier === "nearby zone" ? ` · ${tierLabel(event)}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
            </ol>
          </More>
          <More label="Everything recorded, by type">
            <CountsList counts={area.counts} />
          </More>
        </section>

        {quiet ? <QuietCard data={data} showStoryLink={false} /> : null}
        <ExtremesCard data={data} />

        <p className="ahead-fine">
          Events are NCEI Storm Events rows filed by the National Weather Service for your county, the forecast zone your address is inside, and zones whose edge is within {NEARBY_ZONE_KM} km (marked “nearby zone” with the zone’s name). A zone can be larger than your neighborhood. They are filed events, not every storm. For warnings, use weather.gov.
        </p>
      </section>
    </aside>
    </>
  );
}

function StorySentences({ answer, byId, selectedId, onSelect, focus, onShow }: { answer: StoryAnswer; byId: ReadonlyMap<string, AreaEvent>; selectedId: string | null; onSelect: (id: string) => void; focus: readonly string[]; onShow: (ids: string[]) => void }) {
  const [totals, setTotals] = useState(false);
  const counts = answer.sources["area-counts"];
  return (
    <div className="ai-answer">
      <div className="ai-sents">
        {answer.sentences.map((sentence, i) => (
          <p
            className="ai-s"
            key={`${i}-${sentence.text}`}
            onClick={(event) => {
              // A plain click on the words highlights the sentence's places on the map; the "Show on map" button is the keyboard way to the same thing.
              if ((event.target as HTMLElement).closest("button, a")) return;
              const ids = sentence.cites.filter((id) => byId.has(id));
              if (ids.length) onShow(ids);
            }}
          >
            {sentence.text}
            <span className="cites" role="group" aria-label="Sources for this sentence">
              {sentence.cites.map((id) => {
                const event = byId.get(id);
                if (event) {
                  return (
                    <button key={id} type="button" className="cite" aria-expanded={selectedId === id} aria-label={`${event.type}, ${event.start.slice(0, 4)}: read the National Weather Service’s words`} onClick={() => onSelect(id)}>
                      {event.type} {event.start.slice(0, 4)}
                    </button>
                  );
                }
                if (id === "area-counts" && counts) {
                  return (
                    <button key={id} type="button" className="cite" aria-expanded={totals} onClick={() => setTotals((open) => !open)}>
                      Area totals
                    </button>
                  );
                }
                return null;
              })}
              {sentence.cites.some((id) => byId.has(id)) ? (
                <button type="button" className="cite map" aria-pressed={focus.length > 0 && focus.join() === sentence.cites.filter((id) => byId.has(id)).join()} onClick={() => onShow(sentence.cites.filter((id) => byId.has(id)))}>
                  Show on map
                </button>
              ) : null}
            </span>
          </p>
        ))}
      </div>
      {totals && counts ? (
        <section className="srccard" aria-label="Source: area totals">
          <p className="src-title">{counts.title}</p>
          <p className="src-origin">{counts.origin}</p>
          <p className="src-text">{counts.text}</p>
        </section>
      ) : null}
      {answer.dropped > 0 ? <p className="ai-dropped">{answer.dropped} {answer.dropped === 1 ? "sentence" : "sentences"} the AI wrote could not be matched to a record and {answer.dropped === 1 ? "was" : "were"} removed.</p> : null}
    </div>
  );
}

function CountsList({ counts }: { counts: Record<string, number> }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const max = rows[0]?.[1] ?? 1;
  return (
    <ul className="counts">
      {rows.map(([type, n]) => (
        <li key={type}>
          <span className="counts-t">{type}</span>
          <span className="counts-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(2, (100 * n) / max)}%`, background: FAMILIES[familyOf(type)].color }} />
          </span>
          <b>{n.toLocaleString("en-US")}</b>
        </li>
      ))}
    </ul>
  );
}
