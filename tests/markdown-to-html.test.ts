import { describe, expect, it } from "vitest";
import { markdownToHtml } from "../src/markdown-to-html.js";

describe("markdownToHtml", () => {
  it("converts simple markdown to HTML", () => {
    const html = markdownToHtml("# Hello World\n\nThis is a paragraph.");
    expect(html).toContain("<h1>Hello World</h1>");
    expect(html).toContain("<p>This is a paragraph.</p>");
  });

  it("handles headings at different levels", () => {
    const html = markdownToHtml(
      "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6",
    );
    expect(html).toContain("<h1>H1</h1>");
    expect(html).toContain("<h2>H2</h2>");
    expect(html).toContain("<h3>H3</h3>");
    expect(html).toContain("<h4>H4</h4>");
    expect(html).toContain("<h5>H5</h5>");
    expect(html).toContain("<h6>H6</h6>");
  });

  it("converts unordered lists", () => {
    const html = markdownToHtml("- Item 1\n- Item 2\n- Item 3");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Item 1</li>");
    expect(html).toContain("<li>Item 2</li>");
    expect(html).toContain("</ul>");
  });

  it("converts ordered lists", () => {
    const html = markdownToHtml("1. First\n2. Second\n3. Third");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("</ol>");
  });

  it("handles code blocks", () => {
    const html = markdownToHtml("```javascript\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
  });

  it("handles inline code", () => {
    const html = markdownToHtml("This is `inline code` in text.");
    expect(html).toContain("<code>inline code</code>");
  });

  it("converts tables", () => {
    const html = markdownToHtml(
      "| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>Header 1</th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>Cell 1</td>");
  });

  it("handles emphasis and strong", () => {
    const html = markdownToHtml("*italic* and **bold** text");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("handles links", () => {
    const html = markdownToHtml("[Link text](https://example.com)");
    expect(html).toContain('<a href="https://example.com">Link text</a>');
  });

  it("returns empty string for empty markdown", () => {
    expect(markdownToHtml("")).toBe("");
    expect(markdownToHtml("   ")).toBe("");
  });

  it("handles nested structures", () => {
    const markdown =
      "# Title\n\n## Subtitle\n\nParagraph with **bold** text.\n\n- List item 1\n- List item 2";
    const html = markdownToHtml(markdown);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<h2>Subtitle</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<ul>");
  });
});
