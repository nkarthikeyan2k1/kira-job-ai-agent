import { describe, expect, it } from "vitest";
import { HARD_FILTER_CONFIG as config } from "../../config/scoring.ts";
import { expandPlaces, locationMatches, mentionsRemote, namesNoPlace } from "./places.ts";

describe("expandPlaces", () => {
  it("adds every spelling of a city", () => {
    expect([...expandPlaces(["Bangalore"], config)].sort()).toEqual(["bangalore", "bengaluru"]);
  });

  it("makes a country cover its cities and states", () => {
    const india = expandPlaces(["India"], config);
    for (const place of ["india", "pune", "bangalore", "gurgaon", "tamil nadu"]) expect(india.has(place), place).toBe(true);
  });

  it("keeps a place it has no aliases for", () => {
    expect([...expandPlaces(["Mysuru"], config)]).toEqual(["mysuru"]);
  });
});

describe("locationMatches", () => {
  const places = expandPlaces(["Bengaluru", "Pune"], config);

  it("matches any spelling, case and punctuation aside", () => {
    for (const location of ["Bengaluru", "bangalore", "Bangalore, Karnataka", "Pune, Maharashtra, India", "Noida, Uttar Pradesh; Bangalore, Karnataka"]) {
      expect(locationMatches(location, places), location).toBe(true);
    }
  });

  it("matches whole words only", () => {
    expect(locationMatches("Punekar Nagar", places)).toBe(false);
    expect(locationMatches("Noida, Uttar Pradesh", places)).toBe(false);
  });
});

describe("remote wording", () => {
  it("spots a remote location", () => {
    expect(mentionsRemote("Remote (India)")).toBe(true);
    expect(mentionsRemote("Bengaluru")).toBe(false);
  });

  it("tells a bare work model from a location that names a place", () => {
    for (const location of ["Remote", "Hybrid / Flexible", "Work from home"]) expect(namesNoPlace(location, config), location).toBe(true);
    for (const location of ["Remote (India)", "Remote - US", "Hybrid · Bengaluru"]) expect(namesNoPlace(location, config), location).toBe(false);
  });
});
