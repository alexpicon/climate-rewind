"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { useRestOnAddress } from "@/components/map/use-rest-on-address";
import { requestReady, type ReadyResult } from "@/lib/ready/client";
import type { LookupPayload } from "@/lib/types";
import { AiProblem } from "../ahead/AiProblem";
import { ReadyContent } from "./ReadyContent";

type State = { status: "loading" } | { status: "done"; result: ReadyResult };

/**
 * "Get ready": a short checklist built from this area's own record. Every item says why (a real record, with its date) and links the official
 * line it follows. It prints cleanly (the print button, or the browser's print), with the links written out.
 */
export function ReadyView({ data }: { data: LookupPayload }) {
  useRestOnAddress(data.address.lat, data.address.lon, 10);
  const say = useAnnounce();
  const { lat, lon, state } = data.address;
  const [result, setResult] = useState<State>({ status: "loading" });
  const run = useRef(0);

  const load = useCallback(async () => {
    run.current += 1;
    const id = run.current;
    setResult({ status: "loading" });
    const got = await requestReady(lat, lon, state);
    if (id !== run.current) return;
    setResult({ status: "done", result: got });
    if (got.ok) say(got.payload.state === "ok" ? `Your plan is ready: ${got.payload.items.length} items, each with its reason and official source.` : "No plan could be built for this address.");
    else say(got.message);
  }, [lat, lon, state, say]);

  useEffect(() => {
    void load();
    return () => {
      run.current += 1;
    };
  }, [load]);

  useEffect(() => {
    say("Get ready.");
  }, [say]);

  // A paper copy should carry the official wording, so the "what the official pages say" sections are opened for printing and put back after.
  useEffect(() => {
    const opened: HTMLDetailsElement[] = [];
    const before = () => {
      for (const el of document.querySelectorAll<HTMLDetailsElement>("#panel.rd details.rd-more:not([open])")) {
        el.open = true;
        opened.push(el);
      }
    };
    const after = () => {
      for (const el of opened.splice(0)) el.open = false;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <aside id="panel" className="glass rd" aria-label="Get ready" tabIndex={-1}>
      <section id="v-ready" className="view on rd-print" aria-labelledby="rd-h">
        <p className="eyebrow">Get ready · built from your area’s record</p>
        <h1 id="rd-h" className="ahead-h">
          Get ready
        </h1>
        <p className="ahead-addr">{data.address.matched}</p>

        {result.status === "loading" ? (
          <>
            <p className="ai-wait" role="status">
              Reading your area’s record and the official safety pages…
            </p>
            <div className="skeleton" aria-hidden="true" />
          </>
        ) : result.result.ok ? (
          <ReadyContent
            payload={result.result.payload}
            onPrint={() => window.print()}
            problem={
              result.result.payload.problem ? <AiProblem result={{ ok: false, state: result.result.payload.problem.state, message: result.result.payload.problem.message }} onRetry={() => void load()} /> : null
            }
          />
        ) : (
          <>
            <p className="errcard" role="alert">
              <b>We couldn’t build the plan.</b>
              {result.result.message}
            </p>
            <button type="button" className="ai-retry" onClick={() => void load()}>
              Try again
            </button>
          </>
        )}
        <p className="ahead-fine">
          This plan is built from past records and official safety pages. It is not a forecast and not a replacement for local emergency guidance. For warnings, use weather.gov; for preparedness, ready.gov.
        </p>
      </section>
    </aside>
  );
}
