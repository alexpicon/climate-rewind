"use client";

import { useEffect } from "react";
import { useAnnounce } from "@/components/announce";
import { describeJobs, type AiJob } from "@/lib/ai-jobs";
import { FORECAST_SPIKE } from "@/lib/forecast-spike";
import { ForecasterChart } from "./ForecasterChart";
import { useRestOnAddress } from "@/components/map/use-rest-on-address";
import { More } from "@/components/panel/Disclosure";
import { DETECTIVE_EVAL as EVAL, EVAL_FINE, EVAL_HEADLINE, EVAL_TRADEOFF, PILOT_FOOTNOTE } from "@/lib/detective-eval";
import { howHeading, howIntro } from "@/lib/ui/detective-copy";

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
          Pre-registered test, {EVAL.n} fresh reports <span className="tag real">Measured</span>
        </p>
        <p className="bars-claim">{EVAL_HEADLINE}</p>
        <p className="bars-claim">{EVAL_TRADEOFF}</p>
        <BarGroup
          title="Wrong pins, more than 5 km off (lower is better)"
          noun="wrong pins"
          rows={[
            { label: "Without AI", value: EVAL.wrong.baseline, kind: "a" },
            { label: "AI detective", value: EVAL.wrong.detective, kind: "b" },
          ]}
        />
        <BarGroup
          title="Placed within 1 km of the true spot (higher is better)"
          noun="placed within 1 km"
          rows={[
            { label: "Without AI", value: EVAL.within1km.baseline, kind: "a" },
            { label: "AI detective", value: EVAL.within1km.detective, kind: "b" },
          ]}
        />
        <p className="fine">{EVAL_FINE}</p>
        <p className="fine">
          {PILOT_FOOTNOTE} (an earlier pilot, not pre-registered). Test files: <code>pipeline/eval/score.json</code>, <code>pipeline/eval/PREREG.md</code>.
        </p>
      </div>

      <Forecaster />

      <More label="What is real, and what is sample">
        <dl className="kv">
          <dt>Radar</dt>
          <dd>NEXRAD composite, 5-minute frames (Iowa Environmental Mesonet)</dd>
          <dt>Map</dt>
          <dd>Esri World Dark Gray tiles (© Esri, HERE, Garmin, © OpenStreetMap contributors). The optional 3D view adds OpenFreeMap (© OpenMapTiles, data from OpenStreetMap) and Mapzen terrain tiles (AWS Terrain Tiles).</dd>
          <dt>Flood reports</dt>
          <dd>NWS Local Storm Reports and NCEI Storm Events, quoted from the archive</dd>
          <dt>Heat</dt>
          <dd>Weather reanalysis (ERA5 via Open-Meteo), daily feels-like and air-temperature highs. A model fitted to observations, not a thermometer at your door. If Open-Meteo is rate limited, the page uses NASA POWER (MERRA-2) instead, computes a heat index from it, and says so where the number appears.</dd>
          <dt>Climate models</dt>
          <dd>CMIP6 HighResMIP models via the Open-Meteo Climate API: physics simulations, not a forecast. They can run hotter than the record at a spot, so What’s changing and the Story strip show the models’ own change, not their raw level.</dd>
          <dt>Tornadoes</dt>
          <dd>NOAA Storm Events, including the NWS damage narratives (quoted word for word)</dd>
          <dt>Live strip</dt>
          <dd>api.weather.gov alerts for this address, fetched on load and every 5 minutes. Never faked.</dd>
          <dt>FEMA zone</dt>
          <dd>NFHL point query for this address</dd>
          <dt>AI detective</dt>
          <dd>
            {detectiveRan
              ? "Where it has not run for an area yet, the page says so and moves no pin. Where it has, a placement tagged Verified is a Census address or intersection match for the words, and Area is a named area’s centre. The live re-filings on this site are not scored one by one; the 100-report pre-registered test is (28% → 2%)."
              : "No real result yet. Where it has not run for an area, the page says so and moves no pin. The few Nashville placements shown in the storm replay are hand-made demos, tagged SAMPLE."}
          </dd>
          <dt>
            <span className="tag sample">Sample</span>
          </dt>
          <dd>{detectiveRan ? "The earlier pilot numbers (not the pre-registered result), and anything else that is not real data" : "Detective placements not yet scored, and the earlier pilot numbers (not the pre-registered result)"}</dd>
        </dl>
      </More>
    </>
  );
}

/** One bar chart: a title and a row per line. Each bar has a text label and the percentage, so nothing depends on colour or on the bar itself. */
function BarGroup({ title, noun, rows }: { title: string; noun: string; rows: Array<{ label: string; value: number; kind: "a" | "b" }> }) {
  return (
    <div className="bars-group">
      <p className="bars-sub">{title}</p>
      <div className="bars">
        {rows.map((row) => (
          <div className="row" key={row.label}>
            <b>
              <span>{row.label}</span>
              <span>{row.value}%</span>
            </b>
            <div className="track">
              <div className={`fill ${row.kind}`} style={{ width: `${row.value}%` }} role="img" aria-label={`${row.label}, ${row.value} percent ${noun}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
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

/** The flood forecaster we trained: the measured numbers (docs/forecast-experiment.md), told as what they show. */
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
          <dt>Full write-up</dt>
          <dd>
            <code>docs/forecast-experiment.md</code> in the project repository: how it was set up, every table, and the caveats.
          </dd>
        </dl>
      </More>
    </section>
  );
}
