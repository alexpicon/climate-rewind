"use client";

import { useEffect, useMemo, useState } from "react";
import type { RadarSignatures, VortexSignature } from "@/lib/radar-signatures";
import type { NearbyTornado } from "@/lib/types";
import { tornadoesToAsk, windowFor } from "@/lib/ui/tornado-signatures";

export interface TornadoFlags {
  /** The radar's rotation flags around each tornado asked about, by tornado id. */
  byId: ReadonlyMap<string, readonly VortexSignature[]>;
  /** True once every request has answered (or failed). */
  done: boolean;
  /** Some requests failed: the flags shown may be incomplete. */
  partial: boolean;
}

/** Asks /api/signatures once per tornado (the strongest few) for the rotation the radar flagged around its path and touchdown. */
export function useTornadoFlags(tornadoes: readonly NearbyTornado[]): TornadoFlags {
  const asked = useMemo(() => tornadoesToAsk(tornadoes), [tornadoes]);
  const [state, setState] = useState<TornadoFlags>({ byId: new Map(), done: false, partial: false });

  useEffect(() => {
    const controller = new AbortController();
    const one = async (tornado: NearbyTornado): Promise<[string, VortexSignature[]] | null> => {
      const window = windowFor(tornado);
      const params = new URLSearchParams({ bbox: window.bounds.join(","), start: new Date(window.startMs).toISOString(), end: new Date(window.endMs).toISOString() });
      try {
        const response = await fetch(`/api/signatures?${params}`, { signal: controller.signal });
        if (!response.ok) return null;
        const body = (await response.json()) as RadarSignatures;
        return body.notice ? null : [tornado.id, body.vortex];
      } catch {
        return null;
      }
    };
    void Promise.all(asked.map(one)).then((results) => {
      if (controller.signal.aborted) return;
      const found = results.filter((r): r is [string, VortexSignature[]] => r !== null);
      setState({ byId: new Map(found), done: true, partial: found.length < results.length });
    });
    return () => controller.abort();
  }, [asked]);

  return state;
}
