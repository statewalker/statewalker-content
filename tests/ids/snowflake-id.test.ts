import { describe, expect, it } from "vitest";
import { SnowflakeId } from "../../src/ids/snowflake-id.js";

describe("SnowflakeId", () => {
  it("should generate 1000 unique IDs", () => {
    const snowflake = new SnowflakeId();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(snowflake.generate());
    }
    expect(ids.size).toBe(1000);
  });

  it("should generate sequentially increasing IDs", () => {
    const snowflake = new SnowflakeId();
    let prev = BigInt(`0x${snowflake.generate()}`);
    for (let i = 0; i < 100; i++) {
      const curr = BigInt(`0x${snowflake.generate()}`);
      expect(curr).toBeGreaterThan(prev);
      prev = curr;
    }
  });

  it("should produce deterministic output with injectable clock", () => {
    const time = 1609459200000 + 1000; // epoch + 1 second
    const snowflake = new SnowflakeId({
      epoch: 1609459200000,
      workerId: 1,
      now: () => time,
    });

    const id1 = snowflake.generate();
    const expected1 = ((1000n << 22n) | (1n << 12n) | 0n).toString(16);
    expect(id1).toBe(expected1);

    // Same timestamp → sequence increments
    const id2 = snowflake.generate();
    const expected2 = ((1000n << 22n) | (1n << 12n) | 1n).toString(16);
    expect(id2).toBe(expected2);
  });

  it("should increment sequence for same timestamp and handle overflow", () => {
    let time = 1609459200000 + 5000;
    const snowflake = new SnowflakeId({
      epoch: 1609459200000,
      workerId: 0,
      now: () => time,
    });

    // Generate 4096 IDs at same timestamp (fills 12-bit sequence: 0..4095)
    const ids: string[] = [];
    for (let i = 0; i < 4096; i++) {
      ids.push(snowflake.generate());
    }
    expect(new Set(ids).size).toBe(4096);

    // Verify sequence values
    for (let i = 0; i < 4096; i++) {
      const expected = ((5000n << 22n) | (0n << 12n) | BigInt(i)).toString(16);
      expect(ids[i]).toBe(expected);
    }

    // Next generate should cause overflow → clock advances
    time = 1609459200000 + 5001;
    const overflowId = snowflake.generate();
    const expectedOverflow = ((5001n << 22n) | (0n << 12n) | 0n).toString(16);
    expect(overflowId).toBe(expectedOverflow);
  });

  it("should use custom epoch and workerId", () => {
    const customEpoch = 1700000000000;
    const time = customEpoch + 2000;
    const snowflake = new SnowflakeId({
      epoch: customEpoch,
      workerId: 512,
      now: () => time,
    });

    const id = snowflake.generate();
    const expected = ((2000n << 22n) | (512n << 12n) | 0n).toString(16);
    expect(id).toBe(expected);
  });

  it("parseHex should parse hex ID into components", () => {
    const snowflake = new SnowflakeId({
      epoch: 1609459200000,
      workerId: 42,
      now: () => 1609459200000 + 3000,
    });

    const hex = snowflake.generate();
    const parts = SnowflakeId.parseHex(hex);

    expect(parts.timestamp).toBe(3000);
    expect(parts.workerId).toBe(42);
    expect(parts.sequence).toBe(0);
  });

  it("parseDec should parse decimal ID into components", () => {
    const id = (3000n << 22n) | (42n << 12n) | 5n;
    const dec = id.toString();
    const parts = SnowflakeId.parseDec(dec);

    expect(parts.timestamp).toBe(3000);
    expect(parts.workerId).toBe(42);
    expect(parts.sequence).toBe(5);
  });

  it("parse should auto-detect hex (contains a-f chars)", () => {
    const id = (3000n << 22n) | (42n << 12n) | 0n;
    const hex = id.toString(16);
    const parts = SnowflakeId.parse(hex);

    expect(parts.timestamp).toBe(3000);
    expect(parts.workerId).toBe(42);
    expect(parts.sequence).toBe(0);
  });

  it("parse should auto-detect decimal (long all-digit string)", () => {
    const bigId = (1700000000000n << 22n) | (1n << 12n) | 0n;
    const bigDec = bigId.toString();
    const parts = SnowflakeId.parse(bigDec);

    expect(parts.timestamp).toBe(1700000000000);
    expect(parts.workerId).toBe(1);
    expect(parts.sequence).toBe(0);
  });

  it("should round-trip between hex and decimal", () => {
    const id = (12345n << 22n) | (7n << 12n) | 99n;
    const hex = id.toString(16);
    const dec = id.toString();

    expect(SnowflakeId.toDecimal(hex)).toBe(dec);
    expect(SnowflakeId.toHex(dec)).toBe(hex);
  });
});
