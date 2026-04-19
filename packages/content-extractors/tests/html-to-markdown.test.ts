import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/html-to-markdown.js";

describe("htmlToMarkdown", () => {
  it("converts headings", () => {
    const md = htmlToMarkdown("<h1>Title</h1><h2>Subtitle</h2>");
    expect(md).toContain("# Title");
    expect(md).toContain("## Subtitle");
  });

  it("converts paragraphs", () => {
    const md = htmlToMarkdown("<p>Hello world</p>");
    expect(md).toContain("Hello world");
  });

  it("converts bold text", () => {
    const md = htmlToMarkdown("<strong>bold</strong>");
    expect(md).toContain("**bold**");
  });

  it("converts italic text", () => {
    const md = htmlToMarkdown("<em>italic</em>");
    expect(md).toContain("*italic*");
  });

  it("converts links", () => {
    const md = htmlToMarkdown('<a href="https://example.com">link</a>');
    expect(md).toContain("[link](https://example.com)");
  });

  it("converts unordered lists", () => {
    const md = htmlToMarkdown("<ul><li>one</li><li>two</li><li>three</li></ul>");
    expect(md).toContain("*   one");
    expect(md).toContain("*   two");
    expect(md).toContain("*   three");
  });

  it("converts ordered lists", () => {
    const md = htmlToMarkdown("<ol><li>first</li><li>second</li><li>third</li></ol>");
    expect(md).toContain("1.  first");
    expect(md).toContain("2.  second");
  });

  it("converts code blocks", () => {
    const md = htmlToMarkdown("<pre><code>const x = 1;\nconst y = 2;</code></pre>");
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });

  it("converts inline code", () => {
    const md = htmlToMarkdown("Use <code>foo()</code> here");
    expect(md).toContain("`foo()`");
  });

  it("converts tables", () => {
    const md = htmlToMarkdown(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    expect(md).toContain("| A");
    expect(md).toContain("| B");
    expect(md).toContain("| 1");
    expect(md).toContain("| 2");
  });

  it("converts line breaks", () => {
    const md = htmlToMarkdown("<p>line one<br>line two</p>");
    expect(md).toContain("line one");
    expect(md).toContain("line two");
  });

  it("handles nested formatting", () => {
    const md = htmlToMarkdown("<p>This is <strong>bold with <em>italic</em> inside</strong></p>");
    expect(md).toContain("**bold with *italic* inside**");
  });

  it("strips unknown/decorative tags", () => {
    const md = htmlToMarkdown("<div><span>text</span></div>");
    expect(md.trim()).toBe("text");
  });

  it("decodes HTML entities", () => {
    const md = htmlToMarkdown("<p>&amp; &lt; &gt;</p>");
    expect(md).toContain("& < >");
  });
});
