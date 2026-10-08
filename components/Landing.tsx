"use client";

import { useRef } from "react";
import type { AiJob } from "@/lib/ai-jobs";
import { describeJobs } from "@/lib/ai-jobs";
import { APP_NAME } from "@/lib/brand";
import { landingLead } from "@/lib/ui/detective-copy";
import { SAMPLE_ADDRESSES, viewUrl } from "@/lib/ui/tabs";

interface Props {
  input: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  lookingUp: boolean;
  error: string | null;
  onHow: () => void;
  /** Real detective results exist in the data. */
  detectiveRan: boolean;
  /** The AI jobs, listed under the search. */
  aiJobs?: AiJob[];
}

/** First screen: one search box and three sample addresses. Samples only fill the box. */
export function Landing({ input, onInput, onSubmit, lookingUp, error, onHow, detectiveRan, aiJobs = [] }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const ai = landingLead(detectiveRan);
  // Three of the AI jobs are on the landing page; the forecaster experiment is told on How it works.
  const jobs = (aiJobs.length ? aiJobs : describeJobs({ detectiveRan, damagePlaces: 0, briefEval: null })).filter((job) => job.id !== "forecaster");

  return (
    <main id="landing" aria-labelledby="landing-h">
      <div className="landing-inner">
        <p className="eyebrow">{APP_NAME}</p>
        <h1 id="landing-h">What the weather did to your street.</h1>
        <p className="landing-sub">
          Type a US street address. We replay the storm night, the heat wave and the tornadoes that the National Weather Service
          recorded near it, and make its official outlook for the next 72 hours local. Anything that is not real data is tagged SAMPLE.
        </p>

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

        <form
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
            Street address
          </label>
          <input
            ref={inputRef}
            id="landing-address"
            name="address"
            type="text"
            value={input}
            autoComplete="street-address"
            spellCheck={false}
            placeholder="100 James Robertson Pkwy, Nashville, TN"
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

        <h2 className="h3 landing-samples-h">Or try a sample</h2>
        <ul className="samples">
          {SAMPLE_ADDRESSES.map((sample) => (
            <li key={sample.address}>
              <button
                type="button"
                className="sample-btn"
                onClick={() => {
                  onInput(sample.address);
                  inputRef.current?.focus();
                }}
              >
                <b>{sample.label}</b>
                <span>{sample.detail}</span>
              </button>
            </li>
          ))}
        </ul>
        <h2 className="h3 landing-samples-h">What the AI does here</h2>
        <ul className="ai-jobs">
          {jobs.map((job) => (
            <li key={job.id}>
              <b>{job.name}</b>
              <span>{job.does}</span>
              {job.result ? <span className="job-result">{job.result}</span> : null}
            </li>
          ))}
        </ul>
        {detectiveRan ? null : (
          <p className="fine landing-fine">
            The Nashville storm replay includes a correction demo with hand-made placements. They are labelled <span className="tag sample">Sample</span> everywhere they appear.
          </p>
        )}
        <p className="fine landing-fine">Shows NWS reports we could place near you, not every flood. We make no forecast of our own: the outlooks are the National Weather Service’s, and the AI only explains them.</p>
      </div>
    </main>
  );
}
