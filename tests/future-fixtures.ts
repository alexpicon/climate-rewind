import type { ArchiveReply, ClimateReply } from "@/lib/climate/projection";

/** 365-day years (no Feb 29): enough for the counting code, and exact to reason about. */
function dates(from: number, to: number): string[] {
  const out: string[] = [];
  for (let y = from; y <= to; y += 1) {
    for (let i = 0; i < 365; i += 1) {
      const d = new Date(Date.UTC(2023, 0, 1 + i));
      out.push(`${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
    }
  }
  return out;
}

/** Hot (feels-like 95 F, air 91 F) days rise by one a year from 2000; rain days stay at 3 a year. */
export function archiveReply(from = 2000, to = 2025): ArchiveReply {
  const time = dates(from, to);
  const dayOfYear = (i: number) => i % 365;
  const yearOf = (i: number) => from + Math.floor(i / 365);
  return {
    daily: {
      time,
      apparent_temperature_max: time.map((_, i) => (dayOfYear(i) < yearOf(i) - 2000 ? 95 : 70)),
      temperature_2m_max: time.map((_, i) => (dayOfYear(i) < (yearOf(i) - 2000) / 2 ? 91 : 65)),
      precipitation_sum: time.map((_, i) => (dayOfYear(i) % 120 === 0 ? 1.5 : 0.1)),
    },
  };
}

export function climateReply(period: [number, number], hot: Record<string, number>): ClimateReply {
  const time = dates(period[0], period[1]);
  const daily: Record<string, unknown> = { time };
  for (const [model, days] of Object.entries(hot)) daily[`temperature_2m_max_${model}`] = time.map((_, i) => (i % 365 < days ? 95 : 70));
  return { daily };
}

export const MODELS_HOT_BASE = { CMCC_CM2_VHR4: 8, FGOALS_f3_H: 12, HiRAM_SIT_HR: 10, MRI_AGCM3_2_S: 6, EC_Earth3P_HR: 14, MPI_ESM1_2_XR: 9, NICAM16_8S: 11 };
export const MODELS_HOT_FUTURE = { CMCC_CM2_VHR4: 20, FGOALS_f3_H: 30, HiRAM_SIT_HR: 24, MRI_AGCM3_2_S: 16, EC_Earth3P_HR: 40, MPI_ESM1_2_XR: 22, NICAM16_8S: 28 };
