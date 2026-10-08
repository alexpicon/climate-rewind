import type { ReactNode } from "react";

/** "More": everything beyond the big number and the one sentence. */
export function More({ children, label = "More" }: { children: ReactNode; label?: string }) {
  return (
    <details className="more">
      <summary>{label}</summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

/** The text version every animation owes screen reader and low-vision visitors. */
export function TextVersion({ children }: { children: ReactNode }) {
  return (
    <details className="textver">
      <summary>Text version of this animation</summary>
      {children}
    </details>
  );
}
