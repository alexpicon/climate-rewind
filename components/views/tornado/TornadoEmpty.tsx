"use client";

import { useRestOnAddress } from "@/components/map/use-rest-on-address";
import { INDEXED_STATES_TEXT } from "@/lib/constants";
import type { LookupPayload } from "@/lib/types";

export function TornadoEmpty({ data }: { data: LookupPayload }) {
  useRestOnAddress(data.address.lat, data.address.lon);
  const notIndexed = data.coverage === "not yet indexed";
  if (notIndexed) {
    return (
      <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
        <section id="v-tornado" className="view on" aria-labelledby="tor-h">
          <h1 className="sr" id="tor-h">Tornado paths: not indexed yet</h1>
          <p className="eyebrow">Tornadoes · not indexed yet</p>
          <div className="big" aria-hidden="true"><span>–</span></div>
          <p className="lede">We have not indexed {data.address.state || "this state"} yet, so there are no tornado paths to show here.</p>
          <p className="note">Tornado paths are indexed for {INDEXED_STATES_TEXT} so far. No paths shown here does not mean there were none.</p>
        </section>
      </aside>
    );
  }
  return (
    <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
      <section id="v-tornado" className="view on" aria-labelledby="tor-h">
        <h1 className="sr" id="tor-h">Tornado paths within 10 kilometres</h1>
        <p className="eyebrow">Tornadoes · within 10 km</p>
        <div className="big" aria-hidden="true"><span>0</span></div>
        <p className="lede">No tornado path in the records we have came within 10 km of this address.</p>
        <p className="note">That is what our records show. It is not a promise that one never will.</p>
      </section>
    </aside>
  );
}
