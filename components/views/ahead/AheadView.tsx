"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import { LoadSteps } from "@/components/panel/LoadSteps";
import { requestOutlook, requestWeek } from "@/lib/ui/ahead-client";
import type { LookupPayload } from "@/lib/types";
import type { WeekPayload } from "@/lib/week/types";
import { AheadMap } from "./AheadMap";
import { AheadMore, type Outlook } from "./AheadMore";
import { WeekCards, type ActionsStatus } from "./WeekCards";

type Week = { status: "loading" } | { status: "ready"; week: WeekPayload; actions: ActionsStatus } | { status: "error"; message: string };

/**
 * "Next 7 days": one card per day for today and the six after it. Quiet days are a single line; notable days say what to expect (the
 * official forecast in plain words), what that kind of day meant here before, and what to do (chosen by the AI from official guidance,
 * every action citing a guidance line). The cards come first and fast; the advice fills in a few seconds later. The AI brief, the
 * official outlooks and "Ask your street" sit below, collapsed under "More".
 */
export function AheadView({ data }: { data: LookupPayload }) {
  const say = useAnnounce();
  const { lat, lon, state } = data.address;

  const [week, setWeek] = useState<Week>({ status: "loading" });
  const [outlook, setOutlook] = useState<Outlook>({ status: "loading" });
  const [moreOpen, setMoreOpen] = useState(false);
  const run = useRef(0);

  const loadOutlook = useCallback(async () => {
    const id = run.current;
    setOutlook({ status: "loading" });
    const result = await requestOutlook(lat, lon);
    if (id !== run.current) return;
    setOutlook(result.ok ? { status: "ready", outlook: result.outlook } : { status: "error", message: result.message });
  }, [lat, lon]);

  /** The cards first (no AI), then the advice for the notable days. */
  const loadWeek = useCallback(async () => {
    const id = run.current;
    setWeek({ status: "loading" });
    const cards = await requestWeek(lat, lon, state, false);
    if (id !== run.current) return;
    if (!cards.ok) {
      setWeek({ status: "error", message: cards.message });
      say(cards.message);
      return;
    }
    const notable = cards.week.days.filter((d) => d.notable).length;
    if (cards.week.state !== "ok" || notable === 0) {
      setWeek({ status: "ready", week: cards.week, actions: "done" });
      say(cards.week.state !== "ok" ? "The forecast could not be read." : "Nothing unusual is expected in the next 7 days.");
      return;
    }
    setWeek({ status: "ready", week: cards.week, actions: "loading" });
    say(`Your next 7 days. ${notable} ${notable === 1 ? "day is" : "days are"} worth planning around. Choosing what to do.`);
    const full = await requestWeek(lat, lon, state, true);
    if (id !== run.current) return;
    if (full.ok) {
      setWeek({ status: "ready", week: full.week, actions: "done" });
      say("What to do is ready.");
    } else {
      setWeek({ status: "ready", week: cards.week, actions: "failed" });
    }
  }, [lat, lon, state, say]);

  useEffect(() => {
    run.current += 1;
    void loadOutlook();
    void loadWeek();
    return () => {
      run.current += 1;
    };
  }, [loadOutlook, loadWeek]);

  useEffect(() => {
    say("Your street’s next 7 days.");
  }, [say]);

  return (
    <>
      <AheadMap data={data} outlook={outlook.status === "ready" ? outlook.outlook : null} />
      <aside id="panel" className="glass ahead" aria-label="Story" tabIndex={-1}>
        <section id="v-ahead" className="view on" aria-labelledby="ahead-h">
          <p className="eyebrow">Next 7 days · official forecasts, made local</p>
          <h1 id="ahead-h" className="ahead-h">
            Your street’s next 7 days
          </h1>
          <p className="ahead-addr">{data.address.matched}</p>

          {week.status === "loading" ? (
            <section aria-labelledby="wk-load-h">
              <h2 id="wk-load-h" className="sr">
                Loading the forecast
              </h2>
              <LoadSteps
                label="Reading your forecast"
                steps={[
                  { id: "nws", label: "Reading the National Weather Service forecast", state: "active" },
                  { id: "outlooks", label: "Reading the official outlooks and HeatRisk", state: "wait" },
                  { id: "record", label: "Checking what this street has seen before", state: "wait" },
                ]}
              />
              <div className="skeleton" aria-hidden="true" />
            </section>
          ) : week.status === "error" ? (
            <section aria-labelledby="wk-err-h">
              <h2 id="wk-err-h" className="sr">
                Forecast problem
              </h2>
              <p className="errcard" role="alert">
                <b>We couldn’t read your forecast.</b>
                {week.message}
              </p>
              <button type="button" className="ai-retry" onClick={() => void loadWeek()}>
                Try again
              </button>
            </section>
          ) : week.week.state !== "ok" ? (
            <section aria-labelledby="wk-err-h">
              <h2 id="wk-err-h" className="sr">
                Forecast problem
              </h2>
              <p className="errcard" role="alert">
                <b>We couldn’t read your forecast.</b>
                {week.week.notices.join(" ")}
              </p>
              <button type="button" className="ai-retry" onClick={() => void loadWeek()}>
                Try again
              </button>
            </section>
          ) : (
            <WeekCards week={week.week} status={week.actions} onRetryActions={() => void loadWeek()} />
          )}

          <details
            className="ahead-more"
            onToggle={(event) => {
              if ((event.currentTarget as HTMLDetailsElement).open) setMoreOpen(true);
            }}
          >
            <summary>More: the AI brief, the official outlooks, and ask your street</summary>
            {moreOpen ? <AheadMore data={data} outlook={outlook} onRetryOutlook={() => void loadOutlook()} /> : null}
          </details>

          <p className="ahead-fine">
            Forecasts and outlooks come from the National Weather Service. “What it meant here before” counts past days at this address: it is not a forecast and not our prediction. For warnings, use weather.gov.
          </p>
        </section>
      </aside>
    </>
  );
}
