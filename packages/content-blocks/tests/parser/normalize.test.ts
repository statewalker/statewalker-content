import { describe, expect, it } from "vitest";
import { normalizeForContentHash } from "../../src/parser/normalize.js";

describe("normalizeForContentHash", () => {
  it("should exclude id from normalized content", () => {
    const result = normalizeForContentHash(
      { id: "123", role: "user", time: "2026-03-15T12:00:00Z" },
      "Hello",
    );
    expect(result).not.toContain("id:");
    expect(result).toContain("role: user");
    expect(result).toContain("time: 2026-03-15T12:00:00Z");
    expect(result).toContain("Hello");
  });

  it("should sort properties alphabetically", () => {
    const result = normalizeForContentHash({ id: "123", time: "abc", role: "user" }, "Content");
    const roleIdx = result.indexOf("role:");
    const timeIdx = result.indexOf("time:");
    expect(roleIdx).toBeLessThan(timeIdx);
  });

  it("should escape block separators in content", () => {
    const result = normalizeForContentHash({ role: "user" }, "Before\n---\nAfter");
    expect(result).toContain("\\---");
  });

  it("should produce consistent output for same input", () => {
    const props = { id: "x", role: "user", time: "t1", type: "msg" };
    const content = "Hello world";
    const a = normalizeForContentHash(props, content);
    const b = normalizeForContentHash(props, content);
    expect(a).toBe(b);
  });
});
