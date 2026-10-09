"use client";

import { More } from "@/components/panel/Disclosure";
import { lightningCounts, satelliteName, type LightningNight } from "@/lib/ui/lightning";
import { hailSize, signatureCounts } from "@/lib/ui/signatures";
import type { SignatureState } from "./use-signatures";

/** What else the storm replay shows beside the rain and the reports: the satellite's lightning and the radar's own flags. */
export function StormSignals({ lightning, signatures, nowMs }: { lightning: LightningNight | null; signatures?: SignatureState; nowMs: number }) {
  return (
    <>
      {lightning ? <LightningLine lightning={lightning} nowMs={nowMs} /> : null}
      {signatures ? <RadarFlagsLine state={signatures} nowMs={nowMs} /> : null}
    </>
  );
}

/** "1,204 lightning flashes so far, seen from space by GOES-16", with what the satellite's numbers mean one click away. */
function LightningLine({ lightning, nowMs }: { lightning: LightningNight; nowMs: number }) {
  const { total, soFar } = lightningCounts(lightning, nowMs);
  const satellite = satelliteName(lightning.source);
  return (
    <div className="bolt-line">
      <p>
        <span className="bolt-ic" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" focusable="false">
            <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
          </svg>
        </span>
        {total === 0 ? (
          <>The {satellite} lightning mapper saw no lightning in this area that night.</>
        ) : (
          <>
            <b>{soFar.toLocaleString("en-US")}</b> lightning flashes so far, of {total.toLocaleString("en-US")} that night, seen from space by {satellite}.
          </>
        )}
      </p>
      <More label="About the lightning">
        <p className="note">
          Each white burst is one flash the {satellite} Geostationary Lightning Mapper recorded, at the minute it happened. Its place is the centre of the light the satellite saw, good to roughly 8 to 14 km. A bigger burst gave off more light; that is not the strike’s electric current. It counts all lightning, in cloud and to the ground.
          {lightning.filesMissing > 0 ? ` ${lightning.filesMissing} of ${lightning.files} twenty-second files could not be read, so a few flashes may be missing.` : ""}
        </p>
      </More>
    </div>
  );
}

/** "12 hail detections so far (largest about 1.75 in), 4 rotation signatures", with what the radar's flags are one click away. */
function RadarFlagsLine({ state, nowMs }: { state: SignatureState; nowMs: number }) {
  if (state.status === "loading") return null;
  if (state.status === "failed") return <p className="note sig-note">The radar’s hail and rotation flags could not be read just now.</p>;
  const { signatures } = state;
  const { hail, largestIn, vortex } = signatureCounts(signatures, nowMs);
  const none = signatures.hail.length === 0 && signatures.vortex.length === 0;
  return (
    <div className="bolt-line sig-line">
      <p>
        <span className="sig-ic" aria-hidden="true" />
        {none ? (
          <>The radars flagged no hail or rotation in this area that night.</>
        ) : (
          <>
            Radar flags so far: <b>{hail.toLocaleString("en-US")}</b> hail {hail === 1 ? "detection" : "detections"}
            {hail > 0 ? <> (largest estimate {hailSize(largestIn)})</> : null}, <b>{vortex.toLocaleString("en-US")}</b> rotation {vortex === 1 ? "signature" : "signatures"}.
          </>
        )}
      </p>
      {signatures.notice ? <p className="note sig-note">{signatures.notice}</p> : null}
      <More label="About the radar flags">
        <p className="note">
          These are what the National Weather Service radars’ own computer algorithms flagged on each scan, from NOAA’s Severe Weather Data
          Inventory. A blue disc is a hail detection, sized by the estimated largest hailstone. A red ring is a tornado vortex signature: strong
          rotation seen by the radar. Neither is a confirmed report: hail may not reach the ground, and most rotation signatures never become
          tornadoes.
        </p>
      </More>
    </div>
  );
}
