import { formatPrecomputed } from "@/lib/ui/precomputed-text";

/**
 * "Computed ahead of time": the label on a real AI answer that was made before this visit for a sample address. For the 72-hour brief (which opens
 * with live alerts and the next three days) it also says a fresh one is being asked for, or that it could not be had.
 */
export function PrecomputedNote({ at, refreshing, what = "brief" }: { at: string; refreshing?: "pending" | "failed"; what?: string }) {
  return (
    <p className="precomp" role={refreshing ? "status" : undefined}>
      <span className="tag real">Computed ahead of time</span> {formatPrecomputed(at)}.
      {refreshing === "pending" ? ` Checking for a newer ${what}…` : ""}
      {refreshing === "failed" ? ` A newer ${what} could not be made just now, so this one stays; check the time on it.` : ""}
    </p>
  );
}
