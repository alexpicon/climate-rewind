"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_TITLE, pageTitle } from "@/lib/brand";
import type { AiJob } from "@/lib/ai-jobs";
import type { LookupPayload } from "@/lib/types";
import { focusPanelHeading } from "@/lib/ui/focus";
import { requestLookup, requestReplay, type ReplayResult } from "@/lib/ui/lookup-client";
import { DEFAULT_TAB, parseTab, viewUrl, TAB_LABEL, type Tab } from "@/lib/ui/tabs";
import { AnnounceProvider } from "./announce";
import { NavProvider, type AppNav } from "./nav-context";
import { Landing } from "./Landing";
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

type Lookup =
  | { status: "idle" }
  | { status: "loading"; address: string }
  | { status: "ready"; data: LookupPayload }
  | { status: "error"; message: string };

/** App shell: owns the address, the tab and the lookup, and keeps the URL shareable. */
export function ClimateRewindApp({ initialAddress, initialTab, detectiveRan, aiJobs = [], initialNight = null, initialView3d = false }: Props) {
  const [input, setInput] = useState(initialAddress ?? "");
  const [tab, setTab] = useState<Tab>(initialTab);
  const [lookup, setLookup] = useState<Lookup>(initialAddress ? { status: "loading", address: initialAddress } : { status: "idle" });
  // The storm night chosen in the picker (or from the link); null means the busiest one.
  const [night, setNight] = useState<string | null>(initialNight);
  // The optional 3D map (terrain and buildings) for the storm replay and tornado tabs. 2D is the default.
  const [view3d, setView3d] = useState(initialView3d);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seenTabs, setSeenTabs] = useState<ReadonlySet<Tab>>(new Set());
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
  const live = useLive(data ? { lat: data.address.lat, lon: data.address.lon } : null, data?.live ?? null, lookup.status === "loading");

  const runLookup = useCallback(async (address: string, nextTab: Tab, push: boolean, nightId: string | null = null, wants3d = false) => {
    const id = ++requestId.current;
    if (push) pendingFocus.current = true;
    setLookup({ status: "loading", address });
    setDrawerOpen(false);
    setSeenTabs(new Set());
    const result = await requestLookup(address, undefined, undefined, nightId);
    if (id !== requestId.current) return;
    if (!result.ok) {
      setLookup({ status: "error", message: result.message });
      return;
    }
    if (push) pendingFocus.current = true;
    setLookup({ status: "ready", data: result.data });
    setNight(nightId);
    const url = viewUrl(address, nextTab, nightId, wants3d);
    if (push) window.history.pushState(null, "", url);
    document.title = pageTitle(TAB_LABEL[nextTab], result.data.address.matched);
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
    void runLookup(address, tab, true, null, view3d);
  };

  /** A sample card on the landing page: fill the box and look it up in the same click. */
  const pickSample = (address: string) => {
    setInput(address);
    void runLookup(address, tab, true, null, view3d);
  };

  /** Swap in another storm night without looking the address up again. null goes back to the busiest night. */
  const switchNight = async (id: string | null, updateUrl: boolean): Promise<ReplayResult> => {
    if (!data) return { ok: false, message: "Look up an address first." };
    const wanted = id ?? data.stormNights[0]?.id;
    if (!wanted) return { ok: false, message: "No storm nights are listed for this address." };
    const result = await requestReplay({ state: data.address.state, lat: data.address.lat, lon: data.address.lon }, wanted);
    if (!result.ok) return result;
    setLookup({ status: "ready", data: { ...data, stormReplay: result.stormReplay } });
    setNight(id);
    const url = viewUrl(data.address.input, tab, id, view3d);
    if (updateUrl) window.history.replaceState(null, "", url);
    return result;
  };

  const changeTab = (next: Tab) => {
    if (next === "how") pendingFocus.current = true;
    setTab(next);
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
            <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
              <h1 className="sr">Looking up {lookup.address}</h1>
              <p className="eyebrow" role="status">Looking up your address…</p>
              <div className="skeleton" aria-hidden="true" />
              <p className="note">Matching the address, then checking FEMA, the National Weather Service and our records.</p>
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
              {tab === "story" ? <StoryView key={data.address.matched} data={data} /> : null}
              {tab === "storm" ? <StormView key={`${data.address.matched}|${data.stormReplay?.nightId ?? ""}`} data={data} reduced={reduced} firstView={!seenTabs.has("storm")} onSeen={() => markSeen("storm")} onNight={(id) => switchNight(id, true)} view3d={view3d} onView3d={toggle3d} /> : null}
              {tab === "heat" ? <HeatView key={data.address.matched} data={data} reduced={reduced} firstView={!seenTabs.has("heat")} onSeen={() => markSeen("heat")} /> : null}
              {tab === "tornado" ? <TornadoView key={data.address.matched} data={data} reduced={reduced} firstView={!seenTabs.has("tornado")} onSeen={() => markSeen("tornado")} view3d={view3d} onView3d={toggle3d} /> : null}
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
        <LiveDrawer live={live} lat={data.address.lat} lon={data.address.lon} notice={data.notices.live} trigger={data.floodTrigger} onClose={closeDrawer} />
      ) : null}
      </NavProvider>
    </AnnounceProvider>
  );
}
