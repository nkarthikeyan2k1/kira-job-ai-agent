import type { ResumeSection } from "@kira/shared";

// Splits resume text ("# Heading" lines, "- " bullets) into the chunks stored
// in resume_chunks. A chunk is the unit later compared with job requirements,
// so each one should be about one thing: the summary, the skills list, one
// job, one project. A whole resume as one chunk would match everything a bit
// and nothing well.

export interface ResumeChunkDraft {
  section: ResumeSection;
  ordinal: number; // position within its section
  content: string;
}

const HEADING_KINDS: readonly (readonly [ResumeSection, RegExp])[] = [
  ["summary", /summary|profile|objective|about/],
  ["skills", /skill|technolog|tech stack|tools/],
  ["experience", /experience|employment|work history/],
  ["projects", /project/],
  ["education", /education|academic/],
  ["certifications", /certif|licen[cs]e/],
];

export function classifyHeading(heading: string): ResumeSection {
  const lower = heading.toLowerCase();
  return HEADING_KINDS.find(([, pattern]) => pattern.test(lower))?.[0] ?? "other";
}

// One entry = its header lines (employer, title, dates) plus the bullets under
// them. A new entry starts where a non-bullet line follows a bullet.
function splitEntries(lines: readonly string[]): string[] {
  const entries: string[][] = [];
  let previousWasBullet = false;
  for (const line of lines) {
    const isBullet = line.startsWith("- ");
    if (entries.length === 0 || (!isBullet && previousWasBullet)) entries.push([]);
    entries.at(-1)!.push(line);
    previousWasBullet = isBullet;
  }
  return entries.map((entry) => entry.join("\n"));
}

export function splitResume(text: string): ResumeChunkDraft[] {
  const sections: { heading: string | null; lines: string[] }[] = [{ heading: null, lines: [] }];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("# ")) sections.push({ heading: line.slice(2).trim(), lines: [] });
    else if (line) sections.at(-1)!.lines.push(line);
  }

  const chunks: ResumeChunkDraft[] = [];
  const nextOrdinal = new Map<ResumeSection, number>();
  const add = (section: ResumeSection, content: string) => {
    const ordinal = nextOrdinal.get(section) ?? 0;
    nextOrdinal.set(section, ordinal + 1);
    chunks.push({ section, ordinal, content });
  };

  for (const { heading, lines } of sections) {
    if (lines.length === 0) continue;
    const section = heading === null ? "other" : classifyHeading(heading);
    if (section === "experience" || section === "projects") {
      for (const entry of splitEntries(lines)) add(section, entry);
    } else if (section === "other" && heading !== null) {
      add(section, [heading, ...lines].join("\n")); // keep the heading: it says what these lines are
    } else {
      add(section, lines.join("\n"));
    }
  }
  return chunks;
}
