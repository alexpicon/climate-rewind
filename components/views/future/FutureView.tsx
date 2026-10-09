"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { requestExplanation, requestFuture, type ExplainResult } from "@/lib/climate/client";
import type { FuturePayload } from "@/lib/climate/types";
import type { LookupPayload } from "@/lib/types";
import { AiAnswerView } from "../ahead/AiAnswerView";
import { AiProblem } from "../ahead/AiProblem";
import { FutureContent } from "./FutureContent";
import { FutureMap } from "./FutureMap";

type Numbers = { status: "loading" } | { status: "ready"; payload: FuturePayload } | { status: "error"; message: string };
type Explanation = { status: "idle" } | { status: "loading" } | { status: "done"; result: ExplainResult };

/**
 * "What's changing here": the record at this address beside what climate models project. The numbers load first and stand on their own;
 * the AI explanation follows (for the sample addresses it was made ahead of time). If the AI is resting, the numbers are unaffected.
 */
export function FutureView({ data }: { data: LookupPayload }) {
  const say = useAnnounce();
  const { lat, lon } = data.address;
  const [numbers, setNumbers] = useState<Numbers>({ status: "loading" });
  const [explanation, setExplanation] = useState<Explanation>({ status: "idle" });
  const run = useRef(0);

  const loadExplanation = useCallback(
    async (id: number) => {
      setExplanation({ status: "loading" });
      const result = await requestExplanation(lat, lon);
      if (id !== run.current) return;
      setExplanation({ status: "done", result });
      if (result.ok) say(result.answer.state === "ok" ? `The explanation is ready: ${result.answer.sentences.length} checked sentences, each with its source.` : (result.answer.message ?? "No explanation."));
    },
    [lat, lon, say],
  );

  const load = useCallback(async () => {
    run.current += 1;
    const id = run.current;
    setNumbers({ status: "loading" });
    setExplanation({ status: "idle" });
    const got = await requestFuture(lat, lon);
    if (id !== run.current) return;
    if (!got.ok) {
      setNumbers({ status: "error", message: got.message });
      say(got.message);
      return;
    }
    setNumbers({ status: "ready", payload: got.payload });
    say("The numbers for this address are ready.");
    if (got.payload.explanation) setExplanation({ status: "done", result: { ok: true, answer: got.payload.explanation } });
    else if (got.payload.observed || got.payload.projected) void loadExplanation(id);
  }, [lat, lon, say, loadExplanation]);

  useEffect(() => {
    void load();
    return () => {
      run.current += 1;
    };
  }, [load]);

  useEffect(() => {
    say("What’s changing here.");
  }, [say]);

  const explanationBlock = (
    <section className="fx-card fx-ai" aria-labelledby="fx-ai-h">
      <h2 id="fx-ai-h" className="sec-t">
        <span className="tag ai" aria-hidden="true">
          AI
        </span>
        <span aria-hidden="true">In plain words</span>
        <span className="sr">The AI explanation</span>
      </h2>
      <p className="ai-sub">Written by an AI from the numbers above. Only sentences whose numbers and sources check out are shown; tap a source to read it.</p>
      {explanation.status === "loading" ? (
        <>
          <p className="ai-wait" role="status">
            Writing it up from the numbers…
          </p>
          <div className="skeleton" aria-hidden="true" />
        </>
      ) : explanation.status === "done" ? (
        explanation.result.ok ? (
          <AiAnswerView answer={explanation.result.answer} />
        ) : (
          <AiProblem result={explanation.result} onRetry={() => void loadExplanation(run.current)} />
        )
      ) : null}
    </section>
  );

  return (
    <>
    <FutureMap lat={lat} lon={lon} matched={data.address.matched} />
    <aside id="panel" className="glass fx" aria-label="What’s changing here" tabIndex={-1}>
      <section id="v-future" className="view on" aria-labelledby="fx-h">
        <p className="eyebrow">What’s changing here · the record, then climate models</p>
        <h1 id="fx-h" className="ahead-h">
          What’s changing at this address
        </h1>
        <p className="ahead-addr">{data.address.matched}</p>

        {numbers.status === "loading" ? (
          <>
            <p className="ai-wait" role="status">
              Counting hot days and heavy-rain days since 2000, and reading the climate models…
            </p>
            <div className="skeleton fx-skel" aria-hidden="true" />
          </>
        ) : numbers.status === "error" ? (
          <>
            <p className="errcard" role="alert">
              <b>We couldn’t read the numbers.</b>
              {numbers.message}
            </p>
            <button type="button" className="ai-retry" onClick={() => void load()}>
              Try again
            </button>
          </>
        ) : (
          <>
            {numbers.payload.slug ? (
              <p className="fx-sample">
                <span className="tag real">Computed ahead of time</span> for this sample address, from the same sources.
              </p>
            ) : null}
            <FutureContent payload={numbers.payload} explanation={numbers.payload.observed || numbers.payload.projected ? explanationBlock : null} />
          </>
        )}
        <p className="ahead-fine">Projections are model output, not our prediction and not a forecast. For warnings, use weather.gov.</p>
      </section>
    </aside>
    </>
  );
}
