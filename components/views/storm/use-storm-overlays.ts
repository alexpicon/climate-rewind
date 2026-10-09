"use client";

import { useEffect, useRef, useState } from "react";
import type { MapApi } from "@/components/map/map-context";
import type { RadarSignatures } from "@/lib/radar-signatures";
import type { LightningNight } from "@/lib/ui/lightning";
import { LightningLayer } from "./lightning-layer";
import { SignatureLayer } from "./signature-layer";

/**
 * The storm replay's extra layers: the satellite's lightning and the radar's hail and rotation flags. Each layer lives while its data
 * and the map do, and redraws for the replay's clock (`nowMs`, UTC); `visible` is false outside the radar replay itself.
 */
export function useStormOverlays(api: MapApi | null, lightning: LightningNight | null, flagged: RadarSignatures | null, reduced: boolean, nowMs: number, visible: boolean): void {
  const lightningRef = useRef<LightningLayer | null>(null);
  const signatureRef = useRef<SignatureLayer | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!api || !lightning) return;
    const layer = new LightningLayer(api, lightning, reduced);
    layer.enter();
    lightningRef.current = layer;
    setVersion((v) => v + 1);
    return () => {
      layer.destroy();
      lightningRef.current = null;
    };
  }, [api, lightning, reduced]);

  useEffect(() => {
    if (!api || !flagged) return;
    const layer = new SignatureLayer(api, flagged, reduced);
    layer.enter();
    signatureRef.current = layer;
    setVersion((v) => v + 1);
    return () => {
      layer.destroy();
      signatureRef.current = null;
    };
  }, [api, flagged, reduced]);

  useEffect(() => {
    lightningRef.current?.update(nowMs, visible);
    signatureRef.current?.update(nowMs, visible);
  }, [nowMs, visible, version]);
}
