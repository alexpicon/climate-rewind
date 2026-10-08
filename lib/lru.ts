/**
 * A small least-recently-used cache with an expiry, for outside data that is past weather (it never changes, so a few hours
 * of reuse is safe). Reading an entry makes it the newest; a full cache drops the entry untouched the longest.
 */
export class LruCache<V> {
  private readonly entries = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string, nowMs: number): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (nowMs - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert so this key is now the most recently used (Map keeps insertion order).
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, nowMs: number): void {
    this.entries.delete(key);
    while (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { at: nowMs, value });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Snaps a coordinate to a grid (0.05 degrees is about 5 km). The answer is a plain "47.60", the same string for every point in the cell. */
export function snapToGrid(value: number, step = 0.05): number {
  return Number((Math.round(value / step) * step).toFixed(2));
}

/** The cache key (and the request point) for a place: its 0.05 degree cell. */
export function gridKey(lat: number, lon: number): { lat: number; lon: number; key: string } {
  const la = snapToGrid(lat);
  const lo = snapToGrid(lon);
  return { lat: la, lon: lo, key: `${la.toFixed(2)},${lo.toFixed(2)}` };
}
