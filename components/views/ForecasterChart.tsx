import { FORECAST_SPIKE } from "@/lib/forecast-spike";

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(1)}%`;
const words = (n: number) => `${n > 0 ? "plus " : n < 0 ? "minus " : ""}${Math.abs(n).toFixed(1)} percent`;

const W = 520;
const LEFT = 24;
const RIGHT = 440;
const MIN = -2;
const MAX = 6;
const x = (v: number) => LEFT + ((v - MIN) / (MAX - MIN)) * (RIGHT - LEFT);
const TICKS = [-2, 0, 2, 4, 6];

/**
 * A small, honest chart: each model's Brier skill against the official outlook alone, with its 95% range. A dot and a line, not a
 * bar, so a score near zero is not drawn as a missing bar. Zero means "no better than the official outlook".
 */
export function ForecasterChart() {
  const { bars } = FORECAST_SPIKE;
  const description = bars.map((b) => `${b.label}: ${words(b.bss)}, 95 percent range ${words(b.lo)} to ${words(b.hi)}.`).join(" ");

  return (
    <figure className="fchart">
      <svg viewBox={`0 0 ${W} 196`} role="img" aria-labelledby="fc-t fc-d" focusable="false" style={{ width: "100%", maxWidth: 720, height: "auto" }}>
        <title id="fc-t">Brier skill against the official flood outlook alone, test years 2024 to 2025</title>
        <desc id="fc-d">{`Zero means no better than the official outlook. ${description}`}</desc>

        {/* the zero line stops short of each row's label so it never runs through the words */}
        <line x1={x(0)} x2={x(0)} y1={44} y2={80} stroke="#F5F0E7" strokeWidth={1.5} strokeDasharray="4 4" />
        <line x1={x(0)} x2={x(0)} y1={106} y2={150} stroke="#F5F0E7" strokeWidth={1.5} strokeDasharray="4 4" />
        {TICKS.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={150} y2={155} stroke="#9AA4B8" />
            <text x={x(t)} y={171} textAnchor="middle" fontSize={13} fill="#BAC2D1">
              {t > 0 ? `+${t}` : t}%
            </text>
          </g>
        ))}
        <line x1={LEFT} x2={RIGHT} y1={150} y2={150} stroke="#9AA4B8" />

        {bars.map((b, i) => {
          const y = 56 + i * 62;
          return (
            <g key={b.id}>
              <text x={LEFT} y={y - 22} fontSize={14} fontWeight={600} fill="#F5F0E7" stroke="#10182a" strokeWidth={7} paintOrder="stroke" strokeLinejoin="round">
                {b.label}
              </text>
              <line x1={x(b.lo)} x2={x(b.hi)} y1={y} y2={y} stroke={b.usableLive ? "#FFB45A" : "#BAC2D1"} strokeWidth={3} />
              <line x1={x(b.lo)} x2={x(b.lo)} y1={y - 6} y2={y + 6} stroke={b.usableLive ? "#FFB45A" : "#BAC2D1"} strokeWidth={3} />
              <line x1={x(b.hi)} x2={x(b.hi)} y1={y - 6} y2={y + 6} stroke={b.usableLive ? "#FFB45A" : "#BAC2D1"} strokeWidth={3} />
              {b.usableLive ? <circle cx={x(b.bss)} cy={y} r={8} fill="#FFB45A" stroke="#1C1204" strokeWidth={2} /> : <circle cx={x(b.bss)} cy={y} r={8} fill="#0B111E" stroke="#BAC2D1" strokeWidth={3} />}
              <text x={x(b.hi) + 12} y={y + 5} fontSize={14} fontWeight={700} fill="#F5F0E7">
                {signed(b.bss)}
              </text>
            </g>
          );
        })}
        <text x={x(0)} y={190} fontSize={12.5} fill="#BAC2D1" textAnchor="start">
          0 = no better than the official outlook
        </text>
      </svg>
      <figcaption className="fine">
        Brier skill against the official outlook alone (higher is better), with its 95% range. Hollow dot: could not run live, because tomorrow’s rain is not known today. Filled dot: uses only what is known in advance.
      </figcaption>
      <details className="textver">
        <summary>Text version of this chart</summary>
        <table className="rtable">
          <caption>Brier skill against the official outlook alone, tested on {FORECAST_SPIKE.tested}</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Skill</th>
              <th scope="col">95% range</th>
              <th scope="col">Could run live</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.id}>
                <th scope="row">{b.label}</th>
                <td>{signed(b.bss)}</td>
                <td>
                  {signed(b.lo)} to {signed(b.hi)}
                </td>
                <td>{b.usableLive ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
