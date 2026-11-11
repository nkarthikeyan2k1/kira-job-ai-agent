// Adapted from career-ops (providers/_html-entities.mjs), MIT License,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See THIRD_PARTY_NOTICES.md.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ",
  ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  ntilde: "ñ",
  ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü",
  yacute: "ý", yuml: "ÿ", szlig: "ß",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ",
  Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
  Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  Ntilde: "Ñ",
  Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü",
  Yacute: "Ý",
  deg: "°", hellip: "…", laquo: "«", raquo: "»", ndash: "–", mdash: "—", bull: "•",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", middot: "·", euro: "€",
  copy: "©", reg: "®", trade: "™",
};

// Browsers accept these without regard to case (&AMP;, &Lt;).
const CASE_INSENSITIVE_NAMES = new Set(["amp", "lt", "gt", "quot", "apos", "nbsp"]);

function isEmittableCodePoint(code: number): boolean {
  return (
    code === 0x9 || code === 0xa || code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** Decodes named and numeric HTML entities; unknown or invalid ones are left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return isEmittableCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    if (Object.hasOwn(NAMED_ENTITIES, body)) return NAMED_ENTITIES[body]!;
    const lower = body.toLowerCase();
    return CASE_INSENSITIVE_NAMES.has(lower) ? NAMED_ENTITIES[lower]! : match;
  });
}
