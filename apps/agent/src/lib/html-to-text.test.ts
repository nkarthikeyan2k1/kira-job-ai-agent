import { describe, expect, it } from "vitest";
import { decodeEntities } from "./html-entities.ts";
import { htmlToText } from "./html-to-text.ts";

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("Tom &amp; Jerry &#39;quoted&#x27; &mdash; caf&eacute;")).toBe("Tom & Jerry 'quoted' — café");
  });

  it("leaves unknown or invalid entities as written", () => {
    expect(decodeEntities("&notanentity; &#0; AT&T;")).toBe("&notanentity; &#0; AT&T;");
  });
});

describe("htmlToText", () => {
  it("returns an empty string for missing input", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText(undefined)).toBe("");
    expect(htmlToText("")).toBe("");
  });

  it("keeps headings, paragraphs and list items on their own lines", () => {
    const html = "<h2>Requirements</h2><ul><li>5+ years of <strong>TypeScript</strong></li><li><p>PostgreSQL</p></li></ul><p>Apply now.</p>";
    expect(htmlToText(html)).toBe("Requirements\n\n- 5+ years of TypeScript\n- PostgreSQL\n\nApply now.");
  });

  it("treats consecutive <div>s as lines and an empty one as a blank line", () => {
    expect(htmlToText("<div>About us</div><div>We build payments.</div><div><br></div><div>Requirements</div>")).toBe(
      "About us\nWe build payments.\n\nRequirements",
    );
    expect(htmlToText("<div><p>First</p></div><div><p>Second</p></div>")).toBe("First\n\nSecond");
  });

  it("decodes double-encoded markup the way Greenhouse sends it", () => {
    const content = "&lt;h3&gt;About&lt;/h3&gt;&lt;p&gt;R&amp;amp;D team, it&amp;#39;s great&lt;/p&gt;";
    expect(htmlToText(content)).toBe("About\n\nR&D team, it's great");
  });

  it("removes script and style blocks with their contents", () => {
    expect(htmlToText("<p>Hello</p><script>alert('x')</script><style>p{color:red}</style><p>World</p>")).toBe("Hello\n\nWorld");
  });

  it("does not let escaped active markup survive decoding", () => {
    expect(htmlToText("&lt;script&gt;steal()&lt;/script&gt;Safe")).toBe("Safe");
  });

  it("treats a '<' that does not start a tag as text", () => {
    expect(htmlToText("<p>Teams of &lt;10 engineers, salary &gt;150k</p>")).toBe("Teams of <10 engineers, salary >150k");
  });

  it("handles '>' inside a quoted attribute", () => {
    expect(htmlToText('<a href="https://example.com/?a>b" title="x > y">link</a> text')).toBe("link text");
  });

  it("collapses runs of spaces and blank lines", () => {
    expect(htmlToText("<p>a   b&nbsp;&nbsp;c</p><br><br><br><p>d</p>")).toBe("a b c\n\nd");
  });
});
