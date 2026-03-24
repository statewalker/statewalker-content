#!/usr/bin/env node

import { resolve } from "node:path";
import { createDefaultRegistry } from "@repo/content-extractors/extractors";
import type { ContentStorage } from "@repo/content-manager";
import {
  ContentManagerScanner,
  createContentManager,
} from "@repo/content-manager";
import { ContentScanner } from "@repo/content-scanner";
import type { IndexerPersistence, PersistenceEntry } from "@repo/indexer-api";
import { createFlexSearchIndexer } from "@repo/indexer-mem-flexsearch";
import type { FilesApi } from "@statewalker/webrun-files";
import { readFile } from "@statewalker/webrun-files";
import { NodeFilesApi } from "@statewalker/webrun-files-node";

async function writeBytes(
  files: FilesApi,
  path: string,
  data: Uint8Array,
): Promise<void> {
  await files.write(path, [data]);
}

const DEFAULT_SYSTEM_FOLDER = ".content-index";

function printUsage(): void {
  console.log(`Usage: content-cli <path> [command] [options]

Arguments:
  <path>              Root directory to index (required)

Commands:
  sync                Scan and index files (default)
  search <query>      Search indexed content
  status              Show index statistics
  clear               Delete index and start fresh

Options:
  --system <name>     System folder name (default: ${DEFAULT_SYSTEM_FOLDER})
  --collection <id>   Collection identifier (default: default)
  --limit <n>         Max search results (default: 20)
  --help              Show this help`);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let command = "sync";
  let systemFolder = DEFAULT_SYSTEM_FOLDER;
  let collectionId = "default";
  let limit = 20;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--system") {
      systemFolder = args[++i] ?? DEFAULT_SYSTEM_FOLDER;
    } else if (arg === "--collection") {
      collectionId = args[++i] ?? "default";
    } else if (arg === "--limit") {
      limit = Number.parseInt(args[++i] ?? "20", 10) || 20;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  const rootPath = positional.shift();
  if (!rootPath) {
    console.error("Error: root directory path is required");
    printUsage();
    process.exit(1);
  }

  const first = positional[0];
  if (
    first === "sync" ||
    first === "scan" ||
    first === "search" ||
    first === "status" ||
    first === "clear"
  ) {
    command = first === "scan" ? "sync" : first;
    positional.shift();
  }

  return { command, rootPath, systemFolder, collectionId, limit, positional };
}

/** File-backed ContentStorage using FilesApi */
function createFileStorage(files: FilesApi, basePath: string): ContentStorage {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function keyToPath(key: string): string {
    const safe = key.replace(
      /[^a-zA-Z0-9._-]/g,
      (ch) => `_${ch.charCodeAt(0)}_`,
    );
    return `${basePath}/${safe}.json`;
  }

  return {
    async get(key: string) {
      try {
        const bytes = await readFile(files, keyToPath(key));
        return dec.decode(bytes);
      } catch {
        return null;
      }
    },
    async set(key: string, content: string) {
      await writeBytes(files, keyToPath(key), enc.encode(content));
    },
    async delete(key: string) {
      try {
        await files.remove(keyToPath(key));
      } catch {
        // ignore if not found
      }
    },
    async *list() {
      try {
        for await (const entry of files.list(basePath)) {
          if (entry.name?.endsWith(".json")) {
            // Decode the safe name back to key
            const safe = entry.name.slice(0, -5);
            const key = safe.replace(/_(\d+)_/g, (_, code) =>
              String.fromCharCode(Number.parseInt(code, 10)),
            );
            yield key;
          }
        }
      } catch {
        // directory doesn't exist yet
      }
    },
  };
}

/** File-backed IndexerPersistence using FilesApi */
function createFilePersistence(
  files: FilesApi,
  basePath: string,
): IndexerPersistence {
  return {
    async save(entries: AsyncIterable<PersistenceEntry>): Promise<void> {
      for await (const entry of entries) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of entry.content) {
          chunks.push(chunk);
        }
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const data = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.length;
        }
        const safe = entry.name.replace(
          /[^a-zA-Z0-9._-]/g,
          (ch) => `_${ch.charCodeAt(0)}_`,
        );
        await writeBytes(files, `${basePath}/${safe}.bin`, data);
      }
      // Save manifest of entry names
      const manifest: string[] = [];
      for await (const entry of files.list(basePath)) {
        if (entry.name?.endsWith(".bin")) {
          manifest.push(entry.name.slice(0, -4));
        }
      }
    },
    async *load(): AsyncIterable<PersistenceEntry> {
      try {
        for await (const entry of files.list(basePath)) {
          if (entry.name?.endsWith(".bin")) {
            const safe = entry.name.slice(0, -4);
            const name = safe.replace(/_(\d+)_/g, (_, code) =>
              String.fromCharCode(Number.parseInt(code, 10)),
            );
            const path = `${basePath}/${entry.name}`;
            yield {
              name,
              content: (async function* () {
                yield await readFile(files, path);
              })(),
            };
          }
        }
      } catch {
        // directory doesn't exist yet
      }
    },
  };
}

async function main() {
  const { command, rootPath, systemFolder, collectionId, limit, positional } =
    parseArgs(process.argv);

  const rootDir = resolve(rootPath);
  const files = new NodeFilesApi({ rootDir });
  const trackingDir = `/${systemFolder}/tracking`;
  const storageDir = `/${systemFolder}/storage`;
  const indexDir = `/${systemFolder}/indexer`;

  const persistence = createFilePersistence(files, indexDir);
  const indexer = createFlexSearchIndexer({ persistence });
  const storage = createFileStorage(files, storageDir);
  const manager = createContentManager({ indexer, storage });

  switch (command) {
    case "sync": {
      const scanner = new ContentScanner({
        trackingFiles: files,
        prefix: trackingDir,
      });
      scanner.addCollection({
        config: { collectionId, files, root: "/" },
      });

      const extractors = createDefaultRegistry();
      const cmScanner = new ContentManagerScanner({
        contentManager: manager,
        scanner,
        extractors,
        files,
        collectionId,
      });

      for await (const event of cmScanner.scan()) {
        switch (event.type) {
          case "scan-started":
            console.log("Scanning...");
            break;
          case "file-changed":
            console.log(`  indexed: ${event.uri}`);
            break;
          case "file-removed":
            console.log(`  removed: ${event.uri}`);
            break;
          case "file-skipped":
            break;
          case "file-error":
            console.error(`  error: ${event.uri} - ${event.error}`);
            break;
          case "scan-done":
            console.log(
              `Done. ${event.stats.changed} indexed, ${event.stats.removed} removed, ${event.stats.errors} errors (${event.stats.scanned} scanned)`,
            );
            break;
        }
      }
      break;
    }

    case "search": {
      const query = positional.join(" ");
      if (!query) {
        console.error("Error: search requires a query argument");
        console.error("Usage: content-cli <path> search <query>");
        process.exit(1);
      }
      const hits = await manager.search(query, { topK: limit });
      if (hits.length === 0) {
        console.log("No results found.");
      } else {
        for (const hit of hits) {
          console.log(`\n--- ${hit.uri} (score: ${hit.score.toFixed(3)}) ---`);
          if (hit.title) console.log(`  Title: ${hit.title}`);
          console.log(
            `  ${hit.content.slice(0, 200)}${hit.content.length > 200 ? "..." : ""}`,
          );
        }
        console.log(`\n${hits.length} result(s)`);
      }
      break;
    }

    case "status": {
      let docCount = 0;
      for await (const key of storage.list()) {
        if (key.startsWith("doc:")) {
          docCount++;
        }
      }
      console.log(`Documents: ${docCount}`);
      break;
    }

    case "clear": {
      const keys: string[] = [];
      for await (const key of storage.list()) {
        keys.push(key);
      }
      for (const key of keys) {
        await storage.delete(key);
      }
      // Also clear indexer persistence
      try {
        for await (const entry of files.list(`/${systemFolder}/indexer`)) {
          if (entry.name) {
            await files.remove(`/${systemFolder}/indexer/${entry.name}`);
          }
        }
      } catch {
        // ignore
      }
      console.log("Index cleared.");
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
    }
  }

  await manager.close();
  await indexer.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
