import { describe, expect, it } from "vitest";
import { sha1Bytes, sha1Uuid } from "../../src/ids/index.js";

describe("sha1Uuid", () => {
  it("should generate a 40-character hex string", async () => {
    const result = await sha1Uuid("hello world");
    expect(result).toHaveLength(40);
    expect(result).toMatch(/^[0-9a-f]{40}$/);
  });

  it("should be deterministic", async () => {
    const a = await sha1Uuid("test content");
    const b = await sha1Uuid("test content");
    expect(a).toBe(b);
  });

  it("should produce different IDs for different content", async () => {
    const a = await sha1Uuid("content A");
    const b = await sha1Uuid("content B");
    expect(a).not.toBe(b);
  });

  it("should match known SHA1 hash for 'hello world'", async () => {
    // Known SHA1 for "hello world"
    const result = await sha1Uuid("hello world");
    expect(result).toBe("2aae6c35c94fcfb415dbe95f408b9ce91ee846ed");
  });

  it("should handle empty string", async () => {
    const result = await sha1Uuid("");
    expect(result).toHaveLength(40);
    // Known SHA1 for ""
    expect(result).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });
});

describe("sha1Bytes", () => {
  it("should generate a 40-character hex string from bytes", async () => {
    const data = new TextEncoder().encode("hello world");
    const result = await sha1Bytes(data);
    expect(result).toHaveLength(40);
    expect(result).toBe("2aae6c35c94fcfb415dbe95f408b9ce91ee846ed");
  });
});
