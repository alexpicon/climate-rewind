"use client";

import { useEffect, useState, type RefObject } from "react";

/** Sections fade in one at a time only on a large screen with motion allowed (see LandingChunks and calm.css). */
const GATED_MEDIA = "(min-width: 701px) and (prefers-reduced-motion: no-preference)";

/**
 * True once an element is really on screen: in view, and, where the landing page fades its sections in one at a time, inside the
 * section showing now. An animation that starts on this is seen from its first frame instead of playing while its section is still
 * faded out.
 */
export function useShown(ref: RefObject<HTMLElement | null>, threshold = 0.35): boolean {
  const [inView, setInView] = useState(false);
  const [sectionOn, setSectionOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { threshold });
    io.observe(el);
    const section = el.closest<HTMLElement>("section.chunk");
    const root = document.getElementById("landing");
    const check = () => {
      const gated = Boolean(section && root?.classList.contains("chunks-on") && !section.classList.contains("chunk-tall") && window.matchMedia(GATED_MEDIA).matches);
      setSectionOn(!gated || Boolean(section?.classList.contains("in")));
    };
    check();
    const mo = new MutationObserver(check);
    if (section) mo.observe(section, { attributes: true, attributeFilter: ["class"] });
    if (root) mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [ref, threshold]);

  return inView && sectionOn;
}
