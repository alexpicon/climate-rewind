"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The landing page, one idea per screen. Each <Chunk> fills the viewport and snaps into place as you scroll (normal scrolling,
 * never hijacked); the chunk on screen fades and rises in, the one leaving fades out. A dot rail on the right shows where you are.
 * Without JavaScript, or with "reduce motion", every chunk is simply visible and the page scrolls as a normal page.
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
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            el.classList.add("in");
            setActive(sections.indexOf(el));
            root.classList.toggle("wide-on", el.classList.contains("chunk-wide"));
          } else {
            el.classList.remove("in");
          }
        }
      },
      { root, threshold: 0.5 },
    );
    sections.forEach((s) => observer.observe(s));
    return () => {
      observer.disconnect();
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
