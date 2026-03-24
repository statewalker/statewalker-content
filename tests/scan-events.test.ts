import { describe, expect, it } from "vitest";
import { createScanEvent } from "../src/scan-events.js";

describe("createScanEvent", () => {
  it("returns a ContentSection with correct props", () => {
    const event = createScanEvent({
      type: "scan-started",
      collectionId: "docs",
    });

    expect(event.props).toBeDefined();
    expect(event.props?.role).toBe("tool:content-scanner");
    expect(event.props?.stage).toBe("scanning");
    expect(event.props?.type).toBe("scan-started");
    expect(event.props?.collection).toBe("docs");
    expect(event.blocks).toEqual([]);
  });

  it("generates an id that is a valid hex string", () => {
    const event = createScanEvent({
      type: "content-changed",
      collectionId: "docs",
    });

    const id = event.props?.id;
    expect(id).toBeDefined();
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it("generates a valid ISO 8601 time", () => {
    const event = createScanEvent({
      type: "scan-done",
      collectionId: "docs",
    });

    const time = event.props?.time;
    expect(time).toBeDefined();
    // Verify it parses as a valid date
    const parsed = new Date(time!);
    expect(parsed.toISOString()).toBe(time);
  });

  it("type matches input", () => {
    for (const type of [
      "scan-started",
      "content-changed",
      "content-removed",
      "scan-done",
    ] as const) {
      const event = createScanEvent({ type, collectionId: "c1" });
      expect(event.props?.type).toBe(type);
    }
  });

  it("includes uri when provided", () => {
    const event = createScanEvent({
      type: "content-changed",
      collectionId: "docs",
      uri: "docs:/root/file.txt",
    });
    expect(event.props?.uri).toBe("docs:/root/file.txt");
  });

  it("omits uri when not provided", () => {
    const event = createScanEvent({
      type: "scan-started",
      collectionId: "docs",
    });
    expect(event.props?.uri).toBeUndefined();
  });
});
