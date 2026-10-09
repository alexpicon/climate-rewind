import type { FemaZone } from "@/lib/types";
import { Pending } from "./LoadSteps";

/** FEMA's flood zone for the address, or an honest line about why there isn't one. */
export function FemaCard({ fema, notice, pending = false }: { fema: FemaZone | null; notice?: string; pending?: boolean }) {
  if (pending) return <Pending label="Checking FEMA’s flood map…" />;
  if (!fema) {
    return (
      <div className="fema none">
        <p>
          <b>FEMA’s flood map:</b> {notice ?? "not available right now."}
        </p>
      </div>
    );
  }
  return (
    <div className="fema">
      <div className="z" aria-hidden="true">
        {fema.zone}
      </div>
      <p>
        <b>FEMA’s flood map</b> puts this address in Zone {fema.zone}
        {fema.subtype ? `: “${fema.subtype.toLowerCase()}.”` : "."}
        {fema.sfha ? " This is a Special Flood Hazard Area." : ""} <span className="tag real">Real</span>
      </p>
      {fema.sfha ? null : (
        <p className="fema-caveat">
          {fema.zone === "X" ? (
            <>
              Zone X means minimal <em>mapped</em> risk, not no risk.
            </>
          ) : (
            <>
              Outside the high-risk area on FEMA’s map is <em>mapped</em> risk only, not no risk.
            </>
          )}
        </p>
      )}
    </div>
  );
}
