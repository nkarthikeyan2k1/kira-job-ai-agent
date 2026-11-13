import { describe, expect, it } from "vitest";
import { pdfTextToResumeText } from "./pdf-text.ts";
import { classifyHeading, splitResume } from "./sections.ts";

const RESUME = `Asha Rao Pune, MH asha@example.com

# Summary

Backend developer with 6 years of experience.

# Technical Skills

Backend: Node.js, gRPC
Data: PostgreSQL, Redis

# Experience

Jan 2022 – Present Pune, India
Acme Payments
Senior Developer

- Built a ledger service.
- Reduced latency.

Jun 2018 – Dec 2021
Globex
Developer

- Shipped the billing API.

# Projects

Ledgerly | Node.js, PostgreSQL
- Open-source double-entry ledger.

# Education

2014 – 2018
B.E. Computer Science – Example University

# Interests

Chess, trail running`;

describe("classifyHeading", () => {
  it.each([
    ["Summary", "summary"],
    ["Technical Skills", "skills"],
    ["Work Experience", "experience"],
    ["Projects", "projects"],
    ["Education", "education"],
    ["Certifications", "certifications"],
    ["Interests", "other"],
  ])("%s → %s", (heading, section) => {
    expect(classifyHeading(heading)).toBe(section);
  });
});

describe("splitResume", () => {
  const chunks = splitResume(RESUME);

  it("makes one chunk per section, and one per job and project", () => {
    expect(chunks.map((c) => `${c.section}#${c.ordinal}`)).toEqual([
      "other#0",
      "summary#0",
      "skills#0",
      "experience#0",
      "experience#1",
      "projects#0",
      "education#0",
      "other#1",
    ]);
  });

  it("keeps an entry's header lines with its bullets", () => {
    expect(chunks[3]!.content).toBe("Jan 2022 – Present Pune, India\nAcme Payments\nSenior Developer\n- Built a ledger service.\n- Reduced latency.");
    expect(chunks[4]!.content).toBe("Jun 2018 – Dec 2021\nGlobex\nDeveloper\n- Shipped the billing API.");
  });

  it("keeps the heading of a section it cannot classify", () => {
    expect(chunks.at(-1)!.content).toBe("Interests\nChess, trail running");
  });

  it("returns nothing for empty text", () => {
    expect(splitResume("  \n ")).toEqual([]);
  });
});

describe("pdfTextToResumeText", () => {
  it("marks headings and bullets and re-joins wrapped bullet lines", () => {
    const pdfText = [
      "Asha Rao",
      "Summary",
      "Backend developer with 6 years of experience.",
      "Experience",
      "Acme Payments",
      "Senior Developer",
      "• Built a ledger service handling 2M+ requests a day with",
      "PostgreSQL and Redis.",
      "• Reduced latency.",
      "Globex",
      "• Shipped the billing API.",
    ].join("\n");

    expect(pdfTextToResumeText(pdfText)).toBe(
      [
        "Asha Rao",
        "# Summary",
        "Backend developer with 6 years of experience.",
        "# Experience",
        "Acme Payments",
        "Senior Developer",
        "- Built a ledger service handling 2M+ requests a day with PostgreSQL and Redis.",
        "- Reduced latency.",
        "Globex",
        "- Shipped the billing API.",
      ].join("\n"),
    );
    expect(splitResume(pdfTextToResumeText(pdfText)).map((c) => `${c.section}#${c.ordinal}`)).toEqual([
      "other#0",
      "summary#0",
      "experience#0",
      "experience#1",
    ]);
  });
});
