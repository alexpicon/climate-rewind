"use client";

import { useRestOnAddress } from "@/components/map/use-rest-on-address";
import { FemaCard } from "@/components/panel/FemaCard";
import { More } from "@/components/panel/Disclosure";
import { INDEXED_STATES_TEXT } from "@/lib/constants";
import type { LookupPayload } from "@/lib/types";

/** Nothing to replay: say why, honestly, and still show what we do know. */
export function StormEmpty({ data }: { data: LookupPayload }) {
  useRestOnAddress(data.address.lat, data.address.lon);
  const notIndexed = data.coverage === "not yet indexed";
  if (notIndexed) {
    return (
      <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
        <section id="v-storm" className="view on" aria-labelledby="storm-h">
          <h1 className="sr" id="storm-h">Storm replay: not indexed yet</h1>
          <p className="eyebrow">Storm replay · not indexed yet</p>
          <div className="big" aria-hidden="true"><span>–</span></div>
          <p className="lede">We have not indexed {data.address.state || "this state"} yet, so there is no storm night to replay here.</p>
          <p className="note">Flood reports are indexed for {INDEXED_STATES_TEXT} so far. The FEMA flood zone below and the heat tab are live for any US address.</p>
          <FemaCard fema={data.fema} notice={data.notices.fema} />
        </section>
      </aside>
    );
  }
  return (
    <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
      <section id="v-storm" className="view on" aria-labelledby="storm-h">
        <h1 className="sr" id="storm-h">Storm replay</h1>
        <p className="eyebrow">Storm replay</p>
        <div className="big" aria-hidden="true"><span>0</span></div>
        <p className="lede">No flood reports within 15 km of this address in the records we have, so there is no storm night to replay.</p>
        <p className="note">Shows NWS reports we could place near you, not every flood. No reports here does not mean it never flooded.</p>
        <More>
          <FemaCard fema={data.fema} notice={data.notices.fema} />
          {data.notices.index ? <p className="note">{data.notices.index}</p> : null}
        </More>
      </section>
    </aside>
  );
}
