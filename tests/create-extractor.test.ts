import type { ContentMessage } from "@repo/content-blocks";
import { describe, expect, it } from "vitest";
import { createContentExtractor } from "../src/create-extractor.js";
import { ExtractorRegistry } from "../src/extractor-registry.js";

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

describe("createContentExtractor", () => {
  it("returns a function that yields ContentMessage", async () => {
    const extract = createContentExtractor();
    const gen = extract(toByteStream("hello"), { path: "test.md" });
    const messages = await collect(gen);

    expect(messages.length).toBeGreaterThan(0);
    for (const msg of messages) {
      expect(msg.props).toBeDefined();
      expect(msg.props.role).toBe("tool:content-extractor");
      expect(msg.props.time).toBeDefined();
      expect(msg.props.id).toBeDefined();
    }
  });

  it("uses default registry when none provided (test with .md file)", async () => {
    const extract = createContentExtractor();
    const messages = await collect(
      extract(toByteStream("# Title\nbody"), { path: "doc.md" }),
    );

    expect(messages.map((m) => m.props.stage)).toEqual(["extracting", "done"]);
  });

  it("uses custom registry when provided", async () => {
    const registry = new ExtractorRegistry();
    registry.registerByPattern("*.custom", async () => "custom output");

    const extract = createContentExtractor(registry);
    const messages = await collect(
      extract(toByteStream("data"), { path: "file.custom" }),
    );

    expect(messages.map((m) => m.props.stage)).toEqual(["extracting", "done"]);
    const done = messages[messages.length - 1];
    expect(done?.blocks[0]?.content).toBe("custom output");
  });
});
