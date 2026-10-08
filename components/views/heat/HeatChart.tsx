import type { HeatSummary } from "@/lib/types";

/**
 * Days per year at a feels-like high of 100 F or more, at this address. Every bar is a real count;
 * the highest and lowest are labelled and the full list is in the text version's table.
 */
export function HeatChart({ byYear, hottestYear, measure = "feels-like" }: { byYear: HeatSummary["byYear"]; hottestYear: string; /** "feels-like", or "heat index" when NASA POWER stood in for Open-Meteo. */ measure?: string }) {
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
        <title id="chart-t">Days per year at 100 degrees or more, {measure}</title>
        <desc id="chart-d">
          {`${years[0]} to ${years[years.length - 1]}. Most: ${byYear[maxYear]} days in ${maxYear}. Fewest: ${byYear[minYear]} days in ${minYear}. The full list is in the text version.`}
        </desc>
        {years.map((year, i) => {
          const h = ((H - top - bottom) * byYear[year]) / max;
          const x = i * slot + (slot - bar) / 2;
          const highlight = year === hottestYear;
          return <rect key={year} x={x} y={H - bottom - h} width={bar} height={Math.max(h, 1)} rx={2} fill={highlight ? "#FFB45A" : "#8C93A8"} />;
        })}
        {[maxYear, minYear].map((year) => {
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
      <figcaption className="hint">Days a year the {measure} high reached 100°F at this address. The orange bar holds the hottest day.</figcaption>
    </figure>
  );
}
