import { describe, expect, it } from "vitest";
import { findPlace } from "@/lib/places";

const one = (q: string) => {
  const found = findPlace(q);
  return found?.kind === "one" ? `${found.place.name}, ${found.place.state}` : found?.kind ?? null;
};

describe("findPlace (the search box's city fallback)", () => {
  it("matches a city with or without its state, in any common spelling", () => {
    for (const q of ["Fort Myers, FL", "fort myers", "Fort Myers, Florida", "Fort Myers FL", "Ft. Myers", "Fort Myers, FL 33901"]) expect(one(q)).toBe("Fort Myers, FL");
    expect(one("Saint Louis, MO")).toBe("St. Louis, MO");
    expect(one("Portland, ME")).toBe("Portland, ME");
  });

  it("opens the clear leader, and asks when several places share a name", () => {
    expect(one("Nashville")).toBe("Nashville, TN");
    const portland = findPlace("Portland");
    expect(portland?.kind).toBe("many");
    if (portland?.kind === "many") expect(portland.choices.slice(0, 2)).toEqual(["Portland, OR", "Portland, ME"]);
    expect(findPlace("Springfield")?.kind).toBe("many");
  });

  it("does not turn a state name, a street address or nonsense into a small town", () => {
    for (const q of ["Fort Myers, ZZ", "100 Main St, Fort Myers, FL", "asdfgh"]) expect(findPlace(q)).toBeNull();
    for (const q of ["Texas", "Indiana", "Nevada"]) expect(findPlace(q)).toMatchObject({ kind: "state", choices: [] });
    expect(findPlace("Texas")).toMatchObject({ name: "Texas", example: "Houston, TX" });
    expect(one("New York")).toBe("New York, NY");
    expect(findPlace("Washington")).toMatchObject({ kind: "state", name: "Washington", choices: ["Washington, DC"], example: "Seattle, WA" });
    expect(one("Washington, DC")).toBe("Washington, DC");
  });
});
