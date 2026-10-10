"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { LoadSteps } from "@/components/panel/LoadSteps";
import { PrecomputedNote } from "@/components/panel/PrecomputedNote";
import { isQuiet, QuietCard } from "@/components/panel/QuietCard";
import type { OutlookPayload } from "@/lib/outlook-types";
import { requestBrief, type AiResult } from "@/lib/ui/ahead-client";
import type { LookupPayload } from "@/lib/types";
import { AiAnswerView } from "./AiAnswerView";
import { AiProblem } from "./AiProblem";
import { AskBox } from "./AskBox";
import { OutlookCards } from "./OutlookCards";

export type Outlook = { status: "loading" } | { status: "ready"; outlook: OutlookPayload } | { status: "error"; message: string };
type Brief = { status: "loading" } | { status: "done"; result: AiResult; /** An early brief (made ahead of time) is on screen while a live one is asked for. */ refreshing?: "pending" | "failed" };

/**
 * Everything the old "Next 72 hours" page held, now under "More": the AI brief (every sentence checked against a source), the three
 * official outlooks, and a box to ask your street a question. It is only mounted once "More" is opened, so the brief (one model call)
 * is not paid for by a visitor who only reads the day cards.
 */
export function AheadMore({ data, outlook, onRetryOutlook }: { data: LookupPayload; outlook: Outlook; onRetryOutlook: () => void }) {
  const say = useAnnounce();
  const address = data.address.input;
  const [brief, setBrief] = useState<Brief>({ status: "loading" });
  const run = useRef(0);

  const loadBrief = useCallback(async () => {
    const id = run.current;
    setBrief({ status: "loading" });
    const result = await requestBrief(address);
    if (id !== run.current) return;
    // A brief made ahead of time (a sample address) shows at once with its time on it; a live one is asked for now and takes its place.
    const early = result.ok && result.answer.precomputed;
    setBrief({ status: "done", result, ...(early ? { refreshing: "pending" as const } : {}) });
    if (result.ok) say(result.answer.state === "ok" ? `The brief is ready: ${result.answer.sentences.length} checked sentences, each with its source.` : (result.answer.message ?? "No brief."));
    else say(result.message);
    if (!early) return;
    const live = await requestBrief(address, undefined, undefined, "live");
    if (id !== run.current) return;
    if (live.ok && live.answer.state === "ok") {
      setBrief({ status: "done", result: live });
      say("A fresh brief replaced the earlier one.");
    } else {
      setBrief({ status: "done", result, refreshing: "failed" });
    }
  }, [address, say]);

  useEffect(() => {
    run.current += 1;
    void loadBrief();
    return () => {
      run.current += 1;
    };
  }, [loadBrief]);

  return (
    <>
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
            <LoadSteps
              label="Writing your brief"
              steps={[
                { id: "outlooks", label: "Reading the official outlooks", state: outlook.status === "loading" ? "active" : "done" },
                { id: "brief", label: "Writing your brief", state: "active" },
              ]}
            />
            <div className="skeleton" aria-hidden="true" />
          </>
        ) : brief.result.ok ? (
          <>
            {brief.result.answer.precomputed ? <PrecomputedNote at={brief.result.answer.precomputed.at} refreshing={brief.refreshing} /> : null}
            <AiAnswerView answer={brief.result.answer} />
          </>
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
          <button type="button" className="ai-retry" onClick={onRetryOutlook}>
            Try again
          </button>
        </section>
      ) : (
        <OutlookCards outlook={outlook.outlook} />
      )}

      <AskBox address={address} />
    </>
  );
}
