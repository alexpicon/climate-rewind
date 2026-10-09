"use client";

import { useEffect } from "react";
import { useAnnounce } from "@/components/announce";

export type StepState = "done" | "active" | "wait";
export interface Step {
  id: string;
  label: string;
  state: StepState;
  /** A short result beside a finished step ("100 James Robertson Pkwy, Nashville"). */
  note?: string;
}

const STATE_WORD: Record<StepState, string> = { done: "done", active: "in progress", wait: "waiting" };

/**
 * What a lookup is doing right now, one line per real stage. A step is "done" only when its request has come back, so the list is
 * progress, not a timer. A screen reader hears each step finish through the polite live region (not the whole list again).
 */
export function LoadSteps({ steps, label = "Progress" }: { steps: readonly Step[]; label?: string }) {
  const say = useAnnounce();
  const latest = [...steps].reverse().find((step) => step.state === "done");
  const active = steps.find((step) => step.state === "active");
  const text = latest ? `${latest.label}: done.${active ? ` Now ${active.label.toLowerCase()}.` : ""}` : "";
  useEffect(() => {
    if (text) say(text);
  }, [text, say]);
  return (
    <ol className="loadsteps" aria-label={label}>
      {steps.map((step) => (
        <li key={step.id} data-state={step.state}>
          <span className="mark" aria-hidden="true">
            {step.state === "done" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : null}
          </span>
          <span className="st-t">
            {step.label}
            {step.note ? <small>{step.note}</small> : null}
          </span>
          <span className="sr">, {STATE_WORD[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}

/** A section whose part of the lookup is still being read: one calm line and a skeleton (never a blank hole). */
export function Pending({ label }: { label: string }) {
  return (
    <div className="pending-part" role="status">
      <p className="ai-wait">{label}</p>
      <div className="skeleton" aria-hidden="true" />
    </div>
  );
}
