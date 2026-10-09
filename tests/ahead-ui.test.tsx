/**
 * The words and structure of the new pieces, rendered on the server so they are tested without a browser:
 * the official outlooks with their local record, a verified answer with cite chips, the honest "AI is resting" state,
 * the forecaster chart, the AI jobs on the landing and How it works, and the one-line product name.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiAnswerView } from "@/components/views/ahead/AiAnswerView";
import { AiProblem } from "@/components/views/ahead/AiProblem";
import { OutlookCards } from "@/components/views/ahead/OutlookCards";
import { ForecasterChart } from "@/components/views/ForecasterChart";
import { HowStandalone } from "@/components/views/HowView";
import { Landing } from "@/components/Landing";
import { DAMAGE_EVAL, describeJobs, type BriefEval } from "@/lib/ai-jobs";
import { APP_NAME, APP_SLUG, APP_TITLE, APP_USER_AGENT, pageTitle } from "@/lib/brand";
import { FORECAST_SPIKE } from "@/lib/forecast-spike";
import { dayLabel, floodRecordLine, heatIsNotable, monthYear, percentText, tornadoRecordLine, tornadoKeyForPercent, worstLevel, worstTornadoPercent } from "@/lib/ui/ahead-text";
import { DEFAULT_TAB, parseTab, TABS, VISIBLE_TABS, viewUrl } from "@/lib/ui/tabs";
import type { AiAnswer } from "@/lib/ai/types";
import { lookupFixture, outlookFixture } from "./ai-fixtures";
import { buildSources } from "@/lib/ai/sources";

const noop = () => undefined;

describe("ahead-text", () => {
  const outlook = outlookFixture();

  it("labels days, and writes shares the way the AI sources do", () => {
    expect(dayLabel(1, "2026-10-08")).toBe("Today");
    expect(dayLabel(2, "2026-10-09")).toBe("Tomorrow");
    expect(dayLabel(3, "2026-10-10")).toBe("Sat Oct 10");
    expect(percentText(10, 118)).toBe("8.5%");
    expect(percentText(7, 13)).toBe("54%");
    expect(percentText(1, 2863)).toBe("0%");
    expect(percentText(0, 0)).toBe("n/a");
    expect(monthYear("2016-10-01")).toBe("October 2016");
  });

  it("reads the worst day, then how that kind of day has played out here, in the third person (never 'our prediction')", () => {
    expect(worstLevel(outlook.flood.days!)).toBe("SLGT");
    const line = floodRecordLine("SLGT", outlook.flood.record!);
    expect(line.sentence).toBe("Since October 2016, 118 days were rated Slight here by the Weather Prediction Center. A flood was reported within 10 km on 10 of them (8.5%).");
    expect(line.few).toBe(false);
    expect(floodRecordLine("MDT", { ...outlook.flood.record!, byCategory: { ...outlook.flood.record!.byCategory, MDT: { days: 5, hitDays: 4 } } }).few).toBe(true);
    expect(floodRecordLine("HIGH", outlook.flood.record!).sentence).toBe("Since October 2016, no day was rated High here.");
    expect(floodRecordLine("none", outlook.flood.record!).sentence).toContain("2,863 days had no risk area here");
    for (const text of [line.sentence, floodRecordLine("none", outlook.flood.record!).sentence]) expect(text).not.toMatch(/our (prediction|forecast)|chance|will /i);
  });

  it("reads the tornado record by the Day 1 and 2 probability, never the Day 3 combined one", () => {
    const days = outlook.tornado.days!;
    expect(worstTornadoPercent(days)).toBe(0);
    expect(tornadoKeyForPercent(0)).toBe("none");
    expect(tornadoKeyForPercent(5)).toBe("5");
    expect(tornadoKeyForPercent(30)).toBe("10+");
    expect(tornadoRecordLine(5, outlook.tornado.record!).sentence).toBe("Since October 2016, the Storm Prediction Center gave this point 5% on 37 days. A tornado track passed within 25 miles on 3 of them (8.1%).");
    expect(tornadoRecordLine(0, outlook.tornado.record!).sentence).toContain("showed no tornado risk area here on 3,067 days");
  });

  it("calls a heat day notable only in the hottest quarter of days for the time of year", () => {
    expect(heatIsNotable({ date: "2026-10-08", feelsF: 95, rank: { allAtLeast: 10, allTotal: 100, seasonAtLeast: 20, seasonTotal: 100, since: 2000 } })).toBe(true);
    expect(heatIsNotable({ date: "2026-10-08", feelsF: 70, rank: { allAtLeast: 50, allTotal: 100, seasonAtLeast: 60, seasonTotal: 100, since: 2000 } })).toBe(false);
    expect(heatIsNotable({ date: "2026-10-08", feelsF: 70, rank: null })).toBe(false);
  });
});

describe("OutlookCards", () => {
  const html = renderToStaticMarkup(<OutlookCards outlook={outlookFixture()} />);

  it("shows three days for each hazard, with the level written out (color is not the only cue)", () => {
    expect(html).toContain("Official outlooks at your address");
    expect(html).toContain("Weather Prediction Center");
    expect(html).toContain("Storm Prediction Center");
    expect(html).toContain("NWS HeatRisk (experimental)");
    expect(html).toContain(">Today<");
    expect(html).toContain(">Tomorrow<");
    expect(html).toContain(">Sat Oct 10<");
    expect(html).toContain(">Slight<");
    expect(html).toContain(">No risk area<");
    expect(html).toContain(">1 of 4<");
    expect(html).toContain("5% any severe");
  });

  it("puts how it played out here under the official outlook, labelled as a count of past days", () => {
    expect(html).toContain("How this has played out here");
    expect(html).toContain("A flood was reported within 10 km on 10 of them (8.5%).");
    expect(html).toContain("they are not forecasts and not the chance of anything tomorrow");
    expect(html).not.toMatch(/our (prediction|forecast)/i);
  });

  it("ranks the forecast feels-like against this address's own history, with the counts", () => {
    expect(html).toContain("a feels-like high of 86 F");
    expect(html).toContain("2,100 of 9,497 days since 2000 (22%) were this hot or hotter.");
  });

  it("has real tables behind the disclosure, with captions and column headers", () => {
    expect(html).toContain("The numbers behind this");
    expect(html).toMatch(/<caption>Flood reports within 10 km/);
    expect(html).toMatch(/<th scope="col">With a flood report<\/th>/);
    expect(html).toMatch(/<caption>Tornado tracks within 25 miles/);
    expect(html).toContain("Feb 10, 2022");
    expect(html).toContain("which is not the event the outlook forecasts");
  });

  it("says plainly when there is no local record, and still shows the official outlooks", () => {
    const none = renderToStaticMarkup(<OutlookCards outlook={outlookFixture({ recordSlug: null, flood: { days: outlookFixture().flood.days, record: null }, tornado: { days: outlookFixture().tornado.days, record: null }, recordNotice: "The local track record is built for the four sample addresses so far. This address shows the official outlooks only." })} />);
    expect(none).toContain("four sample addresses");
    expect(none).toContain(">Slight<");
    expect(none).not.toContain("How this has played out here");
  });

  it("names the failed source and shows nothing made up", () => {
    const failed = renderToStaticMarkup(<OutlookCards outlook={outlookFixture({ flood: { days: null, record: null, notice: "The Iowa Environmental Mesonet outlook service returned an error (HTTP 503)." } })} />);
    expect(failed).toContain("returned an error (HTTP 503)");
    expect(failed).not.toContain(">Slight<");
  });

  it("says a sample's heat ranking is pending when its history is not saved yet", () => {
    const o = outlookFixture();
    const pending = renderToStaticMarkup(<OutlookCards outlook={{ ...o, heat: { ...o.heat, hasHistory: false, forecast: [{ date: "2026-10-09", feelsF: 88, rank: null }], notices: { history: "This address's feels-like history is not saved yet, so there is no ranking." } } }} />);
    expect(pending).toContain("not saved yet");
    expect(pending).not.toContain("were this hot or hotter");
  });
});

describe("AiAnswerView", () => {
  const sources = Object.fromEntries(buildSources({ lookup: lookupFixture(), outlook: outlookFixture(), damage: [] }).map((s) => [s.id, s]));
  const answer: AiAnswer = {
    state: "ok",
    sentences: [
      { text: "The Weather Prediction Center rates Day 3 (Sat Oct 10) as Slight risk at this address.", cites: ["flood-outlook"] },
      { text: "On 10 of 118 past days rated Slight, a flood was reported within 10 km.", cites: ["flood-record", "report-1"] },
    ],
    sources: { "flood-outlook": sources["flood-outlook"], "flood-record": sources["flood-record"], "report-1": sources["report-1"] },
    dropped: 2,
    message: null,
    generatedAt: "2026-10-08T19:00:00.000Z",
    model: "claude-sonnet-5-5",
    cached: false,
  };

  it("shows each verified sentence with a button chip per source, closed to start", () => {
    const html = renderToStaticMarkup(<AiAnswerView answer={answer} />);
    expect(html).toContain("The Weather Prediction Center rates Day 3");
    expect((html.match(/class="cite"/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="WPC outlook, source: WPC Excessive Rainfall Outlook at this address"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">WPC outlook<");
    expect(html).toContain(">Local record<");
    expect(html).toContain(">Report 1<");
    expect(html).not.toContain("srccard");
  });

  it("tells the visitor how many sentences the checks removed", () => {
    const html = renderToStaticMarkup(<AiAnswerView answer={answer} />);
    expect(html).toContain("2 sentences the AI wrote were removed because they could not be matched to a source or a number in one.");
  });

  it("shows only our own message for a refusal or an answer with nothing verified", () => {
    const withLead = renderToStaticMarkup(<AiAnswerView answer={{ ...answer, lead: "We don't forecast; here is the official outlook and how it has played out here." }} />);
    expect(withLead).toContain('<p class="ai-lead">We don&#x27;t forecast; here is the official outlook and how it has played out here.</p>');
    expect(withLead.indexOf("ai-lead")).toBeLessThan(withLead.indexOf("ai-sents"));
    const refusal = renderToStaticMarkup(<AiAnswerView answer={{ ...answer, state: "off_topic", sentences: [], sources: {}, dropped: 0, message: "I can only answer questions about weather hazards at this address: floods, tornadoes, heat, alerts and the official outlooks." }} />);
    expect(refusal).toContain("I can only answer questions about weather hazards");
    expect(refusal).not.toContain("cite");
    const none = renderToStaticMarkup(<AiAnswerView answer={{ ...answer, state: "no_answer", sentences: [], sources: {}, dropped: 3, message: "I could not back an answer with our records, so I am not showing one." }} />);
    expect(none).toContain("3 sentences the AI wrote could not be matched to a source, so none is shown.");
  });
});

describe("AiProblem: the honest states", () => {
  it("resting: names the daily allowance, says the outlooks are unaffected, and offers no retry", () => {
    const html = renderToStaticMarkup(<AiProblem onRetry={noop} result={{ ok: false, state: "resting", message: "Today's allowance for AI answers is used up. It starts again at midnight UTC. The official outlooks on this page are unaffected." }} />);
    expect(html).toContain("The AI is resting");
    expect(html).toContain("official outlooks on this page are unaffected");
    expect(html).not.toContain("Try again");
    expect(html).toContain('role="status"');
  });

  it("an error or a rate limit offers a retry", () => {
    expect(renderToStaticMarkup(<AiProblem onRetry={noop} result={{ ok: false, state: "error", message: "The AI did not answer." }} />)).toContain("Try again");
    expect(renderToStaticMarkup(<AiProblem onRetry={noop} result={{ ok: false, state: "rate_limited", message: "Too many requests. Please wait 12 seconds.", retryAfter: 12 }} />)).toContain("Try again");
  });
});

describe("the forecaster chart and section", () => {
  it("draws Quinn's two numbers, with a text version and a description for screen readers", () => {
    const html = renderToStaticMarkup(<ForecasterChart />);
    expect(html).toContain('role="img"');
    expect(html).toContain("plus 3.5 percent, 95 percent range plus 1.7 percent to plus 5.3 percent");
    expect(html).toContain("0.0 percent, 95 percent range minus 1.4 percent to plus 1.3 percent");
    expect(html).toContain("+3.5%");
    expect(html).toContain("0.0%");
    expect(html).toContain("Text version of this chart");
    expect(html).toContain('<th scope="col">95% range</th>');
  });

  it("keeps the shipped numbers equal to docs/forecast-experiment.md, the write-up How it works points to", async () => {
    const doc = await readFile(path.join(process.cwd(), "docs", "forecast-experiment.md"), "utf8");
    for (const text of ["Brier skill +3.5% vs ERO-only (95% CI +1.7% to +5.3%", "AUC 0.954 vs 0.881", "**0.0%** (CI -1.4% to +1.3%)", "+6.0% Brier skill (CI 4.5% to 7.6%)", "350 positives", "199,368", "56,238", "206 distinct dates", "313,404"]) expect(doc, text).toContain(text);
    expect(doc).not.toMatch(/Quinn|Koda|\/tmp\//);
    expect(renderToStaticMarkup(<HowStandalone onBack={noop} detectiveRan={false} />)).toContain("docs/forecast-experiment.md");
  });

  it("keeps the shipped numbers equal to the spike's RESULT.md", () => {
    expect(FORECAST_SPIKE.bars.map((b) => [b.bss, b.lo, b.hi])).toEqual([
      [3.5, 1.7, 5.3],
      [0.0, -1.4, 1.3],
    ]);
    expect(FORECAST_SPIKE.officialVsUsual).toMatchObject({ bss: 6.0, lo: 4.5, hi: 7.6 });
    expect(FORECAST_SPIKE.testPositives).toBe(350);
    expect(FORECAST_SPIKE.trained).toBe("2016 to 2022");
    expect(FORECAST_SPIKE.tested).toBe("2024 to 2025");
  });

  it("How it works tells it as a strength: beat the outlook with hindsight, tied it without, so we explain", () => {
    const html = renderToStaticMarkup(<HowStandalone onBack={noop} detectiveRan={false} />);
    expect(html).toContain("We trained a flood forecaster. Here is what it taught us.");
    expect(html).toContain("it beat the official outlook’s score by 3.5%");
    expect(html).toContain("it scored 0.0%: exactly as good as the official outlook, and no better");
    expect(html).toContain("So Climate Rewind explains the official forecasts instead of competing with them.");
    expect(html).toContain("Colorado State University’s machine-learning system was less skillful than the human outlook on Day 1");
    expect(html).not.toMatch(/our forecast|more accurate than/i);
  });
});

describe("the AI jobs, with their numbers or 'pending'", () => {
  const evaluation: BriefEval = { ranAt: "2026-10-08T20:00:00.000Z", model: "claude-sonnet-5-5", questions: 20, addresses: 4, sentencesWritten: 80, sentencesVerified: 72, passPercent: 90, dropped: { unsupported_number: 5, no_citation: 3 } };

  it("lists every job once, and marks what is not measured as pending", () => {
    const jobs = describeJobs({ detectiveRan: false, damagePlaces: 0, briefEval: null });
    expect(jobs.map((j) => [j.id, j.status])).toEqual([
      ["detective", "measured"],
      ["damage", "pending"],
      ["briefing", "pending"],
      ["forecaster", "measured"],
    ]);
    expect(jobs[1].number).toBeNull();
    expect(jobs[2].number).toBeNull();
    expect(jobs[0].number).toBe("In a pre-registered test on 100 fresh reports, the AI detective cut wrong pins from 28% to 2%. It places fewer reports (16% vs 33% within 1 km), because it refuses to guess when a report names only a road.");
    expect(jobs[0].detail).toContain("Pilot: 36% → 8%.");
    expect(jobs[0].detail).not.toMatch(/pending|re-test/);
    expect(jobs[3].number).toContain("0.0% better than the official outlook");
  });

  it("shows the briefing's measured pass share once the 20-question test has run", () => {
    const jobs = describeJobs({ detectiveRan: true, damagePlaces: 7, briefEval: evaluation });
    expect(jobs[2]).toMatchObject({ status: "measured" });
    expect(jobs[2].number).toBe("90% of the sentences it wrote passed the checks (72 of 80, across 20 questions on 4 addresses).");
    expect(jobs[1]).toMatchObject({ status: "pilot" });
    expect(jobs[1].number).toBe("On 5 hand-labelled NWS surveys: extraction precision 0.98, recall 0.86; 45 of 72 damage places pinned.");
    expect(jobs[1].detail).toContain("7 damage places are on the map now");
    expect(jobs[1].detail).toContain("not a pre-registered one");
    expect(jobs[0].detail).toContain("Real placements are in the data now.");
    expect(jobs[2].detail).toContain("The rest were removed before anyone saw them.");
    const perfect = describeJobs({ detectiveRan: true, damagePlaces: 0, briefEval: { ...evaluation, sentencesVerified: 80, passPercent: 100 } });
    expect(perfect[2].detail).toContain("Nothing had to be removed in this run");
  });

  it("with the detective's real counts, the landing and How it works say what it did, and drop the 'not run yet' wording", () => {
    const jobs = describeJobs({ detectiveRan: true, damagePlaces: 68, briefEval: null, detectiveCounts: { ran: 364, placed: 110, states: 4 } });
    expect(jobs[0].result).toContain("re-filed 110 of 364 imprecise flood reports in the 4 sample areas and said “I don’t know” on the other 254");
    const how = renderToStaticMarkup(<HowStandalone onBack={noop} detectiveRan aiJobs={jobs} />);
    expect(how).toContain("An AI flood detective that refuses to guess.");
    expect(how).toContain("re-filed 110 of 364 imprecise flood reports in the 4 sample areas");
    expect(how).toContain("extraction precision 0.98, recall 0.86; 45 of 72 damage places pinned");
    expect(how).not.toContain("It has not run on this data yet");
    expect(how).not.toContain("No real detective result is on this site yet");
    const landing = renderToStaticMarkup(<Landing input="" onInput={noop} onSubmit={noop} lookingUp={false} error={null} onHow={noop} detectiveRan aiJobs={jobs} />);
    expect(landing).toContain("re-filed 110 of 364");
    expect(landing).toContain("An AI flood detective.");
    expect(landing).not.toContain("hand-made placements");
    // Without counts (a test dir, or the run not merged), the wording stays careful.
    expect(describeJobs({ detectiveRan: false, damagePlaces: 0, briefEval: null })[0].result).toBeNull();
  });

  it("the damage mapper's test numbers equal Koda's run log", async () => {
    const log = await readFile(path.join(process.cwd(), "pipeline", "RUN-2026-10-08.md"), "utf8");
    expect(log).toContain(`| **Total** | **${DAMAGE_EVAL.precision.toFixed(2)} / ${DAMAGE_EVAL.recall.toFixed(2)}** | **${DAMAGE_EVAL.pinned}/${DAMAGE_EVAL.labelled} (0.62)**`);
    expect(log).toContain("10/10 are on the named place and on the track");
  });

  it("the landing lists the detective, the damage mapper and the briefing", () => {
    const html = renderToStaticMarkup(<Landing input="" onInput={noop} onSubmit={noop} lookingUp={false} error={null} onHow={noop} detectiveRan={false} />);
    expect(html).toContain("What the AI does here");
    expect(html).toContain("The flood detective");
    expect(html).toContain("The damage mapper");
    expect(html).toContain("The briefing and “Ask your street”");
    expect(html).not.toContain("flood forecaster we trained");
    expect(html).toContain("We make no forecast of our own");
  });

  it("How it works shows each job with its number or the word Pending", () => {
    const html = renderToStaticMarkup(<HowStandalone onBack={noop} detectiveRan={false} aiJobs={describeJobs({ detectiveRan: false, damagePlaces: 0, briefEval: null })} />);
    expect(html).toContain("What the AI does here, and what each job has measured");
    expect((html.match(/class="job-num">Pending</g) ?? []).length).toBe(2);
    expect(html).toContain("cut wrong pins from 28% to 2%. It places fewer reports (16% vs 33% within 1 km)");
    const measured = renderToStaticMarkup(<HowStandalone onBack={noop} detectiveRan={false} aiJobs={describeJobs({ detectiveRan: false, damagePlaces: 0, briefEval: evaluation })} />);
    expect(measured).toContain("90% of the sentences it wrote passed the checks");
    expect((measured.match(/class="job-num">Pending</g) ?? []).length).toBe(1);
  });
});

describe("the product name lives in one constant", () => {
  it("builds the title, the slug and the user agent from APP_NAME", () => {
    expect(APP_NAME).toBe("Climate Rewind");
    expect(APP_SLUG).toBe("climate-rewind");
    expect(APP_TITLE).toBe("Climate Rewind: what the weather did to your street");
    expect(APP_USER_AGENT).toBe("climate-rewind/0.1 (ForgeHacks 2026 project)");
    expect(pageTitle("Next 72 hours", "1 Main St")).toBe("Next 72 hours | 1 Main St | Climate Rewind");
  });

  it("is what the landing prints", () => {
    const html = renderToStaticMarkup(<Landing input="" onInput={noop} onSubmit={noop} lookingUp={false} error={null} onHow={noop} detectiveRan={false} />);
    expect(html).toContain(`<p class="eyebrow">${APP_NAME}</p>`);
  });
});

describe("tabs", () => {
  it("opens on the AI briefing by default, with the storm replay one click away", () => {
    expect(DEFAULT_TAB).toBe("ahead");
    expect(parseTab(undefined)).toBe("ahead");
    expect(parseTab("nonsense")).toBe("ahead");
    expect(parseTab("storm")).toBe("storm");
    expect(TABS).toEqual(["ahead", "story", "storm", "heat", "tornado", "future", "ready", "how"]);
    // The history views sit right after the 72 hours (they are one top tab now); "future" and "ready" show only when their view files exist.
    expect(VISIBLE_TABS.slice(0, 2)).toEqual(["ahead", "story"]);
    expect(parseTab("history")).toBe("story");
    expect(parseTab("story")).toBe("story");
    expect(viewUrl("1 Main St", "ahead")).toBe("/?address=1+Main+St&tab=ahead");
    expect(viewUrl(null, "ahead")).toBe("/");
    expect(viewUrl(null, "how")).toBe("/?tab=how");
  });
});
