import { describe, expect, it } from "vitest";
import { CHUNK_CONFIG as config } from "../../config/scoring.ts";
import { chunkJobDescription, classifyHeading } from "./chunk.ts";

const sections = (text: string) => chunkJobDescription(text, config).map((c) => `${c.section}#${c.ordinal}`);
const long = (word: string, n: number) => Array.from({ length: n }, (_, i) => `- ${word} item number ${i} with enough words to matter.`).join("\n");

// Short descriptions in the shape of each real source.
const STRIPE = `Who we are

About Stripe

Stripe is a financial infrastructure platform for businesses. Millions of companies use Stripe.

About the team

The Payments team builds the core payment APIs used by every merchant.

What you’ll do

- Design and build reliable payment services.
- Own on-call for your services.

Who you are

Minimum requirements

- 5+ years building backend systems.
- Experience with Java or Go.

Preferred qualifications

- Payments domain experience.`;

const PAYTM = `About Us:
Paytm is India's leading digital payments company.

About the Role:
We are hiring a backend engineer for the travel platform.

Key Responsibilities:
- Build scalable Java services for bookings and payments.

Expectations/ Requirements:
- 3+ years of experience with Spring Boot and microservices.

Why join us:
- Fast growth and large scale.

Compensation:
If you are the right fit, we believe in creating wealth for you.`;

const BMW = `What awaits you/ Job Profile
You will be part of the Digital Product Engineering cluster building EV components.
- Lead the mechanical architecture of the charging unit.

What should you bring along
Must have technical skill
- Proficient in CATIA V5 for 2D and 3D construction.
Good to have technical skills
- Previous experience in automotive HV systems.

Experience: 4-8 years`;

const CRED = `what is CRED?
CRED is a members-only community rewarding good financial behaviour, built on trust.

what you’ll own
fraud detection & analysis
- monitor transactions and flag fraud patterns early.
fraud prevention & problem solving
- design rules that stop fraud before it happens.

you should apply if you have
- 2+ years in fraud or risk analytics.`;

describe("classifyHeading", () => {
  it.each([
    ["Minimum requirements", "requirements"],
    ["Preferred qualifications", "requirements"],
    ["Who you are", "requirements"],
    ["Must have technical skill", "requirements"],
    ["What should you bring along", "requirements"],
    ["you should apply if you have", "requirements"],
    ["Expectations/ Requirements:", "requirements"],
    ["What you’ll do", "responsibilities"],
    ["Key Responsibilities:", "responsibilities"],
    ["About the Role:", "responsibilities"],
    ["What awaits you/ Job Profile", "responsibilities"],
    ["what you’ll own", "responsibilities"],
    ["Role", "responsibilities"],
    ["About Stripe", "about"],
    ["About the team", "about"],
    ["what is CRED?", "about"],
    ["Why join us:", "about"],
    ["Compensation:", "benefits"],
    ["Perks and benefits", "benefits"],
    ["fraud detection & analysis", null],
    ["Location", null],
  ])("%s → %s", (heading, section) => {
    expect(classifyHeading(heading)).toBe(section);
  });
});

describe("chunkJobDescription", () => {
  it("splits a Stripe posting into its sections, dropping a heading with no text under it", () => {
    expect(sections(STRIPE)).toEqual(["about#0", "about#1", "responsibilities#0", "requirements#0"]);
    const chunks = chunkJobDescription(STRIPE, config);
    // "Preferred qualifications" is a small piece, so it joins the requirements chunk before it.
    expect(chunks[3]!.content).toBe(
      "Minimum requirements\n- 5+ years building backend systems.\n- Experience with Java or Go.\nPreferred qualifications\n- Payments domain experience.",
    );
    expect(chunks.some((c) => c.content.startsWith("Who we are"))).toBe(false);
  });

  it("handles Paytm's 'Heading:' style, with 'About the Role' as responsibilities", () => {
    expect(sections(PAYTM)).toEqual(["about#0", "responsibilities#0", "responsibilities#1", "requirements#0", "benefits#0"]);
    // The short "Why join us" piece is merged into the earlier "About us" chunk.
    expect(chunkJobDescription(PAYTM, config)[0]!.content).toContain("Why join us:\n- Fast growth");
  });

  it("keeps BMW's 'Experience: 4-8 years' line as text and merges a tiny fragment into its section", () => {
    const chunks = chunkJobDescription(BMW, config);
    expect(chunks.map((c) => c.section)).toEqual(["responsibilities", "requirements", "requirements"]);
    // "Experience: 4-8 years" is a field, not a heading: its value must survive.
    expect(chunks[2]!.content).toBe("Good to have technical skills\n- Previous experience in automotive HV systems.\nExperience: 4-8 years");
  });

  it("keeps CRED's unknown sub-headings inside the section they belong to", () => {
    const chunks = chunkJobDescription(CRED, config);
    expect(chunks.map((c) => c.section)).toEqual(["about", "responsibilities", "requirements"]);
    expect(chunks[1]!.content).toContain("fraud detection & analysis\n- monitor transactions");
    expect(chunks[1]!.content).toContain("fraud prevention & problem solving");
  });

  it("labels text before the first heading 'other', and a posting with no headings is all 'other'", () => {
    expect(sections("We build things in Pune and care deeply about quality.\n\nRequirements\n- Node.js and PostgreSQL for five years.")).toEqual([
      "other#0",
      "requirements#0",
    ]);
    expect(sections("A plain paragraph posting with no headings at all, describing the job in a sentence.")).toEqual(["other#0"]);
  });

  it("splits a long section into pieces under the limit, repeating the heading on each", () => {
    const chunks = chunkJobDescription(`Requirements\n${long("TypeScript", 120)}`, config);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(config.maxChars);
      expect(chunk.content.startsWith("Requirements\n- TypeScript")).toBe(true);
    }
  });

  it("splits a single over-long paragraph at sentence ends, and cuts only as a last resort", () => {
    const sentences = Array.from({ length: 80 }, (_, i) => `Sentence ${i} talks about building services.`).join(" ");
    const cuts: number[] = [];
    const byChunk = chunkJobDescription(`Requirements\n${sentences}`, config, (n) => cuts.push(n));
    expect(byChunk.every((c) => c.content.length <= config.maxChars && /\.$/.test(c.content))).toBe(true);
    expect(cuts).toEqual([]);

    chunkJobDescription(`Requirements\n${"x".repeat(5000)}`, config, (n) => cuts.push(n));
    expect(cuts).toEqual([5000]);
  });

  it("returns nothing for an empty description", () => {
    expect(chunkJobDescription("  \n\n ", config)).toEqual([]);
  });
});
