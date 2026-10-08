"use client";

import { useState } from "react";
import { useAnnounce } from "@/components/announce";
import { TOP_NIGHTS } from "@/lib/constants";
import type { StormNight } from "@/lib/types";
import type { ReplayResult } from "@/lib/ui/lookup-client";
import { niceDate } from "@/lib/ui/text";

interface Props {
  nights: StormNight[];
  /** The id of the night on screen. */
  current: string;
  onNight: (id: string) => Promise<ReplayResult>;
}

const reportsText = (n: number) => `${n} ${n === 1 ? "report" : "reports"}`;
export const nightLabel = (night: StormNight) => `${niceDate(night.date)}, ${reportsText(night.reports)}`;

/**
 * "Storm nights": a native select plus a button, so arrowing through the list never changes the page by itself.
 * The busiest nights near the address come first (the first one is the default); recent nights follow in their own group.
 */
export function NightPicker({ nights, current, onNight }: Props) {
  const say = useAnnounce();
  const [choice, setChoice] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (nights.length < 2) return null;
  const top = nights.slice(0, TOP_NIGHTS);
  const recent = nights.slice(TOP_NIGHTS);

  const option = (night: StormNight) => (
    <option key={night.id} value={night.id}>
      {nightLabel(night)}
    </option>
  );

  const go = async () => {
    if (busy || choice === current) return;
    const picked = nights.find((n) => n.id === choice);
    setBusy(true);
    setError(null);
    say(`Loading the night of ${picked ? nightLabel(picked) : "your choice"}.`);
    const result = await onNight(choice);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    say(`Showing the night of ${picked ? nightLabel(picked) : "your choice"}. The radar is loading.`);
    // The storm view starts over for the new night; put the keyboard back on the picker.
    setTimeout(() => document.getElementById("night-select")?.focus(), 60);
  };

  return (
    <div className="nights" role="group" aria-labelledby="night-label" aria-describedby="night-hint">
      <label id="night-label" htmlFor="night-select">
        Storm nights
      </label>
      <div className="nights-row">
        <select id="night-select" value={choice} disabled={busy} onChange={(event) => setChoice(event.target.value)}>
          <optgroup label="Busiest nights, most reports first">{top.map(option)}</optgroup>
          {recent.length > 0 ? <optgroup label="Recent nights, 2024 and newer">{recent.map(option)}</optgroup> : null}
        </select>
        <button id="night-go" type="button" className="nights-go" disabled={busy || choice === current} aria-busy={busy} onClick={go}>
          {busy ? "Loading…" : "Show"}
        </button>
      </div>
      <p className="nights-hint" id="night-hint">
        The busiest night is shown first. Counts are flood reports within 15 km of this address.
      </p>
      {error ? (
        <p className="nights-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
