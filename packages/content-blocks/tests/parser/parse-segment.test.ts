import { describe, expect, it } from "vitest";
import { parseSegment } from "../../src/parser/parse-segment.js";

describe("parseSegment", () => {
  it("should parse properties and content", () => {
    const input = "id: 123\nrole: user\n\nHello, world!";
    const result = parseSegment(input);
    expect(result.props).toEqual({ id: "123", role: "user" });
    expect(result.content).toBe("Hello, world!");
  });

  it("should handle segment with properties only (no content)", () => {
    const input = "id: 123\nrole: system";
    const result = parseSegment(input);
    expect(result.props).toEqual({ id: "123", role: "system" });
    expect(result.content).toBe("");
  });

  it("should unescape \\--- in content", () => {
    const input = "id: 123\n\nBefore\n\\---\nAfter";
    const result = parseSegment(input);
    expect(result.content).toBe("Before\n---\nAfter");
  });

  it("should trim trailing whitespace from content", () => {
    const input = "id: 123\n\nContent   \n  \n";
    const result = parseSegment(input);
    expect(result.content).toBe("Content");
  });

  it("should handle leading newlines", () => {
    const input = "\nid: 123\n\nContent";
    const result = parseSegment(input);
    expect(result.props).toEqual({ id: "123" });
    expect(result.content).toBe("Content");
  });

  it("should handle multiline content", () => {
    const input = "role: user\n\nLine 1\nLine 2\nLine 3";
    const result = parseSegment(input);
    expect(result.content).toBe("Line 1\nLine 2\nLine 3");
  });
});
