import type { HeatSummary } from "@/lib/types";

/**
 * Days per year at a high of 100 F or more, at this address. Every bar is a real count;
 * the highest and lowest are labelled and the full list is in the text version's table.
 */
export function HeatChart({
  byYear,
  hottestYear,
  measure = "feels-like high",
  rule = null,
}: {
  byYear: HeatSummary["byYear"];
  hottestYear: string;
  /** What a day's number is: "high", "feels-like high", or "heat index high" when NASA POWER stood in for Open-Meteo. */
  measure?: string;
  /** What "high" means, when it is the higher of two measures (lib/ui/data-source.ts heatHighWords). */
  rule?: string | null;
}) {
  const years = Object.keys(byYear).sort();
  const max = Math.max(1, ...years.map((y) => byYear[y]));
  const maxYear = years.reduce((a, b) => (byYear[b] > byYear[a] ? b : a), years[0]);
  const minYear = years.reduce((a, b) => (byYear[b] < byYear[a] ? b : a), years[0]);

  const W = 340;
  const H = 150;
  const top = 20;
  const bottom = 22;
  const slot = W / years.length;
  const bar = Math.max(3, slot - 3);

  return (
    <figure className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-labelledby="chart-t chart-d">
        <title id="chart-t">{`Days per year with a ${measure} of 100 degrees or more`}</title>
        <desc id="chart-d">
          {byYear[maxYear] === byYear[minYear]
            ? `${years[0]} to ${years[years.length - 1]}: ${byYear[maxYear]} days every year. The full list is in the text version.`
            : `${years[0]} to ${years[years.length - 1]}. Most: ${byYear[maxYear]} days in ${maxYear}. Fewest: ${byYear[minYear]} days in ${minYear}. The full list is in the text version.`}
        </desc>
        {years.map((year, i) => {
          const h = ((H - top - bottom) * byYear[year]) / max;
          const x = i * slot + (slot - bar) / 2;
          const highlight = year === hottestYear;
          return <rect key={year} x={x} y={H - bottom - h} width={bar} height={Math.max(h, 1)} rx={2} fill={highlight ? "#FFB45A" : "#8C93A8"} />;
        })}
        {/* The most and the fewest are the same year when every year has the same count (often none): label it once. */}
        {[...new Set([maxYear, minYear])].map((year) => {
          const i = years.indexOf(year);
          const x = i * slot + slot / 2;
          const anchor = x < 40 ? "start" : x > W - 40 ? "end" : "middle";
          const h = ((H - top - bottom) * byYear[year]) / max;
          return (
            <text key={year} x={x} y={H - bottom - h - 5} textAnchor={anchor} fontSize="12" fontWeight="700" fill="#F5F0E7">
              {byYear[year]}
            </text>
          );
        })}
        {[years[0], years[Math.floor(years.length / 2)], years[years.length - 1]].map((year) => {
          const i = years.indexOf(year);
          const x = i * slot + slot / 2;
          return (
            <text key={year} x={x} y={H - 6} textAnchor={i === 0 ? "start" : i === years.length - 1 ? "end" : "middle"} fontSize="12" fill="#BAC2D1">
              {year}
            </text>
          );
        })}
      </svg>
      <figcaption className="hint">
        Days a year the {measure} reached 100°F at this address{rule ? `: ${rule}` : ""}. The orange bar holds the hottest day.
      </figcaption>
    </figure>
  );
}
