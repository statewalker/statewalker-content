import type { ContentMessage } from "@repo/content-blocks";
import { describe, expect, it } from "vitest";
import { extractContent } from "../src/extraction-pipeline.js";
import { createDefaultRegistry } from "../src/extractors/index.js";
import type { ContentNormalizer, ExtractionOptions } from "../src/types.js";

function toByteStream(text: string): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield new TextEncoder().encode(text);
  })();
}

async function collect(
  gen: AsyncGenerator<ContentMessage>,
): Promise<ContentMessage[]> {
  const messages: ContentMessage[] = [];
  for await (const msg of gen) {
    messages.push(msg);
  }
  return messages;
}

describe("extractContent", () => {
  const registry = createDefaultRegistry();

  it("yields extracting + done when no normalizer", async () => {
    const content = toByteStream("hello world");
    const options: ExtractionOptions = { path: "test.md" };

    const messages = await collect(extractContent(content, options, registry));

    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.props.stage)).toEqual(["extracting", "done"]);
    expect(messages[0]?.props.type).toBe("extraction-progress");
    expect(messages[1]?.props.type).toBe("extraction-done");
  });

  it("yields extracting + normalizing + done when normalizer provided", async () => {
    const normalizer: ContentNormalizer = {
      normalize: async ({ markdown }) => ({ markdown: markdown.toUpperCase() }),
    };
    const content = toByteStream("hello world");
    const options: ExtractionOptions = { path: "test.md", normalizer };

    const messages = await collect(extractContent(content, options, registry));

    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.props.stage)).toEqual([
      "extracting",
      "normalizing",
      "done",
    ]);
  });

  it("final message blocks reflect buildBlockTree output", async () => {
    const md = "# Header\ncontent\n## Sub\nmore";
    const content = toByteStream(md);
    const options: ExtractionOptions = { path: "test.md" };

    const messages = await collect(extractContent(content, options, registry));
    const done = messages[messages.length - 1];

    expect(done?.props.stage).toBe("done");
    expect(done?.blocks).toHaveLength(1);

    // The root block has no title, empty content, and one child "Header"
    const root = done?.blocks[0];
    expect(root?.content).toBe("");
    expect(root?.children).toHaveLength(1);

    const header = root?.children?.[0];
    expect(header?.title).toBe("Header");
    expect(header?.content).toBe("content");
    expect(header?.children).toHaveLength(1);

    const sub = header?.children?.[0];
    expect(sub?.title).toBe("Sub");
    expect(sub?.content).toBe("more");
  });

  it("throws for unknown file type", async () => {
    const content = toByteStream("data");
    const options: ExtractionOptions = { path: "test.xyz" };

    await expect(async () => {
      await collect(extractContent(content, options, registry));
    }).rejects.toThrow("No extractor found for: test.xyz");
  });

  it("normalizer receives context", async () => {
    let capturedContext: string | undefined;
    const normalizer: ContentNormalizer = {
      normalize: async ({ markdown, context }) => {
        capturedContext = context;
        return { markdown };
      },
    };
    const content = toByteStream("hello");
    const options: ExtractionOptions = {
      path: "test.md",
      normalizer,
      context: "my-context",
    };

    await collect(extractContent(content, options, registry));

    expect(capturedContext).toBe("my-context");
  });

  it("custom role is applied to all messages", async () => {
    const content = toByteStream("hello");
    const options: ExtractionOptions = { path: "test.md", role: "custom-role" };

    const messages = await collect(extractContent(content, options, registry));

    for (const msg of messages) {
      expect(msg.props.role).toBe("custom-role");
    }
  });
});
