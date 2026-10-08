import type { AiResult } from "@/lib/ui/ahead-client";

type Problem = Extract<AiResult, { ok: false }>;

const TITLE: Record<Problem["state"], string> = {
  resting: "The AI is resting",
  unavailable: "The AI is not available",
  rate_limited: "A few too many questions",
  bad_request: "That could not be asked",
  error: "The AI did not answer",
};

/**
 * An honest "the AI is not answering" state. It names what happened and says the official outlooks are unaffected;
 * it never fills the gap with a made-up answer. "Resting" (the day's allowance is used up) offers no retry.
 */
export function AiProblem({ result, onRetry }: { result: Problem; onRetry: () => void }) {
  const canRetry = result.state === "error" || result.state === "rate_limited";
  return (
    <div className="ai-problem" data-state={result.state} role="status">
      <p className="ai-p-t">{TITLE[result.state]}</p>
      <p className="ai-p-m">{result.message}</p>
      {canRetry ? (
        <button type="button" className="ai-retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
