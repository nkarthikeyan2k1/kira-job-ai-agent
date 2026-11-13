// LaTeX resume source → plain text with a light structure the section
// splitter understands: "# Heading" lines for sections, "- " for bullets, one
// line per line break. It is not a LaTeX interpreter: it knows the handful of
// commands a resume uses and drops the rest, keeping their text.

const HARD = "\u0001"; // a real line break (as opposed to source-code wrapping)
const ESCAPES: Record<string, string> = { "%": "\u0002", "&": "\u0003", $: "\u0004", "#": "\u0005", _: "\u0006", "{": "\u0007", "}": "\u0008" };

/** Reads one argument at `index`: a balanced {…} group or a bare control sequence (\foo). */
function readArgument(text: string, index: number): { value: string; end: number } | null {
  let i = index;
  while (/\s/.test(text[i] ?? "")) i++;
  if (text[i] === "\\") {
    const name = /^\\[a-zA-Z]+/.exec(text.slice(i));
    return name ? { value: "", end: i + name[0].length } : null;
  }
  if (text[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}" && --depth === 0) return { value: text.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

/** Replaces every `\name[opt]{arg1}…{argN}` with `render(args)`. Nested uses inside the arguments are handled too. */
function replaceCommand(text: string, name: string, argCount: number, render: (args: string[]) => string): string {
  const command = new RegExp(`\\\\${name}\\*?(?![a-zA-Z])`, "g");
  let out = text;
  for (let match = command.exec(out); match; match = command.exec(out)) {
    let end = match.index + match[0].length;
    const optional = /^\s*\[[^\]]*\]/.exec(out.slice(end));
    if (optional) end += optional[0].length;

    const args: string[] = [];
    for (let n = 0; n < argCount; n++) {
      const arg = readArgument(out, end);
      if (!arg) break;
      args.push(arg.value);
      end = arg.end;
    }
    if (args.length < argCount) continue; // not a use we understand; leave it for the generic clean-up
    out = out.slice(0, match.index) + render(args) + out.slice(end);
    command.lastIndex = match.index; // rescan: the replacement may hold a nested use
  }
  return out;
}

// \begin{env} becomes a line break. Arguments that start on the same line
// (RenderCV's "\begin{twocolentry}{Jul 2024 – Present}") are kept as their own line.
function replaceBegin(text: string): string {
  const begin = /\\begin\{[a-zA-Z*]+\}(?:\[[^\]]*\])?/g;
  let out = text;
  for (let match = begin.exec(out); match; match = begin.exec(out)) {
    let end = match.index + match[0].length;
    const lines: string[] = [];
    while (/^[ \t]*\{/.test(out.slice(end))) {
      const arg = readArgument(out, end);
      if (!arg) break;
      lines.push(arg.value);
      end = arg.end;
    }
    out = out.slice(0, match.index) + HARD + lines.map((line) => line + HARD).join("") + out.slice(end);
    begin.lastIndex = match.index;
  }
  return out;
}

export function latexToText(tex: string): string {
  const document = /\\begin\{document\}([\s\S]*?)\\end\{document\}/.exec(tex)?.[1] ?? tex;

  let text = document
    .replace(/\\\\(?:\[[^\]]*\])?/g, HARD) // "\\" and "\\[5pt]": explicit line breaks
    .replace(/\\([%&$#_{}])/g, (_, char: string) => ESCAPES[char]!) // protect escaped characters
    .replace(/%.*$/gm, "") // comments (an escaped \% is already protected)
    .replace(/\n[ \t]*\n/g, HARD); // a blank line ends a paragraph

  for (const [name, argCount] of [["newcommand", 2], ["renewcommand", 2], ["sbox", 2], ["newsavebox", 1], ["fontsize", 2], ["color", 1], ["vspace", 1], ["hspace", 1], ["setlength", 2], ["linespread", 1], ["needspace", 1]] as const) {
    text = replaceCommand(text, name, argCount, () => " ");
  }
  text = replaceCommand(text, "section", 1, ([title]) => `${HARD}# ${title}${HARD}`);
  for (const name of ["href", "hrefWithoutArrow"]) text = replaceCommand(text, name, 2, ([, label]) => label!);
  text = replaceBegin(text);

  text = text
    .replace(/\\end\{[a-zA-Z*]+\}/g, HARD)
    .replace(/\\item\b/g, `${HARD}- `)
    .replace(/\\kern\s*-?[\d.]+\s*(?:pt|cm|mm|em|ex)/g, " ")
    .replace(/\$([^$]*)\$/g, "$1") // inline math, e.g. $|$
    .replace(/\\[,;:! ]/g, " ") // spacing commands
    .replace(/~/g, " ")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/\\[a-zA-Z]+\*?/g, " ") // any other command: drop its name, keep its text
    .replace(/[{}]/g, "");

  for (const [char, placeholder] of Object.entries(ESCAPES)) text = text.replaceAll(placeholder, char);

  return text
    .replace(/\s*\n\s*/g, " ") // source-code wrapping is not a line break
    .replaceAll(HARD, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/^-\n+(?=\S)/gm, "- ")
    .replace(/^(- .*)\n{2,}(?=- )/gm, "$1\n") // no blank line between two bullets
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
