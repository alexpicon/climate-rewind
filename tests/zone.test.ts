import { describe, expect, it } from "vitest";
import { zoneAbbreviation } from "@/lib/ui/zone";

const at = (iso: string) => Date.parse(iso);

describe("zoneAbbreviation", () => {
  it("names Central daylight and standard time by the report's own offset (Nashville, TN)", () => {
    expect(zoneAbbreviation(at("2021-03-28T03:55:00Z"), -300, "TN")).toBe("CDT");
    expect(zoneAbbreviation(at("2021-01-15T12:00:00Z"), -360, "TN")).toBe("CST");
  });

  it("names Eastern time (Asheville, NC and Atlanta, GA)", () => {
    expect(zoneAbbreviation(at("2024-09-26T21:37:00Z"), -240, "NC")).toBe("EDT");
    expect(zoneAbbreviation(at("2016-02-03T14:43:00Z"), -300, "NC")).toBe("EST");
    expect(zoneAbbreviation(at("2024-09-26T23:23:00Z"), -240, "GA")).toBe("EDT");
  });

  it("uses Texas and Missouri Central time, and Mountain time for the Texas panhandle west", () => {
    expect(zoneAbbreviation(at("2016-06-02T08:25:00Z"), -300, "TX")).toBe("CDT");
    expect(zoneAbbreviation(at("2025-07-17T07:40:00Z"), -300, "MO")).toBe("CDT");
    expect(zoneAbbreviation(at("2025-07-17T07:40:00Z"), -360, "TX")).toBe("MDT");
  });

  it("keeps Arizona on MST all year, and tells it apart from Pacific daylight time at the same offset", () => {
    expect(zoneAbbreviation(at("2025-07-17T20:00:00Z"), -420, "AZ")).toBe("MST");
    expect(zoneAbbreviation(at("2025-01-17T20:00:00Z"), -420, "AZ")).toBe("MST");
    expect(zoneAbbreviation(at("2025-07-17T20:00:00Z"), -420, "CA")).toBe("PDT");
  });

  it("works with no state, and falls back to a plain UTC offset when no US zone has that offset", () => {
    expect(zoneAbbreviation(at("2021-03-28T03:55:00Z"), -300)).toBe("CDT");
    expect(zoneAbbreviation(at("2021-03-28T03:55:00Z"), 330)).toBe("UTC+5.5");
    expect(zoneAbbreviation(at("2021-03-28T03:55:00Z"), -120, "TN")).toBe("UTC-2");
  });

  it("never prints a bare 'UTC-5' for a Nashville storm", () => {
    expect(zoneAbbreviation(at("2021-03-28T03:55:00Z"), -300, "TN")).not.toMatch(/^UTC/);
  });
});
