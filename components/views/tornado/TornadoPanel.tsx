"use client";

import { More, TextVersion } from "@/components/panel/Disclosure";
import { excerpt, niceDate } from "@/lib/ui/text";
import { DAMAGE_LABEL, cardTornado, casualtyParts, damageWhere, efColor, pinsOf, type TornadoTimeline } from "@/lib/ui/tornado-model";
import { segmentDistance } from "@/lib/geo";
import type { LookupPayload, NearbyTornado } from "@/lib/types";

interface Props {
  data: LookupPayload;
  timeline: TornadoTimeline;
  ms: number;
  closest: NearbyTornado;
}

export function TornadoPanel({ data, timeline, ms, closest }: Props) {
  const total = timeline.items.length;
  const drawn = timeline.items.filter((i) => ms - i.startMs > i.drawMs * 0.5).length;
  const finale = ms >= timeline.tracksMs + timeline.finaleMs * 0.55;
  const shown = cardTornado(timeline, ms);
  const note = shown ? excerpt(shown.narrative, 360) : null;
  const bigStyle = shown ? { fontSize: 72 } : undefined;

  const damage = data.damage ?? [];
  const shownPins = shown ? pinsOf(damage, shown.id) : [];
  // The survey covers the whole tornado, which can run on past the end of the county line drawn here.
  const pastTheLine = !!shown && shownPins.some((pin) => segmentDistance([pin.lat, pin.lon], shown.begin, shown.end).km > 3);

  const sorted = [...timeline.items].map((i) => i.tornado).sort((a, b) => a.minDistanceKm - b.minDistanceKm);

  return (
    <aside id="panel" className="glass" aria-label="Story" tabIndex={-1}>
      <section id="v-tornado" className="view on" aria-labelledby="tor-h">
        <h1 className="sr" id="tor-h">
          Tornado paths within 10 kilometres of {data.address.matched}
        </h1>
        <p className="eyebrow">Real tornadoes in our records · within 10 km</p>
        <div className="big" style={bigStyle} aria-hidden="true">
          <span>{closest.minDistanceKm.toFixed(2)}</span>
          <small>km</small>
        </div>
        <p className="lede">
          <span className="sr">{closest.minDistanceKm.toFixed(2)} kilometres. </span>
          {finale ? (
            <>
              closest of the <em>{total} tornadoes</em> that passed within 10 km: an <em>{closest.ef} on {niceDate(closest.start)}</em>.
            </>
          ) : (
            <>
              closest tornado, of {total} within 10 km. Each line is <em>one real tornado</em>, from touchdown to lift-off.
            </>
          )}
        </p>

        {shown && note ? (
          <article className="tcard swap" key={shown.id} style={{ "--c": efColor(shown.ef) } as React.CSSProperties} aria-label="What the National Weather Service wrote about this tornado">
            <div className="tc-head">
              <span className="tc-ef">{shown.ef}</span>
              <span className="tc-date">{niceDate(shown.start)}</span>
              <span className="tc-km">{shown.minDistanceKm.toFixed(shown.minDistanceKm < 2 ? 2 : 1)} km from you</span>
            </div>
            <p className="tc-h">What the NWS survey found</p>
            <blockquote className="tc-q">
              “{note.text}
              {note.truncated ? "…" : ""}”
            </blockquote>
            <p className="tc-src">
              NWS Storm Events{casualtyParts(shown).length ? ` · ${casualtyParts(shown).join(", ")} in this county` : ""}
              <a className="tc-id" href={`https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=${shown.id.replace(/^SE-/, "")}`} target="_blank" rel="noopener noreferrer">
                Event {shown.id.replace(/^SE-/, "")}
              </a>
            </p>
            {shownPins.length ? (
              <details className="dmg-det">
                <summary>
                  {shownPins.length} damage {shownPins.length === 1 ? "place" : "places"} on the map <span className="dmg-ai">{DAMAGE_LABEL}</span>
                </summary>
                {pastTheLine ? <p className="fine">Some of these places are beyond the end of the line drawn here: this tornado kept going into the next county, and its survey covers the whole path.</p> : null}
                <ul className="dmg-list">
                  {shownPins.map((pin) => (
                    <li key={`${pin.place}-${pin.lat}-${pin.lon}`} style={{ "--c": efColor(pin.ef ?? shown.ef) } as React.CSSProperties}>
                      <b>
                        {pin.place}
                        {pin.ef ? ` (${pin.ef})` : ""}
                      </b>
                      <q>{pin.phrase}</q>
                      <small>{damageWhere(pin.matchType)}</small>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </article>
        ) : null}

        <More>
          <div className="stats">
            <div className="stat">
              <b>{drawn}</b>
              <span>tornadoes drawn, of {total}</span>
            </div>
            <div className="stat">
              <b>{closest.start.slice(0, 4)}</b>
              <span>year of the closest</span>
            </div>
          </div>
          <p className="note">
            Lines join the NWS start and end points; real paths wiggle. The band widens to the NWS-recorded maximum width. Its shape between the two ends is a drawing choice.
          </p>
          {data.notices.index ? <p className="note">{data.notices.index}</p> : null}
          <TextVersion>
            <p>
              {total} tornado track{total === 1 ? "" : "s"} in the records we have passed within 10 km of this address. The closest, {closest.minDistanceKm.toFixed(2)} km away, was an {closest.ef} on {niceDate(closest.start)}
              {casualtyParts(closest).length ? `, with ${casualtyParts(closest).join(" and ")} recorded for this county’s part of the track` : ""}. Each line joins the NWS start and end points of one tornado. After each track the card quotes the National Weather Service’s own damage narrative from Storm Events, word for word.
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Distance</th>
                  <th scope="col">NWS narrative (excerpt)</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const e = excerpt(t.narrative, 260);
                  return (
                    <tr key={t.id}>
                      <th scope="row">{niceDate(t.start)}</th>
                      <td>{t.ef}</td>
                      <td>{t.minDistanceKm.toFixed(1)} km</td>
                      <td>
                        {e.text}
                        {e.truncated ? "…" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {damage.length ? (
              <>
                <p>
                  {damage.length} damage {damage.length === 1 ? "place" : "places"} on the map were {DAMAGE_LABEL.replace("AI-mapped", "mapped by AI")}. Each is a place the survey names, with the survey’s own words. A place can be a street, a landmark or an area, and the AI’s pin is only as exact as the match: a street pin is where that street meets the tornado’s track.
                </p>
                <table>
                  <caption>Damage places mapped by AI, by tornado</caption>
                  <thead>
                    <tr>
                      <th scope="col">Tornado</th>
                      <th scope="col">Place</th>
                      <th scope="col">NWS survey words</th>
                      <th scope="col">How it was pinned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {damage.map((pin) => {
                      const t = timeline.items.find((i) => i.tornado.id === pin.tornadoId)?.tornado;
                      return (
                        <tr key={`${pin.tornadoId}-${pin.place}-${pin.lat}-${pin.lon}`}>
                          <th scope="row">{t ? `${t.ef}, ${niceDate(t.start)}` : pin.tornadoId}</th>
                          <td>
                            {pin.place}
                            {pin.ef ? ` (${pin.ef})` : ""}
                          </td>
                          <td>“{pin.phrase}”</td>
                          <td>{damageWhere(pin.matchType)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : null}
          </TextVersion>
        </More>
      </section>
    </aside>
  );
}
