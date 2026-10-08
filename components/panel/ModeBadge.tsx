import type { ReactNode } from "react";

interface Props {
  mode: "replay" | "correct" | "live";
  /** Only used when there is something to say beyond the mode name (the correction step). */
  title?: ReactNode;
  /** Short scale line, e.g. "1 s ≈ 5 min". */
  scale?: ReactNode;
}

const NAME = { replay: "Replay", correct: "Correction", live: "Live" } as const;

/** The tiny tag that always says what you are watching and how fast time moves. */
export function ModeBadge({ mode, title, scale }: Props) {
  return (
    <div id="modebadge" role="note" aria-label="What you are watching" data-mode={mode}>
      <span className="bm">{NAME[mode]}</span>
      <span className="btxt">
        {title ? <b id="bt">{title}</b> : null}
        {scale ? <span id="bs">{scale}</span> : null}
      </span>
    </div>
  );
}
