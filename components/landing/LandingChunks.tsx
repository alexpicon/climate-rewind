"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The landing page, one idea per screen. Each <Chunk> fills the viewport and snaps into place as you scroll (normal scrolling,
 * never hijacked); the chunk on screen fades and rises in, the one leaving fades out. A dot rail on the right shows where you are.
 * A chunk taller than the screen (most of them on a phone) reveals its pieces one by one instead, and a phone scrolls freely, without
 * snapping. Without JavaScript, or with "reduce motion", every chunk is simply visible and the page scrolls as a normal page.
 */
export function Chunk({ id, label, className, children }: { id: string; label: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={className ? `chunk ${className}` : "chunk"} aria-label={label} data-chunk={label}>
      <div className="chunk-body">{children}</div>
    </section>
  );
}

export function LandingChunks({ children }: { children: ReactNode }) {
  const [chunks, setChunks] = useState<{ id: string; label: string }[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = document.getElementById("landing");
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("section.chunk"));
    setChunks(sections.map((s) => ({ id: s.id, label: s.dataset.chunk ?? s.id })));
    root.classList.add("chunks-on");
    sections[0]?.classList.add("in");

    // A section counts as on screen when half of it shows or it fills half the screen: one taller than two screens (a phone) can
    // never show half of itself.
    const cover = new Map<HTMLElement, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const screen = entry.rootBounds?.height || window.innerHeight;
          const share = entry.intersectionRect.height / screen;
          cover.set(el, entry.isIntersecting ? share : 0);
          el.classList.toggle("in", entry.isIntersecting && (entry.intersectionRatio >= 0.5 || share >= 0.5));
        }
        let best = 0;
        sections.forEach((s, i) => {
          if ((cover.get(s) ?? 0) > (cover.get(sections[best]) ?? 0)) best = i;
        });
        setActive(best);
        root.classList.toggle("wide-on", sections[best].classList.contains("chunk-wide"));
      },
      { root, threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    );
    sections.forEach((s) => observer.observe(s));

    // A section taller than the screen does not fade in as one block (its lower part would arrive already faded in): its pieces rise
    // in one by one as each reaches the screen, and stay.
    const pieces = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("rv-in");
          pieces.unobserve(entry.target);
        }
      },
      { root, threshold: 0.12 },
    );
    const markTall = () => {
      for (const s of sections) {
        // The first screen has its own entrance.
        const tall = !s.classList.contains("chunk-hero") && s.offsetHeight > window.innerHeight * 1.15;
        s.classList.toggle("chunk-tall", tall);
        if (!tall) continue;
        const body = s.querySelector(":scope > .chunk-body");
        for (const child of Array.from(body?.children ?? [])) {
          for (const piece of child.matches("ul, ol") ? Array.from(child.children) : [child]) {
            piece.classList.add("rv");
            if (!piece.classList.contains("rv-in")) pieces.observe(piece);
          }
        }
      }
    };
    markTall();
    window.addEventListener("resize", markTall);
    return () => {
      observer.disconnect();
      pieces.disconnect();
      window.removeEventListener("resize", markTall);
      root.classList.remove("chunks-on", "wide-on");
    };
  }, []);

  const go = (id: string) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <>
      {children}
      {chunks.length > 1 ? (
        <nav className="chunk-dots" aria-label="Sections of this page">
          {chunks.map((chunk, i) => (
            <button
              key={chunk.id}
              type="button"
              className={i === active ? "on" : undefined}
              aria-label={chunk.label}
              aria-current={i === active ? "true" : undefined}
              onClick={() => go(chunk.id)}
            />
          ))}
        </nav>
      ) : null}
    </>
  );
}
