import type { HardFilterConfig } from "../../config/scoring.ts";
import { normalizeText } from "./normalize.ts";

type PlaceConfig = Pick<HardFilterConfig, "placeAliases" | "countryPlaces" | "workModelWords">;

/**
 * Every spelling a list of preferred places should match: "Bengaluru" also
 * matches "Bangalore", and a country also matches its cities and states.
 */
export function expandPlaces(places: readonly string[], config: PlaceConfig): Set<string> {
  const expanded = new Set<string>();
  const add = (place: string) => {
    const key = normalizeText(place);
    if (!key) return;
    const canonical = Object.entries(config.placeAliases).find(([name, aliases]) => name === key || aliases.includes(key));
    for (const spelling of canonical ? [canonical[0], ...canonical[1]] : [key]) expanded.add(spelling);
  };
  for (const place of places) {
    add(place);
    for (const member of config.countryPlaces[normalizeText(place)] ?? []) add(member);
  }
  return expanded;
}

const containsPhrase = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

/** True when the location names any of the places, as whole words ("pune" does not match "punekar"). */
export function locationMatches(location: string, places: ReadonlySet<string>): boolean {
  const normalized = normalizeText(location);
  return [...places].some((place) => containsPhrase(normalized, place));
}

/** True when the location says the work is remote. */
export function mentionsRemote(location: string): boolean {
  return containsPhrase(normalizeText(location), "remote");
}

/** True when the location names no place at all, only a work model ("Remote", "Hybrid / Flexible"). */
export function namesNoPlace(location: string, config: PlaceConfig): boolean {
  let rest = ` ${normalizeText(location)} `;
  // Longest first, so "work from home" is removed before a shorter word could split it.
  for (const word of [...config.workModelWords].sort((a, b) => b.length - a.length)) rest = rest.replaceAll(` ${word} `, " ");
  return rest.trim() === "";
}
