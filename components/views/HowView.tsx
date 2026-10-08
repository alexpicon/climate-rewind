"use client";

import { useEffect } from "react";
import { useAnnounce } from "@/components/announce";
import { describeJobs, type AiJob } from "@/lib/ai-jobs";
import { FORECAST_SPIKE } from "@/lib/forecast-spike";
import { ForecasterChart } from "./ForecasterChart";
import { useRestOnAddress } from "@/components/map/use-rest-on-address";
import { More } from "@/components/panel/Disclosure";
import { howHeading, howIntro, PILOT_CAVEATS } from "@/lib/ui/detective-copy";

/** How it works: static text. No map animation, so the map just rests behind it. */
export function HowView({ lat, lon, detectiveRan, aiJobs = [] }: { lat: number; lon: number; detectiveRan: boolean; aiJobs?: AiJob[] }) {
  useRestOnAddress(lat, lon, 10);
  const say = useAnnounce();

  useEffect(() => {
    say("How the flood detective works.");
  }, [say]);

  return (
    <section id="how" className="glass on" aria-labelledby="how-h" tabIndex={-1}>
      <HowContent detectiveRan={detectiveRan} aiJobs={aiJobs} />
    </section>
  );
}

/** The same page before any address: no map, a way back to the search. */
export function HowStandalone({ onBack, detectiveRan, aiJobs = [] }: { onBack: () => void; detectiveRan: boolean; aiJobs?: AiJob[] }) {
  const say = useAnnounce();
  useEffect(() => {
    say("How the flood detective works.");
  }, [say]);

  return (
    <div id="landing" className="how-standalone">
      <main className="landing-inner" id="main-content" tabIndex={-1}>
        <a className="backlink" href="/" onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onBack();
        }}>
          ← Back to the search
        </a>
        <section id="how" className="glass on" aria-labelledby="how-h">
          <HowContent detectiveRan={detectiveRan} aiJobs={aiJobs} />
        </section>
      </main>
    </div>
  );
}

function HowContent({ detectiveRan, aiJobs }: { detectiveRan: boolean; aiJobs: AiJob[] }) {
  const jobs = aiJobs.length ? aiJobs : describeJobs({ detectiveRan, damagePlaces: 0, briefEval: null });
  return (
    <>
      <p className="eyebrow">How the detective works</p>
      <h1 id="how-h">{howHeading(detectiveRan)}</h1>
      <p className="sub">{howIntro(detectiveRan)}</p>
      {detectiveRan ? null : (
        <p className="note" id="how-status">
          <span className="tag sample">Status</span> No real detective result is on this site yet. The only placements you can see are the hand-made Nashville demo in the storm replay, tagged <span className="tag sample">Sample</span>.
        </p>
      )}
      <AiJobs jobs={jobs} />

      <h2 className="how-h2">How the detective decides</h2>
      <ol className="hsteps">
        <li>
          <b>Read the words</b>
          <p>The NWS report text, not a news story.</p>
        </li>
        <li>
          <b>Quote the places</b>
          <p>Every place it proposes must appear in the text. It cannot add a cross street.</p>
        </li>
        <li>
          <b>Check the map</b>
          <p>Only a Census address or intersection match is accepted.</p>
        </li>
        <li className="no">
          <b>Say “I don’t know”</b>
          <p>Vague or region-wide text stays unplaced.</p>
        </li>
      </ol>

      <div className="card" aria-labelledby="cmp-h">
        <p className="eyebrow" id="cmp-h">
          Wrong pins, more than 5 km off <span className="tag pilot">Pilot</span> <span className="tag sample">Re-test pending</span>
        </p>
        <div className="bars">
          <div className="row">
            <b>
              <span>Without AI</span>
              <span>36%</span>
            </b>
            <div className="track">
              <div className="fill a" style={{ width: "36%" }} role="img" aria-label="Without AI, 36 percent wrong pins" />
            </div>
          </div>
          <div className="row">
            <b>
              <span>Pilot detective (Sonnet agent, pilot harness)</span>
              <span>8%</span>
            </b>
            <div className="track">
              <div className="fill b" style={{ width: "8%" }} role="img" aria-label="Pilot detective, 8 percent wrong pins" />
            </div>
          </div>
        </div>
        <p className="fine">{PILOT_CAVEATS}</p>
      </div>

      <Forecaster />

      <More label="What is real, and what is sample">
        <dl className="kv">
          <dt>Radar</dt>
          <dd>NEXRAD composite, 5-minute frames (Iowa Environmental Mesonet)</dd>
          <dt>Flood reports</dt>
          <dd>NWS Local Storm Reports and NCEI Storm Events, quoted from the archive</dd>
          <dt>Heat</dt>
          <dd>Weather reanalysis (ERA5 via Open-Meteo), daily feels-like highs. A model fitted to observations, not a thermometer at your door.</dd>
          <dt>Tornadoes</dt>
          <dd>NOAA Storm Events, including the NWS damage narratives (quoted word for word)</dd>
          <dt>Live strip</dt>
          <dd>api.weather.gov alerts for this address, fetched on load and every 5 minutes. Never faked.</dd>
          <dt>FEMA zone</dt>
          <dd>NFHL point query for this address</dd>
          <dt>AI detective</dt>
          <dd>
            {detectiveRan
              ? "Where it has not run for an area yet, the page says so and moves no pin. Where it has, a placement tagged Verified is a Census address or intersection match for the words, and Area is a named area’s centre. None of these has been scored against the truth yet."
              : "No real result yet. Where it has not run for an area, the page says so and moves no pin. The few Nashville placements shown in the storm replay are hand-made demos, tagged SAMPLE."}
          </dd>
          <dt>
            <span className="tag sample">Sample</span>
          </dt>
          <dd>{detectiveRan ? "The 36% to 8% pilot numbers (a pilot, not the pre-registered result), and anything else that is not real data" : "Detective placements not yet scored, and the 36% to 8% pilot numbers (a pilot, not the pre-registered result)"}</dd>
        </dl>
      </More>
    </>
  );
}

const STATUS_LABEL: Record<AiJob["status"], string> = { measured: "Measured", pilot: "Pilot result", pending: "Pending" };

/** Every AI job with the number it has earned, or the word "pending". Nothing is claimed that is not measured. */
function AiJobs({ jobs }: { jobs: AiJob[] }) {
  return (
    <section className="aijobs" aria-labelledby="jobs-h">
      <h2 id="jobs-h" className="how-h2">
        What the AI does here, and what each job has measured
      </h2>
      <ul className="jobs">
        {jobs.map((job) => (
          <li key={job.id} data-status={job.status}>
            <div className="job-head">
              <b>{job.name}</b>
              <span className={`tag ${job.status === "measured" ? "real" : job.status === "pilot" ? "pilot" : "sample"}`}>{STATUS_LABEL[job.status]}</span>
            </div>
            <p className="job-does">{job.does}</p>
            <p className="job-num">{job.number ?? "Pending"}</p>
            {job.result ? <p className="job-result">{job.result}</p> : null}
            <p className="job-detail">{job.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The flood forecaster we trained: Quinn's real numbers, told as what they show. */
function Forecaster() {
  const f = FORECAST_SPIKE;
  const hind = f.bars[0];
  const adv = f.bars[1];
  return (
    <section className="forecaster" aria-labelledby="fc-h">
      <h2 id="fc-h" className="how-h2">
        We trained a flood forecaster. Here is what it taught us.
      </h2>
      <p className="sub">
        We trained a small model on {f.trained} and tested it on {f.tested}: did a flood get reported within {f.radiusKm} km of {f.points} city points in {f.states} states. Told the rain after the fact, it beat the official outlook’s score by {hind.bss.toFixed(1)}%. But tomorrow’s rain is not known today. Using only what is known in advance, it scored {adv.bss.toFixed(1)}%: exactly as good as the official outlook, and no better.
      </p>
      <ForecasterChart />
      <p className="fc-so">
        <b>So Climate Rewind explains the official forecasts instead of competing with them.</b> That is also what the published research found: Colorado State University’s machine-learning system was less skillful than the human outlook on Day 1.
      </p>
      <More label="The details and the limits">
        <dl className="kv">
          <dt>Trained, tested</dt>
          <dd>
            Trained on {f.trained} ({f.trainPointDays.toLocaleString("en-US")} point-days, {f.trainPositives} with a flood report), tested on {f.tested} ({f.testPointDays.toLocaleString("en-US")} point-days, {f.testPositives} with a flood report on {f.testDates} separate dates).
          </dd>
          <dt>What “skill” means</dt>
          <dd>Brier skill compares how close the model’s probabilities were to what happened with the official outlook’s. 0% is no better, higher is better. The 95% range comes from resampling whole dates, because one storm makes many reports.</dd>
          <dt>The official outlook itself</dt>
          <dd>
            On the same test the official outlook beat the usual local rate for the time of year by {f.officialVsUsual.bss.toFixed(1)}% (range {f.officialVsUsual.lo.toFixed(1)}% to {f.officialVsUsual.hi.toFixed(1)}%). That skill is the Weather Service’s.
          </dd>
          <dt>If the rain is wrong</dt>
          <dd>
            In a simulation (not real forecast rain), the hindsight advantage shrank from {f.noisyRain[0].bss.toFixed(1)}% to {f.noisyRain[1].bss.toFixed(1)}% when the rain input was moderately wrong, and to about nothing when it was badly wrong.
          </dd>
          <dt>Limits</dt>
          <dd>The labels are flood reports, which follow where people are and report, not flooding itself. The points are cities in seven states. The test has {f.testPositives} reporting days. Absolute probabilities drift and would need re-fitting every year. We did not ship it.</dd>
          <dt>Published research</dt>
          <dd>{f.citation}</dd>
        </dl>
      </More>
    </section>
  );
}
