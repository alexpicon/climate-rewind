/** "Made Oct 8 at 3:12 PM UTC": when an answer made ahead of time was written. UTC, so it reads the same wherever the server and the visitor are. */
export function formatPrecomputed(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "For this sample address";
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return `Real answer for this sample address, made ${day}, ${time} UTC`;
}
