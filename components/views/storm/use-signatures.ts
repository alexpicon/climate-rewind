"use client";

import { useEffect, useState } from "react";
import type { RadarSignatures } from "@/lib/radar-signatures";

export type SignatureState = { status: "loading" } | { status: "ready"; signatures: RadarSignatures } | { status: "failed" };

/** The radar's hail and rotation flags for a replay night (any address). A failure only means no flags, with a plain line. */
export function useSignatures(bounds: readonly number[] | undefined, startUtc: string, endUtc: string): SignatureState {
  const key = `${bounds?.join(",") ?? ""}|${startUtc}|${endUtc}`;
  const [state, setState] = useState<{ key: string; value: SignatureState }>({ key, value: { status: "loading" } });

  useEffect(() => {
    if (!bounds || bounds.length !== 4) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ bbox: bounds.join(","), start: startUtc, end: endUtc });
    fetch(`/api/signatures?${params}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<RadarSignatures>) : null))
      .then((signatures) => setState({ key, value: signatures ? { status: "ready", signatures } : { status: "failed" } }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, value: { status: "failed" } });
      });
    return () => controller.abort();
    // The key holds the bounds and times.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state.key === key ? state.value : { status: "loading" };
}
