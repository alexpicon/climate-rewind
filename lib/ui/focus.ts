/**
 * Keyboard and screen-reader focus after a change of view. When the thing that had focus goes away (the landing page,
 * a pre-roll card, a button that swapped views), focus would drop to <body> and the visitor would lose their place.
 * These move it to the heading of what is now on screen, so it is read first and the next Tab goes into the panel.
 */
const HEADING = "#panel h1, #how h1, #landing h1, #main-content h1";

/** Moves focus to the main heading of the current view. Returns false if there is none yet. */
export function focusPanelHeading(): boolean {
  const heading = document.querySelector<HTMLElement>(HEADING);
  if (!heading) return false;
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
  return document.activeElement === heading;
}

/**
 * Same, but after the current click has been handled and React has drawn the result. On a phone the panel is hidden
 * while a pre-roll card is up, so focus can only land on its heading once the card has gone.
 */
export function focusPanelHeadingSoon(): void {
  setTimeout(focusPanelHeading, 60);
}
