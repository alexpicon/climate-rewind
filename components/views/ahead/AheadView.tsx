"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { useRestOnAddress } from "@/components/map/use-rest-on-address";
import type { OutlookPayload } from "@/lib/outlook-types";
import { requestBrief, requestOutlook, type AiResult } from "@/lib/ui/ahead-client";
import type { LookupPayload } from "@/lib/types";
import { isQuiet, QuietCard } from "@/components/panel/QuietCard";
import { AiAnswerView } from "./AiAnswerView";
import { AiProblem } from "./AiProblem";
import { AskBox } from "./AskBox";
import { OutlookCards } from "./OutlookCards";

type Outlook = { status: "loading" } | { status: "ready"; outlook: OutlookPayload } | { status: "error"; message: string };
type Brief = { status: "loading" } | { status: "done"; result: AiResult };

/**
 * "Your street's next 72 hours": the AI brief on top (every sentence checked against a source), the three official outlooks made
 * local below it, then a box to ask your street a question. The official outlooks load on their own, so they are on screen
 * even if the AI is resting.
 */
export function AheadView({ data }: { data: LookupPayload }) {
  useRestOnAddress(data.address.lat, data.address.lon, 10);
  const say = useAnnounce();
  const address = data.address.input;
  const { lat, lon } = data.address;

  const [outlook, setOutlook] = useState<Outlook>({ status: "loading" });
  const [brief, setBrief] = useState<Brief>({ status: "loading" });
  const run = useRef(0);

  const loadOutlook = useCallback(async () => {
    const id = run.current;
    setOutlook({ status: "loading" });
    const result = await requestOutlook(lat, lon);
    if (id !== run.current) return;
    setOutlook(result.ok ? { status: "ready", outlook: result.outlook } : { status: "error", message: result.message });
  }, [lat, lon]);

  const loadBrief = useCallback(async () => {
    const id = run.current;
    setBrief({ status: "loading" });
    const result = await requestBrief(address);
    if (id !== run.current) return;
    setBrief({ status: "done", result });
    if (result.ok) say(result.answer.state === "ok" ? `The brief is ready: ${result.answer.sentences.length} checked sentences, each with its source.` : (result.answer.message ?? "No brief."));
    else say(result.message);
  }, [address, say]);

  useEffect(() => {
    run.current += 1;
    void loadOutlook();
    void loadBrief();
    return () => {
      run.current += 1;
    };
  }, [loadOutlook, loadBrief]);

  useEffect(() => {
    say("Your street’s next 72 hours.");
  }, [say]);

  return (
    <aside id="panel" className="glass ahead" aria-label="Story" tabIndex={-1}>
      <section id="v-ahead" className="view on" aria-labelledby="ahead-h">
        <p className="eyebrow">Next 72 hours · official outlooks, made local</p>
        <h1 id="ahead-h" className="ahead-h">
          Your street’s next 72 hours
        </h1>
        <p className="ahead-addr">{data.address.matched}</p>

        <section className="ai-brief" aria-labelledby="brief-h">
          <h2 id="brief-h" className="sec-t">
            <span className="tag ai" aria-hidden="true">
              AI
            </span>
            <span aria-hidden="true">The brief</span>
            <span className="sr">The AI brief</span>
          </h2>
          <p className="ai-sub">Written by an AI from the official outlooks and our records. Only sentences that a source backs up are shown; tap a source to read it.</p>
          {brief.status === "loading" ? (
            <>
              <p className="ai-wait" role="status">
                Reading the official outlooks and our records…
              </p>
              <div className="skeleton" aria-hidden="true" />
            </>
          ) : brief.result.ok ? (
            <AiAnswerView answer={brief.result.answer} />
          ) : (
            <AiProblem result={brief.result} onRetry={() => void loadBrief()} />
          )}
        </section>

        {isQuiet(data) ? <QuietCard data={data} /> : null}

        {outlook.status === "loading" ? (
          <section className="outlooks" aria-labelledby="out-h">
            <h2 id="out-h" className="sec-t">
              Official outlooks at your address
            </h2>
            <p className="ai-wait" role="status">
              Reading the Weather Prediction Center, Storm Prediction Center and HeatRisk…
            </p>
            <div className="skeleton" aria-hidden="true" />
          </section>
        ) : outlook.status === "error" ? (
          <section className="outlooks" aria-labelledby="out-h">
            <h2 id="out-h" className="sec-t">
              Official outlooks at your address
            </h2>
            <p className="errcard" role="alert">
              <b>We couldn’t read the outlooks.</b>
              {outlook.message}
            </p>
            <button type="button" className="ai-retry" onClick={() => void loadOutlook()}>
              Try again
            </button>
          </section>
        ) : (
          <OutlookCards outlook={outlook.outlook} />
        )}

        <AskBox address={address} />

        <p className="ahead-fine">
          Outlooks come from the National Weather Service. Counts of past days are “how this has played out here”: they are not a forecast and not our prediction. For warnings, use weather.gov.
        </p>
      </section>
    </aside>
  );
}
