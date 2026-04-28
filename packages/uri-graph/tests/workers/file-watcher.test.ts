import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { drain } from "../../src/orchestrator/drain.js";
import type { GraphStore } from "../../src/store/types.js";
import type { Update } from "../../src/types/update.js";
import { createFileWatcher } from "../../src/workers/file-watcher.js";
import { openTempMemoryStore } from "../helpers.js";

describe("file watcher", () => {
  let store: GraphStore;
  let files: MemFilesApi;

  beforeEach(async () => {
    files = new MemFilesApi();
    store = await openTempMemoryStore();
  });

  async function* singleTick(): AsyncIterableIterator<Update> {
    yield { uri: "tick://file-watcher", stamp: 0, status: "updated" };
  }

  async function runOnce(rootPath: string): Promise<void> {
    const watcher = createFileWatcher({ files, rootPath });
    await store.registerWorker({
      name: watcher.name,
      version: watcher.version,
    });
    await drain(watcher, singleTick(), store);
  }

  async function fileUris(): Promise<string[]> {
    const out: string[] = [];
    for await (const v of store.find("file:///%")) out.push(v.uri);
    return out.sort();
  }

  it("scans all files, not just one extension", async () => {
    await writeText(files, "/a.md", "hello");
    await writeText(files, "/b.txt", "world");
    await writeText(files, "/c.png", "binary-ish");
    await writeText(files, "/d.pdf", "blob");
    await runOnce("/");
    expect(await fileUris()).toEqual([
      "file:///a.md",
      "file:///b.txt",
      "file:///c.png",
      "file:///d.pdf",
    ]);
  });

  it("emits added on first sighting and nothing on second sighting if unchanged", async () => {
    await writeText(files, "/a.md", "hello");
    await runOnce("/");
    const firstStamp = (await store.getState("file:///a.md"))?.stamp;
    await runOnce("/");
    const secondStamp = (await store.getState("file:///a.md"))?.stamp;
    expect(secondStamp).toBe(firstStamp);
  });

  it("emits update when file mtime/size changes", async () => {
    await writeText(files, "/a.md", "hello");
    await runOnce("/");
    const before = await store.getState("file:///a.md");
    // re-write with different content (different size)
    await new Promise((r) => setTimeout(r, 5));
    await writeText(files, "/a.md", "hello world");
    await runOnce("/");
    const after = await store.getState("file:///a.md");
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (before && after) {
      expect(after.stamp).toBeGreaterThan(before.stamp);
    }
  });

  it("emits removed when file is deleted", async () => {
    await writeText(files, "/a.md", "hello");
    await runOnce("/");
    expect((await store.getState("file:///a.md"))?.status).toBe("added");
    await files.remove("/a.md");
    await runOnce("/");
    expect((await store.getState("file:///a.md"))?.status).toBe("removed");
  });

  it("does not read file bytes", async () => {
    await writeText(files, "/a.md", "hello");
    let readCalled = false;
    const wrappedFiles = new Proxy(files, {
      get(target, prop, receiver) {
        if (prop === "read") {
          return (...args: unknown[]) => {
            readCalled = true;
            // biome-ignore lint/suspicious/noExplicitAny: proxy passthrough
            return (target as any).read(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const watcher = createFileWatcher({ files: wrappedFiles, rootPath: "/" });
    await store.registerWorker({
      name: watcher.name,
      version: watcher.version,
    });
    await drain(watcher, singleTick(), store);
    expect(readCalled).toBe(false);
  });

  it("hash format is size:mtime", async () => {
    await writeText(files, "/a.md", "hello");
    await runOnce("/");
    const view = await store.getState("file:///a.md");
    expect(view?.hash).toMatch(/^\d+:\d+$/);
  });

  it("empty FS yields nothing", async () => {
    await runOnce("/");
    expect(await fileUris()).toEqual([]);
  });

  it("skips directories", async () => {
    await writeText(files, "/sub/a.md", "hello");
    await runOnce("/");
    const uris = await fileUris();
    expect(uris).toEqual(["file:///sub/a.md"]);
    // No URI for the directory itself.
    expect(uris.some((u) => u.endsWith("/sub"))).toBe(false);
  });
});
