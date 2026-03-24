import { describe, expect, it } from "vitest";
import { parseDocument } from "../../src/parser/parse-document.js";
import { serializeDocument } from "../../src/parser/serialize-document.js";
import type { ContentDocument } from "../../src/types.js";

describe("parseDocument", () => {
  it("should parse document with props and sections", () => {
    const input = `title: Test Document
createdAt: 2026-03-15T12:00:00Z

---

time: 2026-03-15T12:00:00Z
role: user

Hello, how are you?

---

time: 2026-03-15T12:01:00Z
role: assistant

I'm good, thank you!
`;
    const result = parseDocument(input);

    expect(result.props).toEqual({
      title: "Test Document",
      createdAt: "2026-03-15T12:00:00Z",
    });
    expect(result.content).toHaveLength(2);
    expect(result.content[0]?.props?.role).toBe("user");
    expect(result.content[0]?.blocks[0]?.content).toBe("Hello, how are you?");
    expect(result.content[1]?.props?.role).toBe("assistant");
    expect(result.content[1]?.blocks[0]?.content).toBe("I'm good, thank you!");
  });

  it("should parse document with no sections as content", () => {
    const input = "title: Empty\ncreatedAt: 2026-03-15T12:00:00Z\n";
    const result = parseDocument(input);

    // No --- separator → entire text is content, not properties
    expect(result.props).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.blocks[0]?.content).toContain("title: Empty");
  });

  it("should parse plain markdown with headers", () => {
    const input = "# My Title\n\nHello world\n";
    const result = parseDocument(input);

    expect(result.props).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.blocks[0]?.title).toBe("My Title");
    expect(result.content[0]?.blocks[0]?.content).toBe("Hello world");
  });

  it("should parse document with id in props", () => {
    const input = `id: abc-123
title: Test
---
role: user

Hi
`;
    const result = parseDocument(input);
    expect(result.props?.id).toBe("abc-123");
    expect(result.content).toHaveLength(1);
  });

  it("should handle escaped block separators in content", () => {
    const input = `title: Test
---
role: user

Before
\\---
After
`;
    const result = parseDocument(input);
    expect(result.content[0]?.blocks[0]?.content).toBe("Before\n---\nAfter");
  });

  it("should skip empty segments", () => {
    const input = `title: Test
---

---
role: user

Content
`;
    const result = parseDocument(input);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.props?.role).toBe("user");
  });

  it("should parse format with empty lines after separators", () => {
    const input = `---
createdAt: 2026-03-07T12:00:00Z
title: Chat with LiteLLM
---

role: user
time: 2026-03-07T12:00:00Z

Hello, how are you?

---

role: assistant
time: 2026-03-07T12:01:00Z

I'm good, thank you!

`;
    const result = parseDocument(input);
    expect(result.props?.title).toBe("Chat with LiteLLM");
    expect(result.props?.createdAt).toBe("2026-03-07T12:00:00Z");
    expect(result.content).toHaveLength(2);
    expect(result.content[0]?.props?.role).toBe("user");
    expect(result.content[0]?.blocks[0]?.content).toBe("Hello, how are you?");
    expect(result.content[1]?.props?.role).toBe("assistant");
    expect(result.content[1]?.blocks[0]?.content).toBe("I'm good, thank you!");
  });

  it("should parse frontmatter format", () => {
    const input = `---
title: Frontmatter Test
---
role: user

Hello
`;
    const result = parseDocument(input);
    expect(result.props?.title).toBe("Frontmatter Test");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.blocks[0]?.content).toBe("Hello");
  });
});

describe("serializeDocument", () => {
  it("should serialize a document with props and sections", () => {
    const doc: ContentDocument = {
      props: {
        id: "abc-123",
        title: "Test",
        createdAt: "2026-03-15T12:00:00Z",
      },
      content: [
        {
          props: { role: "user", time: "2026-03-15T12:00:00Z" },
          blocks: [{ content: "Hello!" }],
        },
        {
          props: { role: "assistant", time: "2026-03-15T12:01:00Z" },
          blocks: [{ content: "Hi there!" }],
        },
      ],
    };

    const result = serializeDocument(doc);
    expect(result).toContain("id: abc-123");
    expect(result).toContain("---");
    expect(result).toContain("role: user");
    expect(result).toContain("Hello!");
    expect(result).toContain("role: assistant");
    expect(result).toContain("Hi there!");
  });

  it("should escape --- in section content", () => {
    const doc: ContentDocument = {
      props: { title: "Test" },
      content: [
        {
          props: { role: "user" },
          blocks: [{ content: "Before\n---\nAfter" }],
        },
      ],
    };

    const result = serializeDocument(doc);
    expect(result).toContain("\\---");
  });

  it("should serialize document with no sections", () => {
    const doc: ContentDocument = {
      props: { title: "Empty" },
      content: [],
    };

    const result = serializeDocument(doc);
    expect(result).toBe("---\ntitle: Empty\n");
  });

  it("should serialize document without props", () => {
    const doc: ContentDocument = {
      content: [
        {
          props: { role: "user" },
          blocks: [{ content: "Hello" }],
        },
      ],
    };

    const result = serializeDocument(doc);
    expect(result).not.toMatch(/^---\n---/);
    expect(result).toContain("role: user");
    expect(result).toContain("Hello");
  });
});

describe("round-trip", () => {
  it("should produce the same result: parse → serialize → parse", () => {
    const doc: ContentDocument = {
      props: {
        id: "abc-123",
        createdAt: "2026-03-15T12:00:00Z",
        title: "Test",
      },
      content: [
        {
          props: { role: "user", time: "2026-03-15T12:00:00Z" },
          blocks: [{ content: "Hello, how are you?" }],
        },
        {
          props: { role: "assistant", time: "2026-03-15T12:01:00Z" },
          blocks: [{ content: "I'm good, thank you!" }],
        },
      ],
    };

    const serialized = serializeDocument(doc);
    const parsed = parseDocument(serialized);
    const serialized2 = serializeDocument(parsed);

    expect(serialized2).toBe(serialized);
  });

  it("should round-trip sections with escaped horizontal rules", () => {
    const doc: ContentDocument = {
      props: { title: "Escape test" },
      content: [
        {
          props: { role: "user" },
          blocks: [{ content: "Line 1\n---\nLine 3\n---\nLine 5" }],
        },
      ],
    };

    const serialized = serializeDocument(doc);
    const parsed = parseDocument(serialized);
    expect(parsed.content[0]?.blocks[0]?.content).toBe(
      "Line 1\n---\nLine 3\n---\nLine 5",
    );
  });
});
