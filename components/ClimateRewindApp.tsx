"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_TITLE, pageTitle } from "@/lib/brand";
import type { AiJob } from "@/lib/ai-jobs";
import type { LookupPayload } from "@/lib/types";
import { focusPanelHeading } from "@/lib/ui/focus";
import { tidyAddress } from "@/lib/ui/text";
import { prefetchAhead } from "@/lib/ui/ahead-client";
import { applyPart } from "@/lib/lookup-parts";
import { requestReplay, requestStagedLookup, type ReplayResult } from "@/lib/ui/lookup-client";
import { DEFAULT_TAB, parseTab, viewUrl, TAB_LABEL, type SampleAddress, type Tab } from "@/lib/ui/tabs";
import { AnnounceProvider } from "./announce";
import { NavProvider, type AppNav } from "./nav-context";
import { Landing } from "./Landing";
import { LoadSteps, type Step } from "./panel/LoadSteps";
import { LiveDrawer } from "./live/LiveDrawer";
import { LiveStrip } from "./live/LiveStrip";
import { useLive } from "./live/use-live";
import { MapCanvas } from "./map/MapCanvas";
import { TopBar } from "./TopBar";
import { useReducedMotion } from "./use-reduced-motion";
import { AheadView } from "./views/ahead/AheadView";
import { HeatView } from "./views/heat/HeatView";
import { HowStandalone, HowView } from "./views/HowView";
import { OPTIONAL_VIEWS } from "./views/optional-views.generated";
import { StoryView } from "./views/story/StoryView";
import { StormView } from "./views/storm/StormView";
import { TornadoView } from "./views/tornado/TornadoView";

interface Props {
  initialAddress: string | null;
  initialTab: Tab;
  /** Real detective results exist in the data (server check); the copy says what is true. */
  detectiveRan: boolean;
  /** The AI jobs with their measured numbers (or "pending"), for the landing page and How it works. */
  aiJobs?: AiJob[];
  /** A storm night id from a shared link, or null for the busiest night. */
  initialNight?: string | null;
  /** The optional 3D map view was on in the link (?view=3d). */
  initialView3d?: boolean;
}

const OPTIONAL_TAB_IDS = ["future", "ready"] as const;

/** What the loading panel knows so far: the matched address, and which of the first two reads are in. */
interface Progress {
  matched: string | null;
  records: boolean;
  area: boolean;
}

type Lookup =
  | { status: "idle" }
  | { status: "loading"; address: string; progress: Progress }
  | { status: "ready"; data: LookupPayload }
  | { status: "error"; message: string };

/** The loading panel's list. Each line turns done when its own request comes back; the last two are read by the first view. */
function loadingSteps(progress: Progress): Step[] {
  const found = progress.matched !== null;
  const state = (done: boolean, ready: boolean): Step["state"] => (done ? "done" : ready ? "active" : "wait");
  return [
    { id: "address", label: "Finding your address", state: state(found, true), note: progress.matched ? tidyAddress(progress.matched) : undefined },
    { id: "records", label: "Reading flood and tornado records", state: state(progress.records, found) },
    { id: "area", label: "Reading events in your area since 2000", state: state(progress.area, found) },
    { id: "outlooks", label: "Reading the official outlooks", state: "wait" },
    { id: "brief", label: "Writing your brief", state: "wait" },
  ];
}

/** App shell: owns the address, the tab and the lookup, and keeps the URL shareable. */
export function ClimateRewindApp({ initialAddress, initialTab, detectiveRan, aiJobs = [], initialNight = null, initialView3d = false }: Props) {
  const [input, setInput] = useState(initialAddress ?? "");
  const [tab, setTab] = useState<Tab>(initialTab);
  const [lookup, setLookup] = useState<Lookup>(initialAddress ? { status: "loading", address: initialAddress, progress: { matched: null, records: false, area: false } } : { status: "idle" });
  // The storm night chosen in the picker (or from the link); null means the busiest one.
  const [night, setNight] = useState<string | null>(initialNight);
  // The optional 3D map (terrain and buildings) for the storm replay and tornado tabs. 2D is the default.
  const [view3d, setView3d] = useState(initialView3d);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seenTabs, setSeenTabs] = useState<ReadonlySet<Tab>>(new Set());
  // Where a sample card asked to land: that view starts playing (or opens its record) on arrival. Any other navigation clears it.
  const [arrival, setArrival] = useState<{ tab: Tab; event: string | null; tornado: string | null; replayFrom: number | null; replayKinds: readonly string[] | null } | null>(null);
  const reduced = useReducedMotion();
  const requestId = useRef(0);
  const drawerReturnFocus = useRef<HTMLElement | null>(null);
  // After a lookup, How or Back, the thing that had focus is gone; focus goes to the new heading once it is on screen.
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (pendingFocus.current && focusPanelHeading()) pendingFocus.current = false;
  });

  // The prototype's "reduce" class still drives a few motion-specific rules (see prototype.css).
  useEffect(() => {
    document.documentElement.classList.toggle("reduce", reduced);
  }, [reduced]);

  const data = lookup.status === "ready" ? lookup.data : null;
  const live = useLive(data?.address.lat ?? null, data?.address.lon ?? null, data?.live ?? null, lookup.status === "loading" || Boolean(data?.pending?.includes("live")));

  const runLookup = useCallback(async (address: string, nextTab: Tab, push: boolean, nightId: string | null = null, wants3d = false) => {
    const id = ++requestId.current;
    const current = () => id === requestId.current;
    if (push) pendingFocus.current = true;
    setLookup({ status: "loading", address, progress: { matched: null, records: false, area: false } });
    setDrawerOpen(false);
    setSeenTabs(new Set());
    // The address match, then the records and the area's events (the first view), then the slow sources one by one.
    await requestStagedLookup(address, nightId, {
      isCurrent: current,
      onAddress: (found) => {
        // "Next 7 days" opened straight from a link: its outlook read starts now, while the records load.
        if (nextTab === "ahead") prefetchAhead(address, found.lat, found.lon);
        setLookup((now) => (now.status === "loading" ? { ...now, progress: { ...now.progress, matched: found.matched } } : now));
      },
      onStep: (part) => setLookup((now) => (now.status === "loading" ? { ...now, progress: { ...now.progress, [part]: true } } : now)),
      onFail: (message) => setLookup({ status: "error", message }),
      onCore: (payload) => {
        if (push) pendingFocus.current = true;
        setLookup({ status: "ready", data: payload });
        setNight(nightId);
        const url = viewUrl(address, nextTab, nightId, wants3d);
        if (push) window.history.pushState(null, "", url);
        document.title = pageTitle(TAB_LABEL[nextTab], payload.address.matched);
      },
      onPart: (part, patch) => setLookup((now) => (now.status === "ready" ? { status: "ready", data: applyPart(now.data, part, patch) } : now)),
    });
  }, []);

  // First load from a shared URL.
  useEffect(() => {
    if (initialAddress) void runLookup(initialAddress, initialTab, false, initialNight, initialView3d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back and forward buttons.
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const address = params.get("address")?.trim() || null;
      const nextTab = parseTab(params.get("tab"));
      const nextNight = params.get("night")?.trim() || null;
      setTab(nextTab);
      setArrival(null);
      setView3d(params.get("view") === "3d");
      if (!address) {
        requestId.current += 1;
        setLookup({ status: "idle" });
        setInput("");
      } else {
        setInput(address);
        if (data?.address.input !== address) void runLookup(address, nextTab, false, nextNight, params.get("view") === "3d");
        else if (nextNight !== night) void switchNight(nextNight, false);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [data, runLookup, night, tab]);

  const submit = () => {
    const address = input.trim();
    if (!address) return;
    setArrival(null);
    void runLookup(address, tab, true, null, view3d);
  };

  /** A sample card on the landing page: look it up in the same click and land on the view its hook is about. */
  const pickSample = (sample: SampleAddress) => {
    setInput(sample.address);
    setTab(sample.tab);
    setArrival({ tab: sample.tab, event: sample.event ?? null, tornado: sample.tornado ?? null, replayFrom: sample.replayFrom ?? null, replayKinds: sample.replayKinds ?? null });
    void runLookup(sample.address, sample.tab, true, sample.night ?? null, false);
  };

  /** Swap in another storm night without looking the address up again. null goes back to the busiest night. */
  const switchNight = async (id: string | null, updateUrl: boolean): Promise<ReplayResult> => {
    if (!data) return { ok: false, message: "Look up an address first." };
    const wanted = id ?? data.stormNights[0]?.id;
    if (!wanted) return { ok: false, message: "No storm nights are listed for this address." };
    const result = await requestReplay({ state: data.address.state, lat: data.address.lat, lon: data.address.lon }, wanted);
    if (!result.ok) return result;
    // The slow parts may still be arriving: fold the night into whatever is on screen now, not into the copy this call started with.
    setLookup((now) => (now.status === "ready" ? { status: "ready", data: { ...now.data, stormReplay: result.stormReplay } } : now));
    setNight(id);
    const url = viewUrl(data.address.input, tab, id, view3d);
    if (updateUrl) window.history.replaceState(null, "", url);
    return result;
  };

  const changeTab = (next: Tab) => {
    if (next === "how") pendingFocus.current = true;
    setTab(next);
    setArrival(null);
    setDrawerOpen(false);
    window.history.pushState(null, "", viewUrl(data?.address.input ?? null, next, night, view3d));
    document.title = pageTitle(TAB_LABEL[next]);
  };

  const toggle3d = useCallback(() => {
    const next = !view3d;
    setView3d(next);
    if (data) window.history.replaceState(null, "", viewUrl(data.address.input, tab, night, next));
  }, [view3d, data, tab, night]);

  // What a card inside a view may ask for: another tab, or another address on a tab (the "hard-hit street" card).
  const nav: AppNav = {
    goTab: changeTab,
    openAddress: (address, nextTab) => {
      setInput(address);
      setTab(nextTab);
      setArrival(null);
      void runLookup(address, nextTab, true, null, view3d);
    },
  };

  const markSeen = useCallback((which: Tab) => setSeenTabs((prev) => (prev.has(which) ? prev : new Set(prev).add(which))), []);

  const toggleDrawer = () => {
    if (!drawerOpen) drawerReturnFocus.current = document.activeElement as HTMLElement;
    setDrawerOpen((open) => !open);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    document.getElementById("live")?.focus();
  };

  const autoplay = arrival?.tab === tab;

  if (lookup.status === "idle" || (lookup.status === "error" && !data)) {
    if (tab === "how") {
      return (
        <AnnounceProvider>
          <HowStandalone
            detectiveRan={detectiveRan}
            aiJobs={aiJobs}
            onBack={() => {
              pendingFocus.current = true;
              setTab(DEFAULT_TAB);
              window.history.pushState(null, "", viewUrl(null, DEFAULT_TAB));
              document.title = APP_TITLE;
            }}
          />
        </AnnounceProvider>
      );
    }
    return (
      <AnnounceProvider>
        <Landing
          detectiveRan={detectiveRan}
          aiJobs={aiJobs}
          onHow={() => {
            pendingFocus.current = true;
            setTab("how");
            window.history.pushState(null, "", viewUrl(null, "how"));
            document.title = pageTitle(TAB_LABEL.how);
          }}
          input={input}
          onInput={setInput}
          onSubmit={submit}
          onSample={pickSample}
          lookingUp={false}
          error={lookup.status === "error" ? lookup.message : null}
        />
      </AnnounceProvider>
    );
  }

  return (
    <AnnounceProvider>
      <NavProvider value={nav}>
      <a className="skip" href="#main-content">
        Skip to the story panel
      </a>
      <TopBar
        input={input}
        onInput={setInput}
        onSubmit={submit}
        matched={data?.address.matched ?? null}
        lookingUp={lookup.status === "loading"}
        tab={tab}
        address={data?.address.input ?? null}
        onTab={changeTab}
        live={<LiveStrip live={live} open={drawerOpen} onToggle={toggleDrawer} />}
      />

      <MapCanvas address={data ? { lat: data.address.lat, lon: data.address.lon, matched: data.address.matched } : null} reducedMotion={reduced}>
        <main id="main-content" tabIndex={-1}>
          {lookup.status === "loading" ? (
            <aside id="panel" className="glass ahead" aria-label="Story" tabIndex={-1}>
              <h1 className="sr">Looking up {lookup.address}</h1>
              <p className="eyebrow">Looking up {lookup.progress.matched ? "your street" : "your address"}</p>
              <LoadSteps steps={loadingSteps(lookup.progress)} label="Looking up your address" />
              <div className="skeleton" aria-hidden="true" />
              <p className="note">We read the National Weather Service’s own records. The first view comes first; the rest fills in.</p>
            </aside>
          ) : null}

          {lookup.status === "error" ? (
            <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
              <h1 className="sr">Address lookup problem</h1>
              <p className="errcard" role="alert"><b>We couldn’t look that up.</b>{lookup.message}</p>
            </aside>
          ) : null}

          {data && lookup.status === "ready" ? (
            <>
              {tab === "ahead" ? <AheadView key={data.address.matched} data={data} /> : null}
              {tab === "story" ? <StoryView key={data.address.matched} data={data} openEvent={autoplay ? (arrival?.event ?? null) : null} replayFrom={autoplay ? (arrival?.replayFrom ?? null) : null} replayKinds={autoplay ? (arrival?.replayKinds ?? null) : null} /> : null}
              {tab === "storm" ? <StormView key={`${data.address.matched}|${data.stormReplay?.nightId ?? ""}`} data={data} reduced={reduced} firstView={!seenTabs.has("storm")} autoplay={autoplay} onSeen={() => markSeen("storm")} onNight={(id) => switchNight(id, true)} view3d={view3d} onView3d={toggle3d} /> : null}
              {tab === "heat" ? <HeatView key={data.address.matched} data={data} reduced={reduced} firstView={!seenTabs.has("heat")} autoplay={autoplay} onSeen={() => markSeen("heat")} /> : null}
              {tab === "tornado" ? <TornadoView key={data.address.matched} data={data} reduced={reduced} firstView={!seenTabs.has("tornado")} autoplay={autoplay} focusTornado={autoplay ? (arrival?.tornado ?? null) : null} onSeen={() => markSeen("tornado")} view3d={view3d} onView3d={toggle3d} /> : null}
              {OPTIONAL_TAB_IDS.map((id) => {
                const View = OPTIONAL_VIEWS[id];
                return tab === id && View ? <View key={`${id}|${data.address.matched}`} data={data} /> : null;
              })}
              {tab === "how" ? <HowView lat={data.address.lat} lon={data.address.lon} detectiveRan={detectiveRan} aiJobs={aiJobs} /> : null}
            </>
          ) : null}
        </main>
      </MapCanvas>

      {drawerOpen && data ? (
        <LiveDrawer live={live} lat={data.address.lat} lon={data.address.lon} notice={data.notices.live} trigger={data.pending?.includes("trigger") ? null : data.floodTrigger} onClose={closeDrawer} />
      ) : null}
      </NavProvider>
    </AnnounceProvider>
  );
}
