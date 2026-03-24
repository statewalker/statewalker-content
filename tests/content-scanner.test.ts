import type { ContentSection } from "@repo/content-blocks";
import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { ContentScanner } from "../src/content-scanner.js";

/** Collect all events from an async generator. */
async function collectEvents(
  gen: AsyncGenerator<ContentSection>,
): Promise<ContentSection[]> {
  const events: ContentSection[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Extract events of a specific type. */
function ofType(events: ContentSection[], type: string): ContentSection[] {
  return events.filter((e) => e.props?.type === type);
}

describe("ContentScanner", () => {
  let trackingFiles: MemFilesApi;
  let scanner: ContentScanner;
  let files: MemFilesApi;

  beforeEach(() => {
    trackingFiles = new MemFilesApi();
    scanner = new ContentScanner({ trackingFiles });
    files = new MemFilesApi();
  });

  describe("scan — detect added files", () => {
    it("detects all files as content-changed on first scan", async () => {
      await writeText(files, "/root/a.txt", "hello");
      await writeText(files, "/root/b.txt", "world");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      const events = await collectEvents(
        scanner.scan({ collectionId: "docs" }),
      );

      const changed = ofType(events, "content-changed");
      expect(changed).toHaveLength(2);
      for (const e of changed) {
        expect(e.props?.collection).toBe("docs");
        expect(e.props?.uri).toBeTruthy();
      }
    });
  });

  describe("scan — no changes", () => {
    it("reports only scan-started and scan-done on re-scan", async () => {
      await writeText(files, "/root/a.txt", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      // First scan
      await collectEvents(scanner.scan({ collectionId: "docs" }));

      // Second scan — nothing changed
      const events = await collectEvents(
        scanner.scan({ collectionId: "docs" }),
      );
      const changed = ofType(events, "content-changed");
      expect(changed).toHaveLength(0);

      expect(ofType(events, "scan-started")).toHaveLength(1);
      expect(ofType(events, "scan-done")).toHaveLength(1);
    });
  });

  describe("scan — detect updates", () => {
    it("detects modified file as content-changed", async () => {
      await writeText(files, "/root/a.txt", "short");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      await collectEvents(scanner.scan({ collectionId: "docs" }));

      // Modify the file
      await writeText(
        files,
        "/root/a.txt",
        "this is a much longer version of the content",
      );

      const events = await collectEvents(
        scanner.scan({ collectionId: "docs" }),
      );
      const changed = ofType(events, "content-changed");
      expect(changed).toHaveLength(1);
    });
  });

  describe("scan — detect removals", () => {
    it("detects removed files as content-removed", async () => {
      await writeText(files, "/root/a.txt", "hello");
      await writeText(files, "/root/b.txt", "world");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      await collectEvents(scanner.scan({ collectionId: "docs" }));

      // Remove one file
      await files.remove("/root/b.txt");

      const events = await collectEvents(
        scanner.scan({ collectionId: "docs" }),
      );
      const removed = ofType(events, "content-removed");
      expect(removed).toHaveLength(1);
    });
  });

  describe("event order", () => {
    it("scan-started is first and scan-done is last", async () => {
      await writeText(files, "/root/a.txt", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      const events = await collectEvents(
        scanner.scan({ collectionId: "docs" }),
      );

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]?.props?.type).toBe("scan-started");
      expect(events[events.length - 1]?.props?.type).toBe("scan-done");
    });
  });

  describe("multiple collections", () => {
    it("scopes events to collection", async () => {
      const files2 = new MemFilesApi();

      await writeText(files, "/root/a.txt", "hello");
      await writeText(files2, "/data/x.csv", "1,2,3");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });
      scanner.addCollection({
        config: { collectionId: "data", files: files2, root: "/data" },
      });

      const docEvents = await collectEvents(
        scanner.scan({ collectionId: "docs" }),
      );
      const docChanged = ofType(docEvents, "content-changed");
      expect(docChanged).toHaveLength(1);
      expect(docChanged[0]?.props?.collection).toBe("docs");

      const dataEvents = await collectEvents(
        scanner.scan({ collectionId: "data" }),
      );
      const dataChanged = ofType(dataEvents, "content-changed");
      expect(dataChanged).toHaveLength(1);
      expect(dataChanged[0]?.props?.collection).toBe("data");

      // Removing a file in docs should not affect data
      await files.remove("/root/a.txt");
      const docEvents2 = await collectEvents(
        scanner.scan({ collectionId: "docs" }),
      );
      expect(ofType(docEvents2, "content-removed")).toHaveLength(1);

      const dataEvents2 = await collectEvents(
        scanner.scan({ collectionId: "data" }),
      );
      expect(ofType(dataEvents2, "content-changed")).toHaveLength(0);
      expect(ofType(dataEvents2, "content-removed")).toHaveLength(0);
    });
  });

  describe("removeCollection", () => {
    it("clears tracking data", async () => {
      await writeText(files, "/root/a.txt", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      await collectEvents(scanner.scan({ collectionId: "docs" }));

      await scanner.removeCollection({ collectionId: "docs" });

      // Re-add and scan — should see fresh content-changed
      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      const events = await collectEvents(
        scanner.scan({ collectionId: "docs" }),
      );
      const changed = ofType(events, "content-changed");
      expect(changed).toHaveLength(1);
    });
  });

  describe("cleanupRemoved", () => {
    it("purges old removal records", async () => {
      await writeText(files, "/root/a.txt", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      await collectEvents(scanner.scan({ collectionId: "docs" }));

      await files.remove("/root/a.txt");
      await collectEvents(scanner.scan({ collectionId: "docs" }));

      // Purge removals older than far future
      const purged = await scanner.cleanupRemoved({
        before: new Date(Date.now() + 100000).toISOString(),
      });
      expect(purged).toBe(1);
    });

    it("does not purge recent removals", async () => {
      await writeText(files, "/root/a.txt", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      await collectEvents(scanner.scan({ collectionId: "docs" }));

      await files.remove("/root/a.txt");
      await collectEvents(scanner.scan({ collectionId: "docs" }));

      // Purge with old threshold — should not remove
      const purged = await scanner.cleanupRemoved({
        before: "1970-01-01T00:00:00.000Z",
      });
      expect(purged).toBe(0);
    });
  });

  describe("scanAll", () => {
    it("scans all registered collections", async () => {
      const files2 = new MemFilesApi();

      await writeText(files, "/root/a.txt", "hello");
      await writeText(files2, "/data/x.csv", "1,2,3");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });
      scanner.addCollection({
        config: { collectionId: "data", files: files2, root: "/data" },
      });

      const events = await collectEvents(scanner.scanAll());
      const changed = ofType(events, "content-changed");
      expect(changed).toHaveLength(2);

      const collections = new Set(changed.map((e) => e.props?.collection));
      expect(collections.size).toBe(2);
    });
  });

  describe("filter option", () => {
    it("skips filtered paths", async () => {
      await writeText(files, "/root/.project/config.json", "{}");
      await writeText(files, "/root/readme.md", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      const events = await collectEvents(
        scanner.scan({
          collectionId: "docs",
          options: { filter: (path) => !path.includes(".project") },
        }),
      );

      const changed = ofType(events, "content-changed");
      expect(changed).toHaveLength(1);
    });
  });

  describe("skipHash option", () => {
    it("detects added files without hashing", async () => {
      await writeText(files, "/root/a.txt", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      const events = await collectEvents(
        scanner.scan({
          collectionId: "docs",
          options: { skipHash: true },
        }),
      );

      const changed = ofType(events, "content-changed");
      expect(changed).toHaveLength(1);
    });

    it("detects updates by size/lastModified without hashing", async () => {
      await writeText(files, "/root/a.txt", "short");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      await collectEvents(
        scanner.scan({
          collectionId: "docs",
          options: { skipHash: true },
        }),
      );

      await writeText(files, "/root/a.txt", "much longer content now");

      const events = await collectEvents(
        scanner.scan({
          collectionId: "docs",
          options: { skipHash: true },
        }),
      );
      const changed = ofType(events, "content-changed");
      expect(changed).toHaveLength(1);
    });

    it("reports no changes on re-scan of unchanged files", async () => {
      await writeText(files, "/root/a.txt", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      await collectEvents(
        scanner.scan({
          collectionId: "docs",
          options: { skipHash: true },
        }),
      );

      const events = await collectEvents(
        scanner.scan({
          collectionId: "docs",
          options: { skipHash: true },
        }),
      );
      const changed = ofType(events, "content-changed");
      expect(changed).toHaveLength(0);
    });
  });

  describe("getChanges since timestamp", () => {
    it("returns changes since a given time", async () => {
      const before = new Date(Date.now() - 1000).toISOString();

      await writeText(files, "/root/a.txt", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      await collectEvents(scanner.scan({ collectionId: "docs" }));

      const events = await collectEvents(
        scanner.getChanges({ collectionId: "docs", since: before }),
      );
      expect(events.length).toBeGreaterThan(0);
    });

    it("returns empty for future timestamp", async () => {
      await writeText(files, "/root/a.txt", "hello");

      scanner.addCollection({
        config: { collectionId: "docs", files, root: "/root" },
      });

      await collectEvents(scanner.scan({ collectionId: "docs" }));

      const events = await collectEvents(
        scanner.getChanges({
          collectionId: "docs",
          since: new Date(Date.now() + 100000).toISOString(),
        }),
      );
      expect(events).toHaveLength(0);
    });
  });
});
