/** Fetches a JSON file and hands it to `use` if it arrives; returns the abort, for an effect's cleanup. A failure leaves `use` uncalled. */
export function fetchJson<T>(url: string, use: (value: T) => void): () => void {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal })
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .then((value) => {
      if (value) use(value);
    })
    .catch(() => undefined);
  return () => controller.abort();
}
