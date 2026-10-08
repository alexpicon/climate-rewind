import { Legend } from "@/components/panel/Legend";

const RAMP = "linear-gradient(90deg,#04e9e7,#019ff4,#0300f4,#02fd02,#01c501,#008e00,#fdf802,#e5bc00,#fd9500,#fd0000,#d40000,#bc0000,#f800fd,#9854c6)";

export function StormLegend({ stage, canCorrect }: { stage: 1 | 2; canCorrect: boolean }) {
  if (stage === 2 && !canCorrect) {
    return (
      <Legend>
        <b>Reports as the NWS filed them</b>
        <div className="lg-row"><i className="sw-dot" /><span><b className="lgb">Solid dot</b>: filed at a point, about 1 km</span></div>
        <div className="lg-row"><i className="sw-hollow" /><span><b className="lgb">Hollow ring</b>: filed at a city point only</span></div>
        <div className="lg-row lg-note"><span>Nothing has been moved: the AI detective has not run for this area yet.</span></div>
      </Legend>
    );
  }
  if (stage === 2) {
    return (
      <Legend>
        <b>Correcting the map</b>
        <div className="lg-row"><span><b className="lgb">Hollow pin</b>: where the NWS filed it</span></div>
        <div className="lg-row"><span><b className="lgb">Solid pin</b>: where the report’s own text says</span></div>
        <div className="lg-row"><span><b className="lgb">Dashed ?</b>: too vague, not placed</span></div>
        <div className="lg-row lg-note"><span>Check mark: confirmed by a real street address</span></div>
        <div className="lg-row lg-note"><span><span className="tag sample">Sample</span> placements are illustrative until the detective runs</span></div>
      </Legend>
    );
  }
  return (
    <Legend>
      <b>
        How hard it is raining <span className="lgs">real NWS radar</span>
      </b>
      <div className="ramp" style={{ background: RAMP }} />
      <div className="rampl3">
        <span>Light rain</span>
        <span>Heavy</span>
        <span>Extreme</span>
      </div>
      <div className="lg-sep" />
      <div className="lg-row">
        <i className="sw-dot" />
        <span><b className="lgb">Flood report</b>, shown at the minute it was filed. It stays put.</span>
      </div>
      {canCorrect ? (
        <div className="lg-row">
          <i className="sw-hollow" />
          <span>Reports the NWS pinned to one city point</span>
        </div>
      ) : null}
      <div className="lg-row lg-note">
        <span>Colors = rain at that minute. Pins = flood reports people filed. Floods follow the heavy bands.</span>
      </div>
    </Legend>
  );
}
