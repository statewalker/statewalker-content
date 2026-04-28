import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { drain } from "../../src/orchestrator/drain.js";
import type { GraphStore } from "../../src/store/types.js";
import type { Update } from "../../src/types/update.js";
import { createHtmlExtractor } from "../../src/workers/extractors/html-extractor.js";
import { createMarkdownExtractor } from "../../src/workers/extractors/markdown-extractor.js";
import { createPlainTextExtractor } from "../../src/workers/extractors/plain-text-extractor.js";
import { createFileWatcher } from "../../src/workers/file-watcher.js";
import { openTempMemoryStore } from "../helpers.js";

describe("extractors", () => {
  let store: GraphStore;
  let files: MemFilesApi;

  beforeEach(async () => {
    files = new MemFilesApi();
    store = await openTempMemoryStore();
  });

  async function runWatcher(): Promise<void> {
    const watcher = createFileWatcher({ files, rootPath: "/" });
    await store.registerWorker({
      name: watcher.name,
      version: watcher.version,
    });
    async function* tick(): AsyncIterableIterator<Update> {
      yield { uri: `tick://${watcher.name}`, stamp: 0, status: "updated" };
    }
    await drain(watcher, tick(), store);
  }

  async function runExtractor(
    extractor: ReturnType<typeof createMarkdownExtractor>,
  ): Promise<void> {
    await store.registerWorker({
      name: extractor.name,
      version: extractor.version,
    });
    // Synthesize input from committed file:// URIs.
    const inputs: Update[] = [];
    for await (const v of store.find("file:///%")) {
      inputs.push({
        uri: v.uri,
        stamp: v.stamp,
        status: v.status,
        hash: v.hash,
        attributes: v.attributes,
      });
    }
    async function* feed(): AsyncIterableIterator<Update> {
      for (const u of inputs) yield u;
    }
    await drain(extractor, feed(), store);
  }

  describe("markdown", () => {
    it("matches only .md files and emits text://", async () => {
      await writeText(files, "/a.md", "# Heading\n\nbody");
      await writeText(files, "/b.txt", "text only");
      await writeText(files, "/c.png", "binary");
      await runWatcher();
      await runExtractor(createMarkdownExtractor({ files }));

      const textViews: string[] = [];
      for await (const v of store.find("text:///%")) textViews.push(v.uri);
      expect(textViews.sort()).toEqual(["text:///a.md"]);
    });

    it("two files with identical content yield identical hashes", async () => {
      await writeText(files, "/x.md", "same body");
      await writeText(files, "/y.md", "same body");
      await runWatcher();
      await runExtractor(createMarkdownExtractor({ files }));
      const x = await store.getState("text:///x.md");
      const y = await store.getState("text:///y.md");
      expect(x?.hash).toBe(y?.hash);
      expect(x?.hash).toBeTruthy();
    });

    it("removed source cascades to text URI", async () => {
      await writeText(files, "/a.md", "body");
      await runWatcher();
      await runExtractor(createMarkdownExtractor({ files }));
      expect((await store.getState("text:///a.md"))?.status).toBe("added");

      await files.remove("/a.md");
      await runWatcher();
      await runExtractor(createMarkdownExtractor({ files }));
      expect((await store.getState("text:///a.md"))?.status).toBe("removed");
    });

    it("ignores non-md files in the input stream", async () => {
      await writeText(files, "/c.png", "binary");
      await runWatcher();
      await runExtractor(createMarkdownExtractor({ files }));
      expect(await store.getState("text:///c.png")).toBeNull();
    });
  });

  describe("plain text", () => {
    it("matches only .txt files", async () => {
      await writeText(files, "/a.md", "md");
      await writeText(files, "/b.txt", "plain");
      await runWatcher();
      await runExtractor(createPlainTextExtractor({ files }));
      const textViews: string[] = [];
      for await (const v of store.find("text:///%")) textViews.push(v.uri);
      expect(textViews).toEqual(["text:///b.txt"]);
    });
  });

  describe("html", () => {
    it("strips tags and emits plain text", async () => {
      await writeText(files, "/a.html", "<h1>Hi</h1><p>world</p>");
      await runWatcher();
      await runExtractor(createHtmlExtractor({ files }));
      const view = await store.getState("text:///a.html");
      expect(view).not.toBeNull();
      const text = (view?.attributes as Record<string, unknown>)?.text as string;
      expect(text).not.toContain("<");
      expect(text).toContain("Hi");
      expect(text).toContain("world");
    });
  });
});
