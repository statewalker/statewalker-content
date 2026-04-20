#!/usr/bin/env node

import { resolve } from "node:path";
import { createDefaultRegistry } from "@statewalker/content-extractors/extractors";
import { createContentManager } from "@statewalker/content-manager";
import { FilesScanRegistry } from "@statewalker/content-scanner";
import type { IndexerPersistence, PersistenceEntry } from "@statewalker/indexer-api";
import { createFlexSearchIndexer } from "@statewalker/indexer-mem-flexsearch";
import type { FilesApi } from "@statewalker/webrun-files";
import { NodeFilesApi } from "@statewalker/webrun-files-node";

const DEFAULT_SYSTEM_FOLDER = ".settings";

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
  --limit <n>         Max search results (default: 20)
  --help              Show this help`);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let command = "sync";
  let systemFolder = DEFAULT_SYSTEM_FOLDER;
  let limit = 20;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--system") {
      systemFolder = args[++i] ?? DEFAULT_SYSTEM_FOLDER;
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

  return { command, rootPath, systemFolder, limit, positional };
}

/** File-backed IndexerPersistence using FilesApi */
function createFilePersistence(files: FilesApi, basePath: string): IndexerPersistence {
  return {
    async save(entries: AsyncIterable<PersistenceEntry>): Promise<void> {
      for await (const entry of entries) {
        const safeName = entry.name.replace(/[^a-zA-Z0-9_-]/g, (c) => `_${c.charCodeAt(0)}_`);
        const filePath = `${basePath}/${safeName}.bin`;
        await files.write(filePath, entry.content);
      }
    },
    async *load(): AsyncIterable<PersistenceEntry> {
      try {
        for await (const entry of files.list(basePath)) {
          if (entry.name?.endsWith(".bin")) {
            const safe = entry.name.slice(0, -4);
            const name = safe.replace(/_(\d+)_/g, (_: string, code: string) =>
              String.fromCharCode(Number.parseInt(code, 10)),
            );
            const path = `${basePath}/${entry.name}`;
            yield {
              name,
              content: (async function* () {
                yield* files.read(path);
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
  const { command, rootPath, systemFolder, limit, positional } = parseArgs(process.argv);

  const rootDir = resolve(rootPath);
  const files = new NodeFilesApi({ rootDir });
  const indexDir = `/${systemFolder}/indexer`;
  const scanDir = `/${systemFolder}/scan`;

  const persistence = createFilePersistence(files, indexDir);
  const indexer = createFlexSearchIndexer({ persistence });
  const registry = new FilesScanRegistry({ files, prefix: scanDir });
  const extractors = createDefaultRegistry();

  const manager = createContentManager({
    registry,
    indexer,
    files,
    extractors,
    root: "/",
    filter: (path: string) => !path.startsWith(`/${systemFolder}/`),
  });

  switch (command) {
    case "sync": {
      for await (const event of manager.sync()) {
        switch (event.type) {
          case "sync-started":
            console.log("Scanning...");
            break;
          case "file-indexed":
            console.log(`  indexed: ${event.uri}`);
            break;
          case "file-removed":
            console.log(`  removed: ${event.uri}`);
            break;
          case "file-error":
            console.error(`  error: ${event.uri} - ${event.error}`);
            break;
          case "sync-done":
            console.log(
              `Done. ${event.stats.indexed} indexed, ${event.stats.removed} removed, ${event.stats.errors} errors (${event.stats.scanned} scanned)`,
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
      const hits = await manager.search({ queries: [query], topK: limit });
      if (hits.length === 0) {
        console.log("No results found.");
      } else {
        for (const hit of hits) {
          console.log(`\n--- ${hit.uri} (score: ${hit.score.toFixed(3)}) ---`);
          console.log(`  ${hit.content.slice(0, 200)}${hit.content.length > 200 ? "..." : ""}`);
        }
        console.log(`\n${hits.length} result(s)`);
      }
      break;
    }

    case "status": {
      const status = await manager.status();
      console.log(`Documents: ${status.indexed}`);
      break;
    }

    case "clear": {
      await manager.clear();
      // Also clear indexer persistence files
      try {
        for await (const entry of files.list(indexDir)) {
          if (entry.name) {
            await files.remove(`${indexDir}/${entry.name}`);
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
