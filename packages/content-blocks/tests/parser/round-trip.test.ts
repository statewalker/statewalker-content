import { describe, expect, it } from "vitest";
import { parseDocument } from "../../src/parser/parse-document.js";
import { serializeDocument } from "../../src/parser/serialize-document.js";
import type { ContentDocument } from "../../src/types.js";

describe("round-trip: large documents", () => {
  it("round-trips a document with many sections and varied props", () => {
    const doc: ContentDocument = {
      props: {
        id: "doc-001",
        author: "tool:content-scanner",
        createdAt: "2026-03-15T10:00:00Z",
        title: "Architecture Review Session",
      },
      content: [
        {
          props: {
            id: "block-001",
            role: "tool:content-scanner",
            stage: "scanning",
            time: "2026-03-15T10:00:01Z",
            type: "scan-started",
            uri: "main:/src",
          },
          blocks: [{ content: "Scanning started for collection main" }],
        },
        {
          props: {
            id: "block-002",
            role: "tool:content-scanner",
            stage: "scanning",
            time: "2026-03-15T10:00:02Z",
            type: "content-changed",
            uri: "main:/src/index.ts",
          },
          blocks: [{ content: "File index.ts has been modified" }],
        },
        {
          props: {
            id: "block-003",
            role: "tool:content-extractor",
            stage: "extracting",
            time: "2026-03-15T10:00:03Z",
            type: "extraction-started",
            uri: "main:/src/index.ts",
          },
          blocks: [{ content: "Extracting content from index.ts" }],
        },
      ],
    };

    const serialized = serializeDocument(doc);
    const reparsed = parseDocument(serialized);
    const reserialized = serializeDocument(reparsed);
    expect(reserialized).toBe(serialized);
  });

  it("round-trips sections with markdown header content at various levels", () => {
    const doc: ContentDocument = {
      props: { id: "doc-002", title: "Technical Specification" },
      content: [
        {
          props: {
            id: "block-010",
            role: "user",
            time: "2026-03-15T11:00:00Z",
          },
          blocks: [
            {
              title: "Overview",
              content: "This document describes the system architecture.",
              children: [
                {
                  title: "Components",
                  content: "The system has three main components.",
                  children: [
                    {
                      title: "Frontend",
                      content: "Built with React and TypeScript.",
                    },
                    {
                      title: "Backend",
                      content: "Node.js with Express.",
                      children: [
                        {
                          title: "Database Layer",
                          content: "PostgreSQL with Drizzle ORM.",
                        },
                      ],
                    },
                  ],
                },
                { title: "Deployment", content: "Deployed on AWS using ECS." },
              ],
            },
            {
              title: "API Reference",
              content: "",
              children: [
                {
                  title: "Authentication",
                  content: "All endpoints require a Bearer token.",
                  children: [
                    { title: "POST /login", content: "Returns a JWT token." },
                    {
                      title: "GET /profile",
                      content: "Returns the current user profile.",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const serialized = serializeDocument(doc);

    // Verify headers appear at correct levels
    expect(serialized).toContain("# Overview");
    expect(serialized).toContain("## Components");
    expect(serialized).toContain("### Frontend");
    expect(serialized).toContain("### Backend");
    expect(serialized).toContain("#### Database Layer");
    expect(serialized).toContain("## Deployment");
    expect(serialized).toContain("# API Reference");
    expect(serialized).toContain("## Authentication");
    expect(serialized).toContain("### POST /login");

    // Round-trip
    const reparsed = parseDocument(serialized);
    const reserialized = serializeDocument(reparsed);
    expect(reserialized).toBe(serialized);
  });

  it("round-trips sections with escaped horizontal rules in content", () => {
    const doc: ContentDocument = {
      props: { title: "Escape Stress Test" },
      content: [
        {
          props: { id: "block-020", role: "assistant" },
          blocks: [
            {
              content:
                "Here is some content.\n\n---\n\nThis looks like a separator but it's escaped.\n\n---\n\nAnd another one. All should be preserved.",
            },
          ],
        },
        {
          props: { id: "block-021", role: "user" },
          blocks: [
            {
              content:
                "More content with multiple escaped rules:\n\n---\n\n---\n\n---\n\nBetween each escaped rule is just a newline.",
            },
          ],
        },
      ],
    };

    const serialized = serializeDocument(doc);
    const reparsed = parseDocument(serialized);
    const reserialized = serializeDocument(reparsed);
    expect(reserialized).toBe(serialized);
  });

  it("round-trips sections with code fences inside content", () => {
    const codeContent = `Here is a TypeScript example:

\`\`\`typescript
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

And a JSON config:

\`\`\`json
{
  "name": "@repo/content-blocks",
  "version": "0.0.0",
  "type": "module"
}
\`\`\`

End of examples.`;

    const doc: ContentDocument = {
      props: { title: "Code Examples" },
      content: [
        {
          props: {
            id: "block-030",
            role: "assistant",
            time: "2026-03-15T12:00:00Z",
          },
          blocks: [{ content: codeContent }],
        },
      ],
    };

    const serialized = serializeDocument(doc);
    expect(serialized).toContain("```typescript");
    expect(serialized).toContain("```json");

    const reparsed = parseDocument(serialized);
    const reserialized = serializeDocument(reparsed);
    expect(reserialized).toBe(serialized);
  });

  it("round-trips a document with sections having many different props", () => {
    const doc: ContentDocument = {
      props: {
        id: "session-42",
        createdAt: "2026-03-15T09:00:00Z",
        format: "v2",
        source: "cli",
        title: "Multi-property Test",
      },
      content: [
        {
          props: {
            id: "b1",
            collection: "docs",
            encoding: "utf-8",
            hash: "abc123def456",
            mimeType: "text/markdown",
            role: "tool:content-extractor",
            size: "4096",
            stage: "extracting",
            time: "2026-03-15T09:01:00Z",
            type: "content-changed",
            uri: "docs:/readme.md",
          },
          blocks: [
            {
              content: "Extracted readme content with various metadata fields.",
            },
          ],
        },
        {
          props: {
            id: "b2",
            collection: "docs",
            duration: "150ms",
            role: "tool:content-extractor",
            stage: "normalizing",
            time: "2026-03-15T09:01:01Z",
            type: "normalization-done",
            uri: "docs:/readme.md",
          },
          blocks: [
            {
              title: "README",
              content: "This is the project readme.",
              children: [
                { title: "Installation", content: "Run `pnpm install`." },
                { title: "Usage", content: "See the docs." },
              ],
            },
          ],
        },
      ],
    };

    const serialized = serializeDocument(doc);

    // Verify property ordering: id first, then alphabetical
    const lines = serialized.split("\n");
    const idLine = lines.findIndex((l) => l.startsWith("id: session-42"));
    const createdLine = lines.findIndex((l) => l.startsWith("createdAt:"));
    expect(idLine).toBeLessThan(createdLine);

    const reparsed = parseDocument(serialized);
    const reserialized = serializeDocument(reparsed);
    expect(reserialized).toBe(serialized);
  });

  it("round-trips a document with empty sections between content sections", () => {
    const doc: ContentDocument = {
      props: { title: "Sparse Document" },
      content: [
        {
          props: { id: "b1", role: "user" },
          blocks: [{ content: "First message" }],
        },
        {
          props: { id: "b2", role: "assistant" },
          blocks: [{ content: "" }],
        },
        {
          props: { id: "b3", role: "user" },
          blocks: [{ content: "Third message after empty assistant section" }],
        },
      ],
    };

    const serialized = serializeDocument(doc);
    const reparsed = parseDocument(serialized);
    const reserialized = serializeDocument(reparsed);
    expect(reserialized).toBe(serialized);
  });
});
