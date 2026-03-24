import { describe, expect, it } from "vitest";
import { htmlExtractor } from "../../src/extractors/html-extractor.js";

function toChunks(...strings: string[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return strings.map((s) => encoder.encode(s));
}

describe("htmlExtractor", () => {
  it("converts heading and paragraph", async () => {
    const chunks = toChunks("<h1>Title</h1><p>Hello</p>");
    const result = await htmlExtractor(chunks);
    expect(result).toBe("# Title\n\nHello");
  });

  it("converts links", async () => {
    const chunks = toChunks('<a href="https://example.com">link</a>');
    const result = await htmlExtractor(chunks);
    expect(result).toBe("[link](https://example.com)");
  });

  it("converts bold text", async () => {
    const chunks = toChunks("<strong>bold</strong>");
    const result = await htmlExtractor(chunks);
    expect(result).toBe("**bold**");
  });

  it("converts italic text", async () => {
    const chunks = toChunks("<em>italic</em>");
    const result = await htmlExtractor(chunks);
    expect(result).toBe("*italic*");
  });

  it("converts list items", async () => {
    const chunks = toChunks("<ul><li>one</li><li>two</li></ul>");
    const result = await htmlExtractor(chunks);
    expect(result).toBe("*   one\n*   two");
  });

  it("converts multiple heading levels", async () => {
    const chunks = toChunks("<h2>Sub</h2><h3>SubSub</h3>");
    const result = await htmlExtractor(chunks);
    expect(result).toBe("## Sub\n\n### SubSub");
  });

  it("converts inline code", async () => {
    const chunks = toChunks("Use <code>foo()</code> here");
    const result = await htmlExtractor(chunks);
    expect(result).toBe("Use `foo()` here");
  });

  it("converts code blocks", async () => {
    const chunks = toChunks("<pre><code>const x = 1;</code></pre>");
    const result = await htmlExtractor(chunks);
    expect(result).toBe("```\nconst x = 1;\n```");
  });

  it("decodes HTML entities", async () => {
    const chunks = toChunks("<p>&amp; &lt; &gt; &quot;</p>");
    const result = await htmlExtractor(chunks);
    expect(result).toBe('& < > "');
  });

  it("strips unknown tags", async () => {
    const chunks = toChunks("<div><span>text</span></div>");
    const result = await htmlExtractor(chunks);
    expect(result).toBe("text");
  });
});
