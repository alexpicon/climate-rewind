import type { ReactNode } from "react";
import { dayHeading, quietDetail, tempsText, tidyWords } from "@/lib/week/format";
import { LEVEL_WORD, type WeekAction, type WeekDay, type WeekHazard, type WeekHazardKind, type WeekPayload } from "@/lib/week/types";

/** Plain line icons, one per hazard. Decorative: the hazard is always written out beside them. */
const ICON: Record<WeekHazardKind, ReactNode> = {
  heat: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  flood: (
    <>
      <path d="M7 15a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7" />
      <path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2" />
    </>
  ),
  storm: (
    <>
      <path d="M7 14a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7a3.5 3.5 0 0 1 .5 7" />
      <path d="M12.5 12l-2.5 4h3l-2 4" />
    </>
  ),
  wind: <path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7" />,
};

export function HazardIcon({ kind }: { kind: WeekHazardKind }) {
  return (
    <svg className="wk-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON[kind]}
    </svg>
  );
}

function Actions({ day, status, onRetry }: { day: WeekDay; status: ActionsStatus; onRetry: () => void }) {
  if (day.actions.length === 0) {
    if (status === "loading") return <p className="wk-wait" role="status">Choosing what to do from the official guidance…</p>;
    if (status === "failed") {
      return (
        <p className="wk-wait">
          We could not load the advice just now.{" "}
          <button type="button" className="ai-retry wk-retry" onClick={onRetry}>
            Try again
          </button>
        </p>
      );
    }
    return null;
  }
  const items: WeekAction[] = day.actions;
  // "(during extreme heat)" is true of the NWS page, not of this day: only say it on a day with the highest heat concern.
  const extreme = day.hazards.some((h) => h.kind === "heat" && h.level === 3);
  const sourceOf = (source: string) => (extreme ? source : source.replace(/\s*\(during extreme heat\)/i, ""));
  return (
    <>
      <ul className="wk-actions">
        {items.map((action) => (
          <li key={action.text}>
            <span>{action.text}</span>{" "}
            <span className="wk-cites">
              {action.guidance.filter((line, i, all) => all.findIndex((other) => other.url === line.url) === i).map((line) => (
                <a key={line.id} className="wk-cite" href={line.url} target="_blank" rel="noreferrer noopener" aria-label={`Official guidance: ${sourceOf(line.source)} (opens in a new tab)`}>
                  {sourceOf(line.source)}
                </a>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {day.actionsFrom === "official" ? <p className="wk-fine">Official guidance, word for word. The AI was not available, so nothing here is written by it.</p> : null}
    </>
  );
}

export type ActionsStatus = "loading" | "done" | "failed";

function Hazard({ hazard }: { hazard: WeekHazard }) {
  return (
    <div className="wk-haz" data-level={hazard.level}>
      <p className="wk-haz-t">
        <HazardIcon kind={hazard.kind} />
        <span className="wk-haz-name">{hazard.title}</span>
        <span className="wk-level">{LEVEL_WORD[hazard.level]}</span>
      </p>
      <p className="wk-plain">{hazard.plain}</p>
      <p className="wk-src">{hazard.source}</p>
    </div>
  );
}

/** One notable day: what to expect, what it meant here before, one line of climate context, what to do. */
function NotableDay({ day, status, onRetry }: { day: WeekDay; status: ActionsStatus; onRetry: () => void }) {
  const heading = dayHeading(day.index, day.date);
  const worst = Math.max(...day.hazards.map((h) => h.level));
  const temps = tempsText(day.forecast);
  const words = tidyWords(day.forecast.words);
  const before = day.hazards.filter((h) => h.before);
  const climate = day.hazards.filter((h) => h.climate);
  const id = `wk-${day.date}`;
  return (
    <li className="wk-day wk-notable" data-level={worst}>
      <article aria-labelledby={id}>
        <header className="wk-head">
          <h3 id={id} className="wk-day-h">
            <span className="wk-weekday">{heading.label}</span>
            <span className="wk-date">{heading.dateText}</span>
          </h3>
          <span className="wk-kinds" aria-hidden="true">
            {day.hazards.map((h) => (
              <HazardIcon key={h.kind} kind={h.kind} />
            ))}
          </span>
        </header>
        {words || temps ? <p className="wk-fc">{[words, temps].filter(Boolean).join(" · ")}</p> : null}

        <h4 className="wk-sub">What to expect</h4>
        {day.hazards.map((h) => (
          <Hazard key={h.kind} hazard={h} />
        ))}

        {before.length ? (
          <>
            <h4 className="wk-sub">What it meant here before</h4>
            {before.map((h) => (
              <p key={h.kind} className="wk-before">
                {h.before}
              </p>
            ))}
          </>
        ) : null}

        {climate.map((h) => (
          <p key={h.kind} className="wk-climate">
            <span className="wk-climate-t">Climate context</span> {h.climate}
          </p>
        ))}

        <h4 className="wk-sub">What to do</h4>
        <Actions day={day} status={status} onRetry={onRetry} />
      </article>
    </li>
  );
}

function QuietDay({ day }: { day: WeekDay }) {
  const heading = dayHeading(day.index, day.date);
  return (
    <li className="wk-day wk-quiet">
      <p>
        <span className="wk-weekday">{heading.label}</span>
        <span className="wk-date">{heading.dateText}</span>
        <span className="wk-q">Nothing unusual expected</span>
        <span className="wk-qd">{quietDetail(day.forecast)}</span>
      </p>
    </li>
  );
}

/**
 * The seven day cards. Quiet days are one line; notable days open out. Color is only a second cue: every level is written in words.
 * `status` says whether the "what to do" advice is still being chosen.
 */
export function WeekCards({ week, status, onRetryActions }: { week: WeekPayload; status: ActionsStatus; onRetryActions: () => void }) {
  const notable = week.days.filter((d) => d.notable).length;
  return (
    <section className="wk" aria-labelledby="wk-h">
      <h2 id="wk-h" className="sec-t">
        Day by day
      </h2>
      <p className="wk-sum">{notable === 0 ? "Nothing unusual is expected here this week." : `${notable} of the next 7 days ${notable === 1 ? "is" : "are"} worth planning around.`}</p>
      <ol className="wk-list">
        {week.days.map((day) => (day.notable ? <NotableDay key={day.date} day={day} status={status} onRetry={onRetryActions} /> : <QuietDay key={day.date} day={day} />))}
      </ol>
      {week.notices.length ? (
        <ul className="wk-notices">
          {week.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
