import { ClimateRewindApp } from "@/components/ClimateRewindApp";
import { APP_NAME } from "@/lib/brand";
import { loadAiJobs } from "@/lib/ai-jobs-server";
import { detectiveHasRun } from "@/lib/detective-status";
import { parseTab } from "@/lib/ui/tabs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const address = first(params.address)?.trim() || null;
  // True only once real detective rows exist in the data; the landing and How wording follow it.
  const detectiveRan = await detectiveHasRun();
  // The AI jobs with the number each has earned (or "pending"), read from the data files.
  const aiJobs = await loadAiJobs(detectiveRan);

  return (
    <>
      <ClimateRewindApp initialAddress={address} initialTab={parseTab(first(params.tab))} initialNight={first(params.night)?.trim() || null} initialView3d={first(params.view) === "3d"} detectiveRan={detectiveRan} aiJobs={aiJobs} />
      <noscript>
        <p className="noscript">{APP_NAME} needs JavaScript to look up an address and draw the map. The data comes from the National Weather Service, FEMA, the US Census and Open-Meteo.</p>
      </noscript>
    </>
  );
}
