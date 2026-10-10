"use client";

import { PlaceChoices } from "./PlaceChoices";
import { useEffect, useRef, useState } from "react";
import { Chunk, LandingChunks } from "./landing/LandingChunks";
import { LandingSearchBar } from "./landing/LandingSearchBar";
import { BrandMark } from "./BrandMark";
import type { AiJob } from "@/lib/ai-jobs";
import { describeJobs } from "@/lib/ai-jobs";
import { APP_NAME } from "@/lib/brand";
import { landingLead } from "@/lib/ui/detective-copy";
import { featureSample, LANDING_FEATURES, type FeatureIcon } from "@/lib/ui/landing-features";
import { LANDING_MOMENTS, momentLookup } from "@/lib/ui/landing-moments";
import type { MomentsFile } from "@/lib/ui/moment-timeline";
import { MomentTimeline } from "./landing/MomentTimeline";
import { EventCards } from "./landing/EventCards";
import { RecordFlash } from "./landing/RecordFlash";
import { SampleBackdrop } from "./landing/SampleBackdrop";
import { PREVIEW_OF_ADDRESS, type SamplePreviewsFile } from "@/lib/ui/sample-preview";
import { chooseSample, SAMPLE_ADDRESSES, viewUrl, type SampleAddress } from "@/lib/ui/tabs";
import { TrackReel } from "./landing/TrackReel";

interface Props {
  input: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  lookingUp: boolean;
  error: string | null;
  /** Places to pick from, when a city name matched more than one. */
  choices?: string[];
  onChoice?: (place: string) => void;
  onHow: () => void;
  /** Real detective results exist in the data. */
  detectiveRan: boolean;
  /** The AI jobs, listed under the search. */
  aiJobs?: AiJob[];
  /** A sample card was chosen: look that address up now and open the view its hook is about (one click). Absent: the card only fills the box. */
  onSample?: (sample: SampleAddress) => void;
}

/** One small line icon per feature tile. */
const ICON_PATHS: Record<FeatureIcon, string> = {
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3.5 2",
  radar: "M12 12 19 5M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5",
  tornado: "M4 5h16M6 9h12M8 13h8M10 17h5M12 21h2",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5",
  heat: "M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0zM12 9v6",
  trend: "M4 18l6-6 4 4 6-8M15 8h5v5",
};

function FeatureGlyph({ icon }: { icon: FeatureIcon }) {
  return (
    <svg className="feat-ic" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[icon]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** First screen: who it is for, four sample addresses to start with (one click each), a search box for your own, then what it shows. */
export function Landing({ input, onInput, onSubmit, lookingUp, error, choices, onChoice, onHow, detectiveRan, aiJobs = [], onSample }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const heroFormRef = useRef<HTMLFormElement>(null);
  // The slim bar at the top: shown once the first screen's search box has scrolled out of view.
  const [barOn, setBarOn] = useState(false);
  useEffect(() => {
    const form = heroFormRef.current;
    const root = document.getElementById("landing");
    if (!form || !root) return;
    // Only once the search box has gone up past the top: on a phone it starts below the fold, and the bar must not cover the page's top.
    const observer = new IntersectionObserver(([entry]) => setBarOn(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)), { root, threshold: 0 });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);
  const backToSearch = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("ch-start")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), reduce ? 0 : 600);
  };
  const ai = landingLead(detectiveRan);
  // The moment cards' timelines: a small file, read after the page is up. Without it the cards still work, just without timelines.
  const [moments, setMoments] = useState<MomentsFile | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/moments.json", { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<MomentsFile>) : null))
      .then((file) => file && setMoments(file))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  // The moving maps behind the "Start here" cards: a small file; without it the cards are plain.
  const [previews, setPreviews] = useState<SamplePreviewsFile | null>(null);
  const [previewsPaused, setPreviewsPaused] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/sample-previews.json", { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<SamplePreviewsFile>) : null))
      .then((file) => file && setPreviews(file))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  // After a lookup that failed the page comes back to this form: put the keyboard where the problem and the fix are.
  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);
  // Three of the AI jobs are on the landing page; the forecaster experiment is told on How it works.
  const jobs = (aiJobs.length ? aiJobs : describeJobs({ detectiveRan, damagePlaces: 0, briefEval: null })).filter((job) => job.id !== "forecaster");

  return (
    <main id="landing" aria-labelledby="landing-h">
      <LandingSearchBar visible={barOn} input={input} onInput={onInput} onSubmit={onSubmit} lookingUp={lookingUp} />
      <LandingChunks>
      <div className="landing-inner">
        <TrackReel />
        <Chunk id="ch-start" label="Start" className="chunk-hero">
        <p className="eyebrow brand-eyebrow"><BrandMark size={22} />{APP_NAME}</p>
        <h1 id="landing-h">What the weather did to your street.</h1>
        <p className="landing-claim">Climate change, measured at your address.</p>
        <p className="landing-for">For anyone renting, buying or living somewhere the climate is changing.</p>
        <p className="landing-sub">
          Everything the National Weather Service recorded at an address since 2000, from floods and tornadoes to heat, wind, ice and
          lightning, replayed on real radar. Anything that is not real data is tagged SAMPLE.
        </p>

        <div className="sp-head">
          <h2 className="h3 landing-samples-h" id="start-here">
            Start here
          </h2>
          {previews ? (
            <button type="button" className="sp-pause" aria-pressed={previewsPaused} onClick={() => setPreviewsPaused((v) => !v)}>
              {previewsPaused ? "Play the maps" : "Pause the maps"}
            </button>
          ) : null}
        </div>
        <ul className="samples start" aria-labelledby="start-here">
          {SAMPLE_ADDRESSES.map((sample) => (
            <li key={sample.address}>
              <button
                type="button"
                className="sample-btn"
                disabled={lookingUp}
                onClick={() => chooseSample(sample, { fill: onInput, run: onSample, focusInput: () => inputRef.current?.focus() })}
              >
                <SampleBackdrop preview={previews?.previews[PREVIEW_OF_ADDRESS[sample.address]]} paused={previewsPaused} />
                <b>{sample.label}</b>
                <span className="hook">{sample.hook}</span>
                <span className="where">{sample.detail}</span>
              </button>
            </li>
          ))}
        </ul>
        <h2 className="h3 landing-samples-h" id="own-address">
          Or your own address
        </h2>
        <p className="landing-own">The first look takes a few seconds while we read the records; the AI’s writing follows.</p>
        <form
          ref={heroFormRef}
          className="landing-form"
          role="search"
          aria-label="Address"
          action="/"
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="sr" htmlFor="landing-address">
            Address or city
          </label>
          <input
            ref={inputRef}
            id="landing-address"
            name="address"
            type="text"
            value={input}
autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            spellCheck={false}
            placeholder="US address or city"
            aria-describedby={error ? "landing-error" : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onInput(event.target.value)}
          />
          <button className="btn" type="submit" disabled={lookingUp}>
            {lookingUp ? "Looking up…" : "Look up"}
          </button>
        </form>

        {error ? (
          <p id="landing-error" className="landing-error" role="alert">
            {error}
          </p>
        ) : null}
        {error && choices?.length && onChoice ? <PlaceChoices choices={choices} onChoice={onChoice} /> : null}
        </Chunk>

        <Chunk className="chunk-wide" id="ch-storms" label="Watch the storms move">

        <h2 className="h3 landing-samples-h" id="storms-h">
          Watch the storms move
        </h2>
        <p className="ev-cards-lede">Every hour of the wind across the whole storm, the hurricane on its official track, and each storm report the moment it was filed.</p>
        <EventCards />
        </Chunk>

        <Chunk className="chunk-wide" id="ch-record" label="A flash seen from space">

        <h2 className="h3 landing-samples-h" id="record-h">
          A flash seen from space
        </h2>
        <RecordFlash />
        </Chunk>

        <Chunk className="chunk-wide" id="ch-moments" label="Moments the records caught">
        <h2 className="h3 landing-samples-h" id="moments-h">Moments the records caught</h2>
        <ul className="moments moments-five" aria-labelledby="moments-h">
          {LANDING_MOMENTS.map((moment) => (
            <li key={moment.id} className="moment">
              <p className="mo-k">{moment.kicker}</p>
              <p className="mo-big" aria-hidden="true">
                {moment.big} <small>{moment.unit}</small>
              </p>
              <h3 className="mo-t">{moment.title}</h3>
              <p className="mo-l">
                <span className="sr">
                  {moment.big} {moment.unit}.{" "}
                </span>
                {moment.line}
              </p>
              {moment.fullCost || moment.attribution ? (
                <div className="mo-attr">
                  {moment.fullCost ? (
                    <p>
                      {moment.fullCost.text}.{" "}
                      <a href={moment.fullCost.url} target="_blank" rel="noopener noreferrer">
                        Source<span className="sr"> for the full cost of {moment.title} (opens in a new tab)</span>
                      </a>
                    </p>
                  ) : null}
                  {moment.attribution ? (
                    <p>
                      {moment.attribution.text}
                      {moment.attribution.credit ? ` (${moment.attribution.credit})` : ""}.{" "}
                      <a href={moment.attribution.url} target="_blank" rel="noopener noreferrer">
                        {moment.attribution.sourceLabel}
                        <span className="sr"> for {moment.title} (opens in a new tab)</span>
                      </a>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {moments?.moments[moment.id] ? <MomentTimeline timeline={moments.moments[moment.id]} /> : null}
              <button
                type="button"
                className="feat-go mo-go"
                disabled={lookingUp}
                onClick={() => chooseSample(momentLookup(moment), { fill: onInput, run: onSample, focusInput: () => inputRef.current?.focus() })}
              >
                {moment.action}
              </button>
            </li>
          ))}
        </ul>
        </Chunk>


        <Chunk className="chunk-wide" id="ch-features" label="What you’ll see">

        <h2 className="h3 landing-samples-h" id="features-h">
          What you’ll see
        </h2>
        <ul className="features" aria-labelledby="features-h">
          {LANDING_FEATURES.map((feature) => {
            const sample = featureSample(feature);
            return (
              <li key={feature.id} className="feature">
                <FeatureGlyph icon={feature.icon} />
                <h3 className="feat-t">{feature.title}</h3>
                <p className="feat-b">{feature.body}</p>
                {sample ? (
                  <button
                    type="button"
                    className="feat-go"
                    disabled={lookingUp}
                    onClick={() => chooseSample(sample, { fill: onInput, run: onSample, focusInput: () => inputRef.current?.focus() })}
                  >
                    See it: {sample.label}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        </Chunk>

        <Chunk id="ch-ai" label="What the AI does">
        <h2 className="h3 landing-samples-h">What the AI does here</h2>
        <p className="landing-ai">
          <b>{ai.lead}</b> {ai.body}{" "}
          <a
            href={viewUrl(null, "how")}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onHow();
            }}
          >
            How it works
          </a>
        </p>
        <ul className="ai-jobs">
          {jobs.map((job) => (
            <li key={job.id}>
              <b>{job.name}</b>
              <span>{job.does}</span>
              {job.result ? <span className="job-result">{job.result}</span> : null}
            </li>
          ))}
        </ul>
        </Chunk>

        <Chunk id="ch-own" label="Try your own address" className="chunk-close">

        <h2 className="chunk-close-h">What did the weather do to your street?</h2>
        <p className="landing-own">Type any US address in the bar at the top, or use a sample above.</p>
        <button type="button" className="btn chunk-close-btn" onClick={backToSearch}>
          Look up an address
        </button>
        {detectiveRan ? null : (
          <p className="fine landing-fine">
            The Nashville storm replay includes a correction demo with hand-made placements. They are labelled <span className="tag sample">Sample</span> everywhere they appear.
          </p>
        )}
        <p className="fine landing-fine">
          These are the records the National Weather Service filed and the reports we could place near you: not every storm, and not every flood.
          We make no forecast of our own: the outlooks are the National Weather Service’s, and the AI only explains them.
        </p>
        </Chunk>

      </div>
      </LandingChunks>
    </main>
  );
}
