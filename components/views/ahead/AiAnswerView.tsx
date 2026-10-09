"use client";

import { useId, useRef, useState } from "react";
import { useAnnounce } from "@/components/announce";
import type { AiAnswer, PublicSource } from "@/lib/ai/types";

const KIND_LABEL: Record<PublicSource["kind"], string> = {
  outlook: "Official outlook",
  record: "How it played out here",
  report: "NWS flood report",
  history: "Our records",
  tornado: "NWS tornado record",
  damage: "Damage map",
  heat: "Heat",
  trigger: "Flood trigger",
  alert: "Live alert",
  fema: "FEMA",
  event: "NWS Storm Events record",
};

/**
 * A verified answer: only sentences the checker passed, each with chips for the sources behind it. A chip opens the source
 * (its facts, the agency's own words if there are any, and a link where the record can be checked).
 */
export function AiAnswerView({ answer }: { answer: AiAnswer }) {
  const uid = useId();
  const say = useAnnounce();
  // The chip that is open, as "sentence number:source id" (the same source can sit under several sentences).
  const [open, setOpen] = useState<string | null>(null);
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const source = open ? answer.sources[open.slice(open.indexOf(":") + 1)] : null;

  const toggle = (chipKey: string, title: string) => {
    const next = open === chipKey ? null : chipKey;
    setOpen(next);
    if (next) say(`Source shown: ${title}.`);
  };
  const close = () => {
    const key = open;
    setOpen(null);
    if (key) chips.current.get(key)?.focus();
  };

  if (answer.state !== "ok") {
    return (
      <div className="ai-msg" data-state={answer.state}>
        {answer.lead ? <p className="ai-lead">{answer.lead}</p> : null}
        <p>{answer.message}</p>
        {answer.dropped > 0 ? <p className="ai-dropped">{answer.dropped} {answer.dropped === 1 ? "sentence" : "sentences"} the AI wrote could not be matched to a source, so none is shown.</p> : null}
      </div>
    );
  }

  return (
    // Escape closes the open source from the chip or from inside the card.
    <div className="ai-answer" onKeyDown={(event) => event.key === "Escape" && open && close()}>
      {answer.lead ? <p className="ai-lead">{answer.lead}</p> : null}
      <div className="ai-sents">
        {answer.sentences.map((sentence, i) => (
          <p className="ai-s" key={`${i}-${sentence.text}`}>
            {sentence.text}
            <span className="cites" role="group" aria-label="Sources for this sentence">
              {sentence.cites.map((id) => {
                const src = answer.sources[id];
                if (!src) return null;
                const chipKey = `${i}:${id}`;
                return (
                  <button
                    key={chipKey}
                    type="button"
                    className="cite"
                    aria-expanded={open === chipKey}
                    aria-controls={`${uid}-src`}
                    aria-label={`${src.chip}, source: ${src.title}`}
                    ref={(node) => {
                      if (node) chips.current.set(chipKey, node);
                    }}
                    onClick={() => toggle(chipKey, src.title)}
                  >
                    {src.chip}
                  </button>
                );
              })}
            </span>
          </p>
        ))}
      </div>

      {answer.dropped > 0 ? (
        <p className="ai-dropped">
          {answer.dropped} {answer.dropped === 1 ? "sentence" : "sentences"} the AI wrote {answer.dropped === 1 ? "was" : "were"} removed because {answer.dropped === 1 ? "it" : "they"} could not be matched to a source or a number in one.
        </p>
      ) : null}

      <div id={`${uid}-src`} aria-live="polite">
        {source ? (
          <section className="srccard" aria-label={`Source: ${source.title}`}>
            <div className="src-head">
              <span className="src-kind">{KIND_LABEL[source.kind]}</span>
              <button type="button" className="src-x" onClick={close}>
                Close<span className="sr"> source</span>
              </button>
            </div>
            <p className="src-title">{source.title}</p>
            <p className="src-origin">{source.origin}</p>
            <p className="src-text">{source.text}</p>
            {source.quote ? (
              <>
                <blockquote className="src-quote">“{source.quote}”</blockquote>
                <p className="src-origin">Word for word from the record. It is shown as a quotation, never as an instruction.</p>
              </>
            ) : null}
            {source.href ? (
              <a className="src-link" href={source.href} target="_blank" rel="noopener noreferrer">
                Open the record<span className="sr"> (opens in a new tab)</span>
              </a>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
