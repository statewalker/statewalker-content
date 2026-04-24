import { createDefaultRegistry } from "@statewalker/content-extractors/extractors";
import { createFlexSearchIndexer } from "@statewalker/indexer-mem-flexsearch";
import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { createContentManager, type SyncEvent } from "../src/content-manager.js";

function setup() {
  const files = new MemFilesApi();
  const indexer = createFlexSearchIndexer();
  const extractors = createDefaultRegistry();
  const manager = createContentManager({
    files,
    statePrefix: "/.state/content",
    extractors,
    indexer,
    root: "/",
    filter: (p) => !p.startsWith("/.state/"),
    pauseMs: 0,
  });
  return { files, indexer, manager };
}

async function collectEvents(gen: AsyncGenerator<SyncEvent>): Promise<SyncEvent[]> {
  const events: SyncEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("content-manager orchestrator (ported from legacy integration test)", () => {
  it("syncs files through the full pipeline", async () => {
    const { files, manager } = setup();
    await writeText(files, "/readme.md", "# Hello\n\nThis is a readme file.");
    await writeText(
      files,
      "/guide.md",
      "# Guide\n\nHow to use this project.\n\n# Setup\n\nRun npm install.",
    );

    const events = await collectEvents(manager.sync());

    expect(events.find((e) => e.type === "sync-started")).toBeDefined();
    const done = events.find((e) => e.type === "sync-done");
    expect(done?.type === "sync-done" && done.stats.indexed).toBe(2);
    expect(done?.type === "sync-done" && done.stats.errors).toBe(0);
    expect(events.filter((e) => e.type === "file-indexed")).toHaveLength(2);

    await manager.close();
  });

  it("search finds indexed content", async () => {
    const { files, manager } = setup();
    await writeText(
      files,
      "/animals.md",
      "# Cats\n\nCats are furry animals that purr.\n\n# Dogs\n\nDogs are loyal companions.",
    );
    await writeText(
      files,
      "/plants.md",
      "# Roses\n\nRoses are red flowers.\n\n# Tulips\n\nTulips bloom in spring.",
    );

    await collectEvents(manager.sync());
    const hits = await manager.search({ queries: ["cats furry"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.uri).toContain("animals.md");

    await manager.close();
  });

  it("status reports file and index counts", async () => {
    const { files, manager } = setup();
    await writeText(files, "/a.md", "# A\n\nContent A.");
    await writeText(files, "/b.md", "# B\n\nContent B.");
    await writeText(files, "/c.txt", "Plain text content.");

    await collectEvents(manager.sync());

    const status = await manager.status();
    expect(status.files).toBe(3);
    expect(status.indexed).toBeGreaterThanOrEqual(2);

    await manager.close();
  });

  it("incremental sync skips unchanged files", async () => {
    const { files, manager } = setup();
    await writeText(files, "/doc.md", "# Doc\n\nOriginal content.");
    const events1 = await collectEvents(manager.sync());
    const done1 = events1.find((e) => e.type === "sync-done");
    expect(done1?.type === "sync-done" && done1.stats.indexed).toBe(1);

    const events2 = await collectEvents(manager.sync());
    const done2 = events2.find((e) => e.type === "sync-done");
    expect(done2?.type === "sync-done" && done2.stats.indexed).toBe(0);

    await manager.close();
  });

  it("clear removes all stores and the index", async () => {
    const { files, manager } = setup();
    await writeText(files, "/doc.md", "# Doc\n\nContent.");
    await collectEvents(manager.sync());
    const statusBefore = await manager.status();
    expect(statusBefore.files).toBe(1);

    await manager.clear();

    expect(await files.exists("/.state/content")).toBe(false);
    await manager.close();
  });

  it("returns empty results for search with no content", async () => {
    const { manager } = setup();
    const hits = await manager.search({ queries: ["anything"] });
    expect(hits).toEqual([]);
    await manager.close();
  });

  it("handles file removal", async () => {
    const { files, manager } = setup();
    await writeText(files, "/temp.md", "# Temporary\n\nWill be removed.");
    await collectEvents(manager.sync());
    const status1 = await manager.status();
    expect(status1.indexed).toBe(1);

    await files.remove("/temp.md");
    const events = await collectEvents(manager.sync());
    expect(events.filter((e) => e.type === "file-removed")).toHaveLength(1);

    await manager.close();
  });
});
