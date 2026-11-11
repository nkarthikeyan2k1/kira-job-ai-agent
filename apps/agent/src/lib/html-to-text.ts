// Adapted from career-ops (providers/_html-to-text.mjs), MIT License,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See THIRD_PARTY_NOTICES.md.
//
// Changed from the original: block tags become line breaks and list items
// become "- " lines (the original flattens everything to one line), and there
// is no length cap. Later stages split a description into sections
// (requirements, responsibilities…), which needs the structure kept.
import { decodeEntities } from "./html-entities.ts";

// A tag starts with "<" followed by a letter, "/", "!" or "?" and ends at an
// unquoted ">". Both rules matter on real postings: "teams of <10 engineers"
// must stay text, and a ">" inside a quoted attribute must not end the tag.
const TAG_BODY = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const SCRIPT_OR_STYLE = new RegExp(`<(script|style)\\b${TAG_BODY}>[\\s\\S]*?<\\/\\1\\s*>`, "gi");
const COMMENT = /<!--[\s\S]*?-->/g;
const LIST_ITEM_OPEN = new RegExp(`<li\\b${TAG_BODY}>`, "gi");
const HEADING = new RegExp(`<\\/?h[1-6]\\b${TAG_BODY}>`, "gi");
const BLOCK = new RegExp(`<\\/?(?:p|br|ul|ol|li|tr|table|section|article|blockquote|hr)\\b${TAG_BODY}>`, "gi");
// A <div> is a line, not a paragraph: "<div>a</div><div>b</div>" is two lines,
// so a run of div boundaries counts as one line break, not one per tag.
const DIV = new RegExp(`<\\/?div\\b${TAG_BODY}>`, "gi");
const SOFT_BREAK = "\u0001";
const SOFT_BREAK_RUN = /\u0001(?:[ \t]*\u0001)*/g;
const CELL = new RegExp(`<\\/?t[dh]\\b${TAG_BODY}>`, "gi");
const ANY_TAG = new RegExp(`<(?=[a-z/!?])${TAG_BODY}>`, "gi");

function stripMarkup(html: string): string {
  return html
    .replaceAll(SOFT_BREAK, "")
    .replace(SCRIPT_OR_STYLE, " ")
    .replace(COMMENT, " ")
    .replace(LIST_ITEM_OPEN, "\n- ")
    .replace(HEADING, "\n\n")
    .replace(BLOCK, "\n")
    .replace(DIV, SOFT_BREAK)
    .replace(CELL, " ")
    .replace(ANY_TAG, "") // inline tags (<strong>, <a>, <span>) vanish without splitting words
    .replace(SOFT_BREAK_RUN, "\n");
}

/**
 * HTML (possibly entity-escaped, as Greenhouse sends it) → readable plain text.
 *
 * Strip and decode run twice: Greenhouse's `content` is double-encoded
 * (`&lt;p&gt;`), so the first decode only reveals the real tags. Every decode
 * is followed by a strip, so escaped markup can never survive into the output.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const once = decodeEntities(stripMarkup(html));
  const twice = decodeEntities(stripMarkup(once));
  return stripMarkup(twice)
    .replace(/<(?=\/?[a-z!?])/gi, "") // an unclosed tag opener: keep its text, drop the bracket
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/^-\n+(?=\S)/gm, "- ") // "<li><p>text</p></li>" → "- text"
    .replace(/^(- .*)\n{2,}(?=- )/gm, "$1\n") // no blank line between two list items
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
