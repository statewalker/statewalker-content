import { describe, expect, it } from "vitest";
import { createStampAllocator } from "../src/stores/stamp.js";

describe("StampAllocator", () => {
  it("produces strictly increasing stamps within a single batch", () => {
    const alloc = createStampAllocator();
    const stamps = Array.from({ length: 1000 }, () => alloc.next());
    for (let i = 1; i < stamps.length; i++) {
      const prev = stamps[i - 1] as number;
      const cur = stamps[i] as number;
      expect(cur).toBeGreaterThan(prev);
    }
  });

  it("current() reflects the last allocated stamp without advancing", () => {
    const alloc = createStampAllocator();
    const a = alloc.next();
    expect(alloc.current()).toBe(a);
    expect(alloc.current()).toBe(a);
    const b = alloc.next();
    expect(b).toBeGreaterThan(a);
    expect(alloc.current()).toBe(b);
  });

  it("seed+next produces a stamp strictly greater than the seeded value", () => {
    const alloc = createStampAllocator();
    alloc.seed(42);
    expect(alloc.next()).toBeGreaterThan(42);
  });

  it("simulates restart: new allocator seeded with prior current() produces a greater stamp", () => {
    const first = createStampAllocator();
    const top = first.next();
    const second = createStampAllocator();
    second.seed(top);
    expect(second.next()).toBeGreaterThan(top);
  });
});
