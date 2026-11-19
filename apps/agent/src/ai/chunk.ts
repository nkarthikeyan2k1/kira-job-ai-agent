import type { JobChunkSection } from "@kira/shared";
import type { ChunkConfig } from "../../config/scoring.ts";

// Chunking: a job description is cut into pieces that are each about one
// thing (the requirements, the responsibilities, the company blurb). One
// vector for a whole posting would be an average of everything and match
// nothing well; per-section vectors let "5+ years of Node.js" be compared
// with the resume on its own.

export interface JobChunkDraft {
  section: JobChunkSection;
  ordinal: number; // position within its section, from 0
  content: string; // starts with its heading line when it has one
}

// First match wins. Order matters: "about the role" and "about you" must be
// checked before the generic "about …" company blurb.
const SECTION_PATTERNS: readonly (readonly [JobChunkSection, RegExp])[] = [
  ["requirements", /require|qualif|who you are|what you'll need|what we're looking for|you have|you'll bring|bring along|must have|good to have|nice to have|preferred|skill|experience|about you|apply if|ideal candidate|eligib|expectations|education/],
  ["responsibilities", /responsib|what you'll do|what you will do|what will you do|the role|your role|^role\b|role overview|job profile|what awaits|what you'll own|duties|day to day|key deliverables/],
  ["benefits", /benefit|perks|compensation|what we offer|pay and/],
  ["about", /^about\b|who we are|^what is\b|our mission|why join|unit overview/],
];

const normalize = (line: string) => line.toLowerCase().replace(/[‘’`]/g, "'");

export function classifyHeading(heading: string): JobChunkSection | null {
  const text = normalize(heading);
  return SECTION_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

// A heading is a short line that is not a sentence. Questions count ("what is
// CRED?"); "label: value" lines ("Experience: 4-8 years") are content, not headings.
function isHeading(line: string, config: ChunkConfig): boolean {
  if (line.startsWith("- ") || /:\s*\S/.test(line)) return false;
  const text = line.replace(/:\s*$/, "");
  return text.length <= config.headingMaxChars && text.split(/\s+/).length <= config.headingMaxWords && !/[.!]$/.test(text);
}

interface Block {
  section: JobChunkSection;
  heading: string | null;
  lines: string[];
}

// Splits text that is too long at sentence ends; as a last resort cuts it.
function splitLongLine(line: string, budget: number, onCut?: (chars: number) => void): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const sentence of line.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > budget) {
      if (current) pieces.push(current);
      current = "";
      for (let i = 0; i < sentence.length; i += budget) pieces.push(sentence.slice(i, i + budget));
      onCut?.(sentence.length);
      continue;
    }
    if (current && current.length + 1 + sentence.length > budget) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

// Packs a block's lines into chunks of at most maxChars, repeating the heading on each.
function packBlock(block: Block, config: ChunkConfig, onCut?: (chars: number) => void): string[] {
  const prefix = block.heading ? `${block.heading}\n` : "";
  const budget = config.maxChars - prefix.length;
  const units = block.lines.flatMap((line) => (line.length > budget ? splitLongLine(line, budget, onCut) : [line]));

  const pieces: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const unit of units) {
    const added = (current.length > 0 ? 1 : 0) + unit.length;
    if (current.length > 0 && size + added > budget) {
      pieces.push(prefix + current.join("\n"));
      current = [];
      size = 0;
    }
    size += (current.length > 0 ? 1 : 0) + unit.length;
    current.push(unit);
  }
  if (current.length > 0) pieces.push(prefix + current.join("\n"));
  return pieces;
}

/**
 * Plain-text JD (headings as short lines, "- " bullets) → section chunks.
 *
 * A short line that is not a sentence is a heading. Pieces under `minChars`
 * are merged into the last chunk of the same section. A heading that names a
 * known section starts a new block; one that doesn't (a sub-heading such as
 * "Fraud detection & analysis") stays inside the current block. Text before
 * the first known heading is "other". `onCut` is told when a single sentence
 * was longer than a chunk and had to be cut.
 */
export function chunkJobDescription(description: string, config: ChunkConfig, onCut?: (chars: number) => void): JobChunkDraft[] {
  const blocks: Block[] = [];
  for (const raw of description.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const section = isHeading(line, config) ? classifyHeading(line) : null;
    if (section) {
      blocks.push({ section, heading: line, lines: [] });
    } else {
      if (blocks.length === 0) blocks.push({ section: "other", heading: null, lines: [] });
      blocks.at(-1)!.lines.push(line);
    }
  }

  const chunks: { section: JobChunkSection; content: string }[] = [];
  for (const block of blocks) {
    if (block.lines.length === 0) continue; // a heading with no text under it ("Who we are" right before "About Stripe")
    for (const content of packBlock(block, config, onCut)) {
      const previous = chunks.findLast((chunk) => chunk.section === block.section);
      if (content.length < config.minChars && previous && previous.content.length + 1 + content.length <= config.maxChars) {
        previous.content += `\n${content}`;
      } else {
        chunks.push({ section: block.section, content });
      }
    }
  }

  const ordinals = new Map<JobChunkSection, number>();
  return chunks.map(({ section, content }) => {
    const ordinal = ordinals.get(section) ?? 0;
    ordinals.set(section, ordinal + 1);
    return { section, ordinal, content };
  });
}
