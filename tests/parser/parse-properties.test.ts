import { describe, expect, it } from "vitest";
import {
  parseProperties,
  serializeProperties,
} from "../../src/parser/parse-properties.js";

describe("parseProperties", () => {
  it("should parse key-value pairs", () => {
    const result = parseProperties("id: 123\ntime: 2026-03-15T12:00:00Z");
    expect(result).toEqual({
      id: "123",
      time: "2026-03-15T12:00:00Z",
    });
  });

  it("should skip empty lines", () => {
    const result = parseProperties("id: 123\n\ntime: 2026-03-15T12:00:00Z");
    expect(result).toEqual({
      id: "123",
      time: "2026-03-15T12:00:00Z",
    });
  });

  it("should skip lines without colons", () => {
    const result = parseProperties("id: 123\nno colon here\ntime: abc");
    expect(result).toEqual({ id: "123", time: "abc" });
  });

  it("should handle values with colons", () => {
    const result = parseProperties("uri: collection1:/path/to/file");
    expect(result).toEqual({ uri: "collection1:/path/to/file" });
  });

  it("should return empty object for empty string", () => {
    expect(parseProperties("")).toEqual({});
  });
});

describe("serializeProperties", () => {
  it("should serialize with id first, then alphabetical", () => {
    const result = serializeProperties({
      time: "2026-03-15T12:00:00Z",
      id: "123",
      role: "user",
    });
    expect(result).toBe("id: 123\nrole: user\ntime: 2026-03-15T12:00:00Z");
  });

  it("should omit undefined values", () => {
    const result = serializeProperties({
      id: "123",
      role: undefined,
      time: "abc",
    });
    expect(result).toBe("id: 123\ntime: abc");
  });

  it("should handle properties without id", () => {
    const result = serializeProperties({
      role: "user",
      time: "abc",
    });
    expect(result).toBe("role: user\ntime: abc");
  });

  it("should return empty string for empty object", () => {
    expect(serializeProperties({})).toBe("");
  });
});
