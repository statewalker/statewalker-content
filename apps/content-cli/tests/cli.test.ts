import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FIXTURES_DIR = resolve(import.meta.dirname, "../../indexer-tests/src/fixtures/documents");
const INDEX_DIR = resolve(FIXTURES_DIR, ".content-index");
const CLI = resolve(import.meta.dirname, "../src/cli.ts");

function run(...args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, FIXTURES_DIR, ...args], {
    encoding: "utf-8",
    timeout: 30_000,
  });
}

describe("content-cli", () => {
  beforeAll(() => {
    // Clean up any leftover index
    if (existsSync(INDEX_DIR)) rmSync(INDEX_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(INDEX_DIR)) rmSync(INDEX_DIR, { recursive: true });
  });

  it("syncs fixture documents", () => {
    const output = run("sync");
    expect(output).toContain("indexed");
    expect(output).toContain("16 indexed");
    expect(output).toContain("0 errors");
  });

  it("reports correct document count", () => {
    const output = run("status");
    expect(output).toContain("Documents: 16");
  });

  it("finds cooking-pasta for pasta query", () => {
    const output = run("search", "how to make pasta dough at home", "--limit", "3");
    expect(output).toContain("cooking-pasta.md");
    // Cooking pasta should be the top result
    const firstResult = output.split("---")[1] ?? "";
    expect(firstResult).toContain("cooking-pasta.md");
  });

  it("finds javascript-async for async error query", () => {
    const output = run("search", "handling errors in asynchronous JavaScript code", "--limit", "3");
    expect(output).toContain("javascript-async.md");
    const firstResult = output.split("---")[1] ?? "";
    expect(firstResult).toContain("javascript-async.md");
  });

  it("finds quantum-computing for quantum bits query", () => {
    const output = run("search", "how do quantum bits differ from classical bits", "--limit", "5");
    expect(output).toContain("quantum-computing.md");
  });

  it("finds climate-change for global warming query", () => {
    const output = run(
      "search",
      "what causes global warming and how to reduce emissions",
      "--limit",
      "5",
    );
    expect(output).toContain("climate-change.md");
  });

  it("finds ancient-egypt for pyramids query", () => {
    const output = run("search", "how were the pyramids of Giza built", "--limit", "5");
    expect(output).toContain("ancient-egypt.md");
  });

  it("finds architecture-styles for gothic query", () => {
    const output = run(
      "search",
      "characteristics of gothic cathedral architecture",
      "--limit",
      "5",
    );
    expect(output).toContain("architecture-styles.md");
  });

  it("re-sync is incremental (0 changes)", () => {
    const output = run("sync");
    expect(output).toContain("0 indexed");
    expect(output).toContain("0 removed");
  });

  it("clears the index", () => {
    const output = run("clear");
    expect(output).toContain("Index cleared");
    const status = run("status");
    expect(status).toContain("Documents: 0");
  });
});
