/**
 * Which AI-mapped damage places belong to which tornado on the map. Pure (no files).
 *
 * The damage mapper pins a place on whichever county segment of a tornado is nearest to it, but the NWS survey text is the
 * whole tornado's: Storm Events files one row per county, each carrying the same narrative. The tornado tab shows the
 * segments within 10 km of the address, so a pin on a neighbouring segment (the Wilson County half of the Mar 3, 2020
 * Nashville EF3) would be dropped if we matched on the segment id alone. We join the segments of one tornado first.
 */
import { haversineKm } from "./geo";
import type { DamagePin, NearbyTornado, TornadoRow } from "./types";

/** A county segment continues the previous one when it starts where that one ended, within this distance. */
const JOIN_KM = 1;
/** ... and within this long after it started (the longest real tornado ran about 3.5 h). */
const JOIN_MS = 4 * 3_600_000;

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The opening of the survey, enough to tell two tornadoes apart. Storm Events copies of one narrative differ by stray punctuation, so punctuation is ignored. */
const narrativeKey = (t: TornadoRow) => squash(t.narrative).slice(0, 200);

/** Groups the county segments that are one tornado: it starts where the other ended, soon after, with the same survey text. Returns segment id -> every id in its group (including itself). */
export function tornadoSegments(tornadoes: readonly TornadoRow[]): Map<string, string[]> {
  const parent = new Map<string, string>(tornadoes.map((t) => [t.id, t.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const byKey = new Map<string, TornadoRow[]>();
  for (const t of tornadoes) {
    const key = narrativeKey(t);
    if (key.length < 40) continue; // too short to prove two rows share a survey
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  for (const same of byKey.values()) {
    for (const a of same) {
      for (const b of same) {
        if (a === b) continue;
        const gap = Date.parse(b.start) - Date.parse(a.start);
        if (gap > 0 && gap <= JOIN_MS && haversineKm(a.end, b.begin) <= JOIN_KM) parent.set(find(b.id), find(a.id));
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const t of tornadoes) groups.set(find(t.id), [...(groups.get(find(t.id)) ?? []), t.id]);
  const out = new Map<string, string[]>();
  for (const ids of groups.values()) for (const id of ids) out.set(id, ids);
  return out;
}

/**
 * The damage pins to draw for the tornadoes near an address. A pin on any segment of a tornado goes with that tornado's
 * segment nearest the address (the one on the map), once. Verbatim fields are passed through untouched.
 */
export function damagePinsFor(rows: readonly DamagePin[], all: readonly TornadoRow[], nearby: readonly NearbyTornado[]): DamagePin[] {
  if (rows.length === 0 || nearby.length === 0) return [];
  const segments = tornadoSegments(all);
  // For each group of segments, the nearby segment that carries its pins.
  const carrier = new Map<string, string>();
  const ordered = [...nearby].sort((a, b) => a.minDistanceKm - b.minDistanceKm);
  for (const t of ordered) {
    const ids = segments.get(t.id) ?? [t.id];
    const owner = carrier.get(ids[0]) ?? t.id;
    for (const id of ids) carrier.set(id, owner);
  }
  const pins: DamagePin[] = [];
  for (const row of rows) {
    const owner = carrier.get(row.tornadoId);
    if (owner) pins.push({ ...row, tornadoId: owner });
  }
  return pins;
}
