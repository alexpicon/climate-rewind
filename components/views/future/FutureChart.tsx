import { useId } from "react";
import { fmt1, type ChartModel } from "@/lib/climate/chart-model";

const W = 460;
const H = 270;
const LEFT = 34;
const RIGHT = 10;
const TOP = 26;
const BOTTOM = 52;

/**
 * Past decades as bars, then the projected range as a band: one picture, one measure (days a year at or above 90°F). No animation, so there
 * is nothing to pause; the same numbers are in the text version beside it.
 */
export function FutureChart({ model }: { model: ChartModel }) {
  const uid = useId();
  const bands = [model.modelPast ? ({ key: "past", ...model.modelPast, sub: "models" } as const) : null, model.future ? ({ key: "future", ...model.future, sub: "projected" } as const) : null].filter((b): b is NonNullable<typeof b> => b !== null);
  const slots = model.bars.length + bands.length;
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const slotW = plotW / Math.max(slots, 1);
  const barW = Math.min(52, slotW * 0.56);
  const y = (value: number) => TOP + plotH - (value / model.yMax) * plotH;
  const cx = (i: number) => LEFT + slotW * (i + 0.5);

  return (
    <figure className="fx-fig">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${uid}-t ${uid}-d`} className="fx-svg">
        <title id={`${uid}-t`}>{model.title}</title>
        <desc id={`${uid}-d`}>{model.summary}</desc>

        {model.ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} className={t === 0 ? "fx-axis" : "fx-grid"} />
            <text x={LEFT - 6} y={y(t) + 4} textAnchor="end" className="fx-tick">
              {t}
            </text>
          </g>
        ))}

        {model.bars.map((bar, i) => (
          <g key={bar.label}>
            <rect x={cx(i) - barW / 2} y={y(bar.value)} width={barW} height={Math.max(0, y(0) - y(bar.value))} rx={4} className="fx-bar" />
            <text x={cx(i)} y={y(bar.value) - 6} textAnchor="middle" className="fx-val">
              {fmt1(bar.value)}
            </text>
            <text x={cx(i)} y={H - BOTTOM + 18} textAnchor="middle" className="fx-cat">
              {bar.label.replace(" to ", "–")}
            </text>
            {bar.years < 10 ? (
              <text x={cx(i)} y={H - BOTTOM + 33} textAnchor="middle" className="fx-sub">
                {bar.years} years
              </text>
            ) : null}
          </g>
        ))}

        {bands.length > 0 ? <line x1={LEFT + slotW * model.bars.length} x2={LEFT + slotW * model.bars.length} y1={TOP - 8} y2={H - BOTTOM + 4} className="fx-divider" /> : null}
        {bands.map((band, i) => {
          const x = cx(model.bars.length + i);
          const top = y(band.spread.max);
          const bottom = y(band.spread.min);
          return (
            <g key={band.key}>
              <rect x={x - barW / 2} y={top} width={barW} height={Math.max(3, bottom - top)} rx={6} className={`fx-band fx-band-${band.key}`} />
              <line x1={x - barW / 2 - 3} x2={x + barW / 2 + 3} y1={y(band.spread.median)} y2={y(band.spread.median)} className="fx-median" />
              <text x={x} y={top - 7} textAnchor="middle" className={`fx-val fx-val-${band.key}`}>
                {fmt1(band.spread.min)} to {fmt1(band.spread.max)}
              </text>
              <text x={x} y={H - BOTTOM + 18} textAnchor="middle" className="fx-cat">
                {band.label.replace(" to ", "–")}
              </text>
              <text x={x} y={H - BOTTOM + 33} textAnchor="middle" className="fx-sub">
                {band.sub}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="fx-legend">
        <span>
          <i className="fx-sw fx-sw-bar" aria-hidden="true" />
          Weather record: average days a year
        </span>
        {bands.length > 0 ? (
          <span>
            <i className="fx-sw fx-sw-band" aria-hidden="true" />
            Climate models: each band is the range across models, the line is the middle model
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
