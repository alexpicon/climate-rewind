import { NavLink } from "@/components/nav-context";
import { Pending } from "./LoadSteps";
import { QUIET_BELOW_REPORTS } from "@/lib/constants";
import type { LookupPayload } from "@/lib/types";
import { SAMPLE_ADDRESSES } from "@/lib/ui/tabs";
import { extremeItems, nearestFloodLine, quietLine } from "@/lib/ui/story-model";
import { readableCase } from "@/lib/ui/text";

/** True when the address has few flood reports of its own and the page should say more than "nothing". */
export function isQuiet(data: LookupPayload): boolean {
  return data.coverage === "indexed" && data.floods.reports.length < QUIET_BELOW_REPORTS;
}

const HARD_HIT = SAMPLE_ADDRESSES[0];

/**
 * A quiet address is never an empty one: how far the nearest flood report was (with its words), where the address sits among the
 * places we sampled, and two places to go next. The honest line stays: no report is not the same as no flood.
 */
export function QuietCard({ data, showStoryLink = true }: { data: LookupPayload; showStoryLink?: boolean }) {
  const near = data.nearestFlood;
  const nearLine = nearestFloodLine(near);
  const place = quietLine(data.quiet);
  const hasStory = Boolean(data.areaEvents && data.areaEvents.total > 0);
  const count = data.floods.reports.length;
  return (
    <section className="quietcard" aria-labelledby="quiet-h">
      <h2 id="quiet-h" className="sec-t">
        {count === 0 ? "Quiet on your street" : "Few flood reports on your street"}
      </h2>
      {nearLine ? (
        <>
          <p className="quiet-main">{nearLine}</p>
          {near ? (
            <blockquote className="src-quote">
              “{readableCase(near.quote)}”
              <footer className="quiet-cite">NWS report{near.city ? `, ${readableCase(near.city)}` : ""}, {near.start.slice(0, 4)}</footer>
            </blockquote>
          ) : null}
        </>
      ) : count === 0 ? (
        <p className="quiet-main">No flood report within 5 km of this address, and none we could place within 50 km.</p>
      ) : (
        <p className="quiet-main">
          {count} flood {count === 1 ? "report" : "reports"} within 5 km.
        </p>
      )}
      {place ? <p className="quiet-place">{place}</p> : null}
      <p className="note quiet-note">A report exists only if someone filed one. Quiet in our records does not mean nothing happened here.</p>
      <ul className="nextsteps">
        {showStoryLink && hasStory ? (
          <li>
            <NavLink className="nextstep" address={data.address.input} tab="story">
              <b>See the most dramatic event in your area</b>
              <span>What the National Weather Service recorded nearby, in its own words</span>
            </NavLink>
          </li>
        ) : null}
        <li>
          <NavLink className="nextstep" address={data.address.input} to={HARD_HIT.address} tab="storm">
            <b>See a hard-hit street</b>
            <span>Downtown Nashville, replayed minute by minute</span>
          </NavLink>
        </li>
      </ul>
    </section>
  );
}

/** The wettest, windiest and hottest days on record at the address. A modeled history, said so. */
export function ExtremesCard({ data }: { data: LookupPayload }) {
  if (data.pending?.includes("heat")) return <Pending label="Reading the wettest, windiest and hottest days since 2000…" />;
  const items = extremeItems(data.extremes);
  if (items.length === 0) {
    return data.notices.extremes ? <p className="note">{data.notices.extremes}</p> : null;
  }
  const power = data.extremes?.source === "nasa-power";
  return (
    <section className="extremes" aria-labelledby="extremes-h">
      <h2 id="extremes-h" className="sec-t">
        Records at your address
      </h2>
      <dl className="extremes-list">
        {items.map((item) => (
          <div key={item.key}>
            <dt>{item.label}</dt>
            <dd>
              <b>{item.value}</b>
              <span>{item.date}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="note quiet-note">
        Modeled weather history since 2000 ({power ? "NASA POWER, MERRA-2" : "Open-Meteo, ERA5"}) for a grid cell around the address, not a gauge on your street.
      </p>
    </section>
  );
}
