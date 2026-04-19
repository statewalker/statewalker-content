import { describe, expect, it } from "vitest";
import { escapeBlockSeparators, unescapeBlockSeparators } from "../../src/parser/escape.js";

describe("escapeBlockSeparators", () => {
  it("should escape --- at the start of a line", () => {
    expect(escapeBlockSeparators("---")).toBe("\\---");
  });

  it("should escape multiple --- lines", () => {
    const input = "before\n---\nafter\n---\nend";
    expect(escapeBlockSeparators(input)).toBe("before\n\\---\nafter\n\\---\nend");
  });

  it("should not escape --- in the middle of a line", () => {
    expect(escapeBlockSeparators("foo --- bar")).toBe("foo --- bar");
  });
});

describe("unescapeBlockSeparators", () => {
  it("should unescape \\--- at the start of a line", () => {
    expect(unescapeBlockSeparators("\\---")).toBe("---");
  });

  it("should unescape multiple \\--- lines", () => {
    const input = "before\n\\---\nafter\n\\---\nend";
    expect(unescapeBlockSeparators(input)).toBe("before\n---\nafter\n---\nend");
  });
});
