"use client";

import { Legend } from "@/components/panel/Legend";
import { WIND_STOPS } from "@/lib/ui/wind-colors";
import { KIND_CSS } from "./event-overlay";

const rgb = (c: readonly number[]) => `rgb(${c.join(",")})`;

export function EventLegend({ hurricane }: { hurricane: boolean }) {
  return (
    <Legend>
      <b>Arrows: where the wind blew, as long as it was strong</b>
      {WIND_STOPS.filter((s) => s.mph >= 15).map((s) => (
        <div className="lg-row" key={s.mph}>
          <i style={{ height: 4, background: rgb(s.rgb) }} />
          <span>{s.label}</span>
        </div>
      ))}
      {hurricane ? (
        <>
          <div className="lg-sep" />
          <b>The hurricane</b>
          <div className="lg-row"><i style={{ height: 10, background: "rgba(242,224,90,.35)", border: "1.5px solid rgb(242,224,90)" }} /><span>Reach of tropical-storm-force winds (39 mph)</span></div>
          <div className="lg-row"><i style={{ height: 10, background: "rgba(255,159,64,.35)", border: "1.5px solid rgb(255,159,64)" }} /><span>Reach of 58 mph winds</span></div>
          <div className="lg-row"><i style={{ height: 10, background: "rgba(255,77,77,.4)", border: "1.5px solid rgb(255,77,77)" }} /><span>Reach of hurricane-force winds (74 mph)</span></div>
        </>
      ) : null}
      <div className="lg-sep" />
      <b>Storm reports, as they were filed</b>
      <div className="lg-row"><i className="ev-dot" style={{ background: KIND_CSS.gust }} /><span>Wind gust (bigger is stronger)</span></div>
      <div className="lg-row"><i className="ev-dot" style={{ background: KIND_CSS.wind }} /><span>Wind damage or other wind report</span></div>
      <div className="lg-row"><i className="ev-dot" style={{ background: KIND_CSS.tornado }} /><span>Tornado</span></div>
      <div className="lg-row"><i className="ev-dot" style={{ background: KIND_CSS.flood }} /><span>Flood or heavy rain</span></div>
      <div className="lg-row"><i className="ev-dot" style={{ background: KIND_CSS.surge }} /><span>Storm surge or coastal flood</span></div>
    </Legend>
  );
}
