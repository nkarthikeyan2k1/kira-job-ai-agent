// Text extracted from a resume PDF → the same light structure latexToText
// produces ("# Heading", "- " bullets). A PDF has lost its structure, so this
// is guesswork and only a fallback for when there is no LaTeX source.

const SECTION_HEADINGS =
  /^(summary|profile|objective|(technical )?skills|(work |professional )?experience|projects|education|certifications?|interests|achievements|awards)$/i;
const BULLET = /^[•●▪◦‣·*-]\s+/;

export function pdfTextToResumeText(pdfText: string): string {
  const out: string[] = [];
  for (const raw of pdfText.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const previous = out.at(-1);
    if (SECTION_HEADINGS.test(line)) out.push(`# ${line}`);
    else if (BULLET.test(line)) out.push(`- ${line.replace(BULLET, "")}`);
    // A wrapped bullet: the line above is a bullet that has not ended its sentence yet.
    else if (previous?.startsWith("- ") && !/[.!?)]$/.test(previous)) out[out.length - 1] = `${previous} ${line}`;
    else out.push(line);
  }
  return out.join("\n");
}
