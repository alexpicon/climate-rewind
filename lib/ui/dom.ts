/**
 * Tiny DOM builders for MapLibre markers (which need real elements). Text always goes
 * through textContent; the only innerHTML used is fixed SVG defined in this codebase.
 */

export interface ElOptions {
  className?: string;
  text?: string;
  /** Fixed, trusted markup only (our own SVG strings). Never data from a report. */
  svg?: string;
  attrs?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: Array<Node | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.svg) node.innerHTML = options.svg;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

/** Marker content is decorative to assistive tech unless it says otherwise. */
export function decorative<T extends HTMLElement>(node: T): T {
  node.setAttribute("aria-hidden", "true");
  return node;
}

export const HOUSE_SVG =
  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false"><path d="M12 2.6 1.9 11.6h2.9V21h5.3v-6.2h3.8V21h5.3v-9.4h2.9z" fill="#1b1204" stroke="#1b1204" stroke-width="1" stroke-linejoin="round"/></svg>';

/** The one address marker: a house icon whose centre is the Census point. */
export function createAddressMarkerElement(matched: string): HTMLElement {
  const [street, ...rest] = matched.split(",");
  const house = el("span", { className: "house", attrs: { tabindex: "0", role: "img", "aria-label": `Your address: ${matched}` } }, [
    el("span", { className: "pulse" }),
    el("span", { className: "pulse p2" }),
    el("span", { className: "tpulse" }),
    el("span", { className: "hbody", svg: HOUSE_SVG }),
    decorative(el("span", { className: "tip" }, [el("b", { text: street.trim() }), el("i", { text: rest.join(",").trim() })])),
  ]);
  return el("div", { className: "addr-pin" }, [house]);
}
