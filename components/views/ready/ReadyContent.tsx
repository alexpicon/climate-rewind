import type { ReactNode } from "react";
import { PrecomputedNote } from "@/components/panel/PrecomputedNote";
import type { ReadyItem, ReadyPayload } from "@/lib/ready/types";
import "./ready.css";

/** One plan item: what to do, why (a real record from the area, with its date), and the official line it follows. */
export function ReadyItemView({ item, id, mapped = false, active = false, onShow }: { item: ReadyItem; id: string; mapped?: boolean; active?: boolean; onShow?: () => void }) {
  return (
    <li className={`rd-item${active ? " lit" : ""}`}>
      <div className="rd-row">
        <input type="checkbox" id={id} className="rd-box" aria-describedby={`${id}-why`} />
        <label htmlFor={id} className="rd-action">
          {item.action}
        </label>
      </div>
      {mapped && onShow ? (
        <button type="button" className="rd-show" aria-pressed={active} onClick={onShow}>
          Show on map
        </button>
      ) : null}
      <p className="rd-why" id={`${id}-why`}>
        <span className="rd-k">Why:</span>{" "}
        {item.why.map((fact, i) => (
          <span key={fact.id}>
            {i > 0 ? "; " : ""}
            {fact.href ? (
              <a href={fact.href} target="_blank" rel="noopener noreferrer">
                {fact.label}
                <span className="sr"> (opens the record in a new tab)</span>
              </a>
            ) : (
              fact.label
            )}
          </span>
        ))}
      </p>
      <p className="rd-srcline">
        <span className="rd-k">Official source:</span>{" "}
        {item.guidance.filter((line, i, all) => all.findIndex((other) => other.url === line.url) === i).map((line, i) => (
          <span key={line.id}>
            {i > 0 ? "; " : ""}
            <a href={line.url} target="_blank" rel="noopener noreferrer">
              {line.source}
              <span className="sr"> (official source, opens in a new tab)</span>
            </a>
          </span>
        ))}
      </p>
      <details className="rd-more">
        <summary>What the official {item.guidance.length === 1 ? "page says" : "pages say"}</summary>
        {item.guidance.map((line) => (
          <blockquote className="rd-src" key={line.id}>
            <p>“{line.text}”</p>
            <footer>{line.source}</footer>
          </blockquote>
        ))}
      </details>
    </li>
  );
}

/** The plan and what is behind it. `problem` is the honest "AI is not answering" block, shown instead of a plan. */
export function ReadyContent({ payload, problem, onPrint, pinned, active, onShow }: { payload: ReadyPayload; problem: ReactNode; onPrint?: () => void; pinned?: ReadonlySet<number>; active?: number | null; onShow?: (index: number) => void }) {
  return (
    <>
      {payload.state === "ok" ? (
        <section className="rd-card rd-ai" aria-labelledby="rd-plan-h">
          <h2 id="rd-plan-h" className="sec-t">
            <span className="tag ai" aria-hidden="true">
              AI
            </span>
            <span aria-hidden="true">Your plan</span>
            <span className="sr">Your plan, written by an AI</span>
          </h2>
          <p className="ai-sub">Written by an AI from your area’s record. An item is shown only if it names a real record from your area and an official safety line; tick items off as you go.</p>
          {payload.precomputed ? <PrecomputedNote at={payload.precomputed.at} what="plan" /> : null}
          <ol className="rd-list">
            {payload.items.map((item, i) => (
              <ReadyItemView key={`${i}-${item.action}`} item={item} id={`rd-item-${i}`} mapped={pinned?.has(i)} active={active === i} onShow={onShow ? () => onShow(i) : undefined} />
            ))}
          </ol>
          {payload.dropped > 0 ? (
            <p className="ai-dropped">
              {payload.dropped} {payload.dropped === 1 ? "item" : "items"} the AI wrote {payload.dropped === 1 ? "was" : "were"} removed because {payload.dropped === 1 ? "it" : "they"} could not be matched to both a record from your area and an official safety line.
            </p>
          ) : null}
          {onPrint ? (
            <button type="button" className="ai-retry rd-print-btn" onClick={onPrint}>
              Print this plan
            </button>
          ) : null}
        </section>
      ) : payload.state === "problem" ? (
        <section className="rd-card" aria-labelledby="rd-plan-h">
          <h2 id="rd-plan-h" className="sec-t">
            Your plan
          </h2>
          {problem}
        </section>
      ) : (
        <section className="rd-card" aria-labelledby="rd-plan-h">
          <h2 id="rd-plan-h" className="sec-t">
            Your plan
          </h2>
          <p className="rd-empty">{payload.notices[payload.notices.length - 1]}</p>
        </section>
      )}

      {payload.hazards.length > 0 ? (
        <section className="rd-card" aria-labelledby="rd-rec-h">
          <h2 id="rd-rec-h" className="sec-t">
            What your area’s record holds
          </h2>
          <ul className="rd-hazards">
            {payload.hazards.map((h) => (
              <li key={h.id}>
                <b>{h.label}</b>
                <span>{h.evidence}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {payload.notices.length > 0 && payload.state !== "empty" ? (
        <ul className="rd-notices">
          {payload.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
