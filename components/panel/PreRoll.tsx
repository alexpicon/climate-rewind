"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useMapApi } from "@/components/map/map-context";

interface Props {
  mode: string;
  sentence: string;
  scale: ReactNode;
  buttonLabel: string;
  onGo: () => void;
  altLabel?: string;
  onAlt?: () => void;
  /** Radar (or similar) still loading: the button waits. It stays focusable (aria-disabled) so focus is never lost. */
  busy?: boolean;
  /**
   * Move focus to the button when the card appears. Off for the first card of a view (the view moves focus to the panel heading
   * instead); on for the "next step" card that appears when an animation ends.
   */
  takeFocus?: boolean;
  /** Called when the visitor chooses any button on the card, before the card goes away. */
  onLeave?: () => void;
}

/**
 * "This is what really happened over your street that night." Shown once, the first time a tab
 * is opened, and again only when there is a real next step (like the correction).
 */
export function PreRoll({ mode, sentence, scale, buttonLabel, onGo, altLabel, onAlt, busy = false, takeFocus = true, onLeave }: Props) {
  const goRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useClearOfCard(cardRef);

  // Keyboard users land on the one action; the page behind stays readable.
  useEffect(() => {
    if (takeFocus) goRef.current?.focus({ preventScroll: true });
  }, [sentence, takeFocus]);

  return (
    <div id="preroll" ref={cardRef} className="glass" role="region" aria-labelledby="pre-s">
      <p className="pre-mode">{mode}</p>
      <p className="pre-s" id="pre-s">
        {sentence}
      </p>
      <p className="pre-scale">{scale}</p>
      <button
        ref={goRef}
        className="btn"
        id="pre-go"
        type="button"
        aria-disabled={busy || undefined}
        onClick={() => {
          if (busy) return;
          onLeave?.();
          onGo();
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
        </svg>
        <span>{busy ? "Loading radar…" : buttonLabel}</span>
      </button>
      {altLabel && onAlt ? (
        <button
          className="linkbtn"
          id="pre-alt"
          type="button"
          onClick={() => {
            onLeave?.();
            onAlt();
          }}
        >
          {altLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The card must never sit on the house marker. Once the camera has settled, if the marker (or its caption) is under
 * the card, the map's padding grows so the marker lands just below the card, and eases back when the card goes away.
 * Only the padding changes: the zoom and the locked camera box stay as they were.
 */
function useClearOfCard(cardRef: React.RefObject<HTMLDivElement | null>): void {
  const api = useMapApi();
  useEffect(() => {
    if (!api) return;
    const { map } = api;
    let applied = 0;
    let ownMove = false;
    let timers: Array<ReturnType<typeof setTimeout>> = [];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const measure = () => {
      // Never cut a flight short: an ease would stop it where it is. The move that ends the flight measures again.
      if (map.isMoving()) return;
      const card = cardRef.current?.getBoundingClientRect();
      const house = document.querySelector(".addr-pin .house")?.getBoundingClientRect();
      const caption = document.querySelector(".addr-pin .lab")?.getBoundingClientRect();
      if (!card || !house) return;
      const bottom = Math.max(house.bottom, caption?.bottom ?? 0);
      const overlaps = house.right > card.left - 12 && house.left < card.right + 12 && bottom > card.top - 12 && house.top < card.bottom + 12;
      if (!overlaps) return;
      // Move the marker below the card, but never under the dock (on a phone the dock is hidden while the card is up, so the tabs are the floor).
      const floorEl = document.getElementById(window.innerWidth <= 900 ? "tabs" : "dock");
      const floor = floorEl?.getBoundingClientRect().top ?? window.innerHeight - 120;
      const wanted = card.bottom + 16 - house.top;
      const room = floor - 12 - bottom;
      const shift = Math.min(wanted, room);
      if (shift < 8) return;
      // A padding of P pixels moves what is drawn at the centre by P / 2.
      applied += shift * 2;
      ownMove = true;
      // Add to whatever padding the map has (the 3D view keeps the address clear of the panel with its own padding); never replace it.
      const base = map.getPadding();
      map.easeTo({ padding: { ...base, top: (base.top ?? 0) + shift * 2 }, duration: still ? 0 : 600, essential: false });
    };
    const onMoveEnd = () => {
      if (ownMove) {
        ownMove = false;
        return;
      }
      timers.push(setTimeout(measure, 80));
    };
    map.on("moveend", onMoveEnd);
    timers = [700, 1500, 2500, 3500, 5000].map((ms) => setTimeout(measure, ms));

    return () => {
      timers.forEach(clearTimeout);
      map.off("moveend", onMoveEnd);
      if (applied > 0 && map.getStyle()) {
        const base = map.getPadding();
        map.easeTo({ padding: { ...base, top: Math.max(0, (base.top ?? 0) - applied) }, duration: still ? 0 : 700, essential: false });
      }
    };
  }, [api, cardRef]);
}
