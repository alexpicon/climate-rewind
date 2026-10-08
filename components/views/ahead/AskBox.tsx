"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAnnounce } from "@/components/announce";
import { MAX_QUESTION_CHARS } from "@/lib/ai/types";
import { requestAsk, type AiResult } from "@/lib/ui/ahead-client";
import { AiAnswerView } from "./AiAnswerView";
import { AiProblem } from "./AiProblem";

export const SUGGESTED_QUESTIONS = [
  "What do the official outlooks say for the next 3 days here?",
  "Has a flood been reported near this address?",
  "How does the forecast heat compare with past years here?",
] as const;

type Asked = { status: "idle" } | { status: "loading"; question: string } | { status: "done"; question: string; result: AiResult };

/** "Ask your street": a short question, answered only from this address's records, with the same checks as the brief. */
export function AskBox({ address }: { address: string }) {
  const say = useAnnounce();
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<Asked>({ status: "idle" });
  const run = useRef(0);

  // A new address starts a fresh conversation.
  useEffect(() => {
    run.current += 1;
    setAsked({ status: "idle" });
    setText("");
  }, [address]);

  const ask = async (question: string) => {
    const clean = question.trim();
    if (!clean || clean.length > MAX_QUESTION_CHARS) return;
    const id = ++run.current;
    setAsked({ status: "loading", question: clean });
    say("Checking the records for an answer.");
    const result = await requestAsk(address, clean);
    if (id !== run.current) return;
    setAsked({ status: "done", question: clean, result });
    if (result.ok) say(result.answer.state === "ok" ? `Answer ready: ${result.answer.sentences.length} checked ${result.answer.sentences.length === 1 ? "sentence" : "sentences"}, each with its source.` : result.answer.message ?? "No answer.");
    else say(result.message);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(text);
  };

  const busy = asked.status === "loading";
  const left = MAX_QUESTION_CHARS - text.length;

  return (
    <section className="askbox" aria-labelledby="ask-h">
      <h2 id="ask-h" className="sec-t">
        <span className="tag ai" aria-hidden="true">
          AI
        </span>
        <span aria-hidden="true">Ask your street</span>
        <span className="sr">Ask your street, with AI</span>
      </h2>
      <p className="ai-sub">Ask about floods, tornadoes, heat or the outlooks at this address. It answers only from the records on this page, and every sentence shows its source.</p>

      <form onSubmit={submit}>
        <label htmlFor="ask-q" className="ask-l">
          Your question
        </label>
        <textarea
          id="ask-q"
          name="question"
          rows={2}
          maxLength={MAX_QUESTION_CHARS}
          value={text}
          placeholder="For example: has this street flooded before?"
          aria-describedby="ask-count"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter makes a new line.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void ask(text);
            }
          }}
        />
        <div className="ask-row">
          <span id="ask-count" className="ask-count" data-low={left <= 30 ? "true" : undefined}>
            {left} of {MAX_QUESTION_CHARS} characters left
          </span>
          <button className="ask-go" type="submit" disabled={busy || !text.trim()}>
            {busy ? "Checking…" : "Ask"}
          </button>
        </div>
      </form>

      <ul className="suggest" aria-label="Questions to try">
        {SUGGESTED_QUESTIONS.map((question) => (
          <li key={question}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setText(question);
                void ask(question);
              }}
            >
              {question}
            </button>
          </li>
        ))}
      </ul>

      <div className="ask-out" aria-live="polite">
        {asked.status === "loading" ? (
          <>
            <p className="ask-q">{asked.question}</p>
            <p className="ai-wait" role="status">
              Checking the records…
            </p>
            <div className="skeleton" aria-hidden="true" />
          </>
        ) : null}
        {asked.status === "done" ? (
          <>
            <p className="ask-q">{asked.question}</p>
            {asked.result.ok ? <AiAnswerView answer={asked.result.answer} /> : <AiProblem result={asked.result} onRetry={() => void ask(asked.question)} />}
          </>
        ) : null}
      </div>
    </section>
  );
}
