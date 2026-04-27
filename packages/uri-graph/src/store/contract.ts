import { beforeEach, describe, expect, it } from "vitest";
import type { Update } from "../types/update.js";
import type { GraphStore } from "./types.js";

/**
 * Shape returned by a backend's contract harness factory. Each call to `open()` opens
 * a store against the same backing (so persistence-boundary tests can re-open the
 * same data). `abandon(store)` simulates a crash by closing the store without committing
 * any in-flight transaction.
 */
export interface GraphStoreHarness {
  open(): Promise<GraphStore>;
  close(store: GraphStore): Promise<void>;
}

export type GraphStoreHarnessFactory = () => GraphStoreHarness;

/**
 * Drains an `AsyncIterable<T>` into an array. Helper for `find`-style scenarios.
 */
async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iterable) out.push(x);
  return out;
}

export function defineGraphStoreContract(name: string, factory: GraphStoreHarnessFactory): void {
  describe(`GraphStore contract: ${name}`, () => {
    let harness: GraphStoreHarness;
    let store: GraphStore;

    beforeEach(async () => {
      harness = factory();
      store = await harness.open();
    });

    describe("reads", () => {
      it("getState returns null for unknown URI", async () => {
        expect(await store.getState("file:///unknown")).toBeNull();
      });

      it("find yields matching URIs", async () => {
        await store.registerWorker({ name: "seed", version: "v1" });
        const stamp1 = await store.mintStamp();
        const txn = await store.beginTransaction({
          worker: "seed",
          version: "v1",
          scope: null,
          initialStamp: stamp1,
        });
        for (const path of ["a.md", "b.md", "c.txt"]) {
          await txn.applyUpdate({
            uri: `file:///${path}`,
            stamp: stamp1,
            status: "added",
            hash: `h:${path}`,
          });
        }
        await txn.commit();
        const matches = await drain(store.find("file:///%.md"));
        expect(matches.map((m) => m.uri).sort()).toEqual(["file:///a.md", "file:///b.md"]);
      });

      it("priorOutputs returns last successful run outputs for an input", async () => {
        await store.registerWorker({ name: "ext", version: "v1" });
        const inputUri = "file:///x.md";
        const inputStamp = await store.mintStamp();
        const seed = await store.beginTransaction({
          worker: "ext",
          version: "v1",
          scope: null,
          initialStamp: inputStamp,
        });
        await seed.applyUpdate({
          uri: inputUri,
          stamp: inputStamp,
          status: "added",
          hash: "ih",
        });
        await seed.commit();

        const outStamp = await store.mintStamp();
        const txn = await store.beginTransaction({
          worker: "ext",
          version: "v1",
          scope: inputUri,
          initialStamp: outStamp,
        });
        await txn.recordInputs([{ uri: inputUri, observedStamp: inputStamp }]);
        await txn.applyUpdate({
          uri: "text:///x.md",
          stamp: outStamp,
          status: "added",
          hash: "th",
        });
        await txn.commit();

        const prior = await store.priorOutputs("ext", inputUri);
        expect(prior.map((p) => p.uri)).toEqual(["text:///x.md"]);
      });
    });

    describe("logical transaction lifecycle", () => {
      it("commit promotes staged updates and clears staging", async () => {
        await store.registerWorker({ name: "w", version: "v1" });
        const s = await store.mintStamp();
        const txn = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s,
        });
        await txn.applyUpdate({ uri: "u://a", stamp: s, status: "added", hash: "1" });
        await txn.applyUpdate({ uri: "u://b", stamp: s, status: "added", hash: "2" });
        await txn.commit();
        expect((await store.getState("u://a"))?.stamp).toBe(s);
        expect((await store.getState("u://b"))?.stamp).toBe(s);
      });

      it("rollback discards staged updates", async () => {
        await store.registerWorker({ name: "w", version: "v1" });
        const s = await store.mintStamp();
        const txn = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s,
        });
        await txn.applyUpdate({ uri: "u://a", stamp: s, status: "added", hash: "1" });
        await txn.applyUpdate({ uri: "u://b", stamp: s, status: "added", hash: "2" });
        await txn.rollback();
        expect(await store.getState("u://a")).toBeNull();
        expect(await store.getState("u://b")).toBeNull();
      });

      it("reuse after commit throws", async () => {
        await store.registerWorker({ name: "w", version: "v1" });
        const s = await store.mintStamp();
        const txn = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s,
        });
        await txn.commit();
        await expect(
          txn.applyUpdate({ uri: "u://a", stamp: s, status: "added" }),
        ).rejects.toThrow();
      });

      it("reuse after rollback throws", async () => {
        await store.registerWorker({ name: "w", version: "v1" });
        const s = await store.mintStamp();
        const txn = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s,
        });
        await txn.rollback();
        await expect(txn.commit()).rejects.toThrow();
      });

      it("commit twice throws", async () => {
        await store.registerWorker({ name: "w", version: "v1" });
        const s = await store.mintStamp();
        const txn = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s,
        });
        await txn.commit();
        await expect(txn.commit()).rejects.toThrow();
      });
    });

    describe("no-op rule", () => {
      it("identical content does not bump the stamp", async () => {
        await store.registerWorker({ name: "w", version: "v1" });
        const s1 = await store.mintStamp();
        const txn1 = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s1,
        });
        await txn1.applyUpdate({
          uri: "u://x",
          stamp: s1,
          status: "added",
          hash: "h",
        });
        await txn1.commit();

        const s2 = await store.mintStamp();
        const txn2 = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s2,
        });
        await txn2.applyUpdate({
          uri: "u://x",
          stamp: s2,
          status: "added",
          hash: "h",
        });
        await txn2.commit();

        expect((await store.getState("u://x"))?.stamp).toBe(s1);
      });

      it("changed content bumps the stamp", async () => {
        await store.registerWorker({ name: "w", version: "v1" });
        const s1 = await store.mintStamp();
        const txn1 = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s1,
        });
        await txn1.applyUpdate({
          uri: "u://x",
          stamp: s1,
          status: "added",
          hash: "h1",
        });
        await txn1.commit();

        const s2 = await store.mintStamp();
        const txn2 = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s2,
        });
        await txn2.applyUpdate({
          uri: "u://x",
          stamp: s2,
          status: "updated",
          hash: "h2",
        });
        await txn2.commit();

        expect((await store.getState("u://x"))?.stamp).toBe(s2);
      });
    });

    describe("stamps", () => {
      it("two consecutive stamps differ", async () => {
        const a = await store.mintStamp();
        const b = await store.mintStamp();
        expect(b).toBeGreaterThan(a);
      });

      it("ten concurrent stamps are distinct", async () => {
        const stamps = await Promise.all(Array.from({ length: 10 }, () => store.mintStamp()));
        const set = new Set(stamps);
        expect(set.size).toBe(10);
      });
    });

    describe("worker registry", () => {
      it("register same name and version is idempotent", async () => {
        const r1 = await store.registerWorker({ name: "w", version: "v1" });
        const r2 = await store.registerWorker({ name: "w", version: "v1" });
        expect(r1.versionChanged).toBe(true); // first register is technically a change
        expect(r2.versionChanged).toBe(false);
      });

      it("register with bumped version reports versionChanged", async () => {
        await store.registerWorker({ name: "w", version: "v1" });
        const r = await store.registerWorker({ name: "w", version: "v2" });
        expect(r.versionChanged).toBe(true);
      });
    });

    describe("recovery", () => {
      it("recoverOrphans is a no-op when no running runs exist", async () => {
        const result = await store.recoverOrphans();
        expect(result.cancelled).toBe(0);
        expect(result.pendingRowsDropped).toBe(0);
      });

      it("a crashed run leaves no committed state on next open", async () => {
        await store.registerWorker({ name: "w", version: "v1" });
        const s = await store.mintStamp();
        const txn = await store.beginTransaction({
          worker: "w",
          version: "v1",
          scope: null,
          initialStamp: s,
        });
        await txn.applyUpdate({
          uri: "u://x",
          stamp: s,
          status: "added",
          hash: "h",
        });
        // Don't commit. Force-close.
        await harness.close(store);

        // Reopen — `openGraphStore` runs recoverOrphans automatically.
        store = await harness.open();
        expect(await store.getState("u://x")).toBeNull();
        // A subsequent recoverOrphans call is a no-op (idempotent).
        const second = await store.recoverOrphans();
        expect(second.cancelled).toBe(0);
      });
    });
  });
}

/** Minimal fixture for tests that just need to seed updates. */
export function buildSeedUpdates(uris: string[], stamp: number): Update[] {
  return uris.map((uri) => ({
    uri,
    stamp,
    status: "added" as const,
    hash: `h:${uri}`,
  }));
}
