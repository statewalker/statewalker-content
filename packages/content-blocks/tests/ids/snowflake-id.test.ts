import { describe, expect, it } from "vitest";
import {
  extractTime,
  parseSnowflake,
  parseSnowflakeBase32,
  parseSnowflakeDec,
  parseSnowflakeHex,
  SNOWFLAKE_BASE32_LENGTH,
  SnowflakeId,
  snowflakeToDecimal,
  snowflakeToHex,
} from "../../src/ids/index.js";

describe("SnowflakeId", () => {
  it("should generate 1000 unique IDs", () => {
    const snowflake = new SnowflakeId();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(snowflake.generate());
    }
    expect(ids.size).toBe(1000);
  });

  it("should generate 13-char Crockford base32 IDs", () => {
    const snowflake = new SnowflakeId();
    const id = snowflake.generate();
    expect(id).toHaveLength(SNOWFLAKE_BASE32_LENGTH);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  it("should generate lexicographically increasing IDs", () => {
    const snowflake = new SnowflakeId();
    let prev = snowflake.generate();
    for (let i = 0; i < 100; i++) {
      const curr = snowflake.generate();
      expect(curr > prev).toBe(true);
      prev = curr;
    }
  });

  it("should produce deterministic output with injectable clock", () => {
    const time = 1609459200000 + 1000;
    const snowflake = new SnowflakeId({
      epoch: 1609459200000,
      workerId: 1,
      now: () => time,
    });

    const id1 = snowflake.generate();
    const parts1 = parseSnowflakeBase32(id1);
    expect(parts1.timestamp).toBe(1000);
    expect(parts1.workerId).toBe(1);
    expect(parts1.sequence).toBe(0);

    const id2 = snowflake.generate();
    const parts2 = parseSnowflakeBase32(id2);
    expect(parts2.timestamp).toBe(1000);
    expect(parts2.workerId).toBe(1);
    expect(parts2.sequence).toBe(1);
  });

  it("should increment sequence for same timestamp and handle overflow", () => {
    let time = 1609459200000 + 5000;
    const snowflake = new SnowflakeId({
      epoch: 1609459200000,
      workerId: 0,
      now: () => time,
    });

    const ids: string[] = [];
    for (let i = 0; i < 4096; i++) {
      ids.push(snowflake.generate());
    }
    expect(new Set(ids).size).toBe(4096);

    for (let i = 0; i < 4096; i++) {
      const id = ids[i];
      expect(id).toBeDefined();
      const parts = parseSnowflakeBase32(id as string);
      expect(parts.sequence).toBe(i);
      expect(parts.timestamp).toBe(5000);
    }

    time = 1609459200000 + 5001;
    const overflowId = snowflake.generate();
    const overflowParts = parseSnowflakeBase32(overflowId);
    expect(overflowParts.timestamp).toBe(5001);
    expect(overflowParts.sequence).toBe(0);
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
    const parts = parseSnowflakeBase32(id);
    expect(parts.timestamp).toBe(2000);
    expect(parts.workerId).toBe(512);
    expect(parts.sequence).toBe(0);
  });

  it("parseSnowflakeHex should parse legacy hex ID", () => {
    const id = (3000n << 22n) | (42n << 12n) | 0n;
    const hex = id.toString(16);
    const parts = parseSnowflakeHex(hex);

    expect(parts.timestamp).toBe(3000);
    expect(parts.workerId).toBe(42);
    expect(parts.sequence).toBe(0);
  });

  it("parseSnowflakeDec should parse decimal ID", () => {
    const id = (3000n << 22n) | (42n << 12n) | 5n;
    const dec = id.toString();
    const parts = parseSnowflakeDec(dec);

    expect(parts.timestamp).toBe(3000);
    expect(parts.workerId).toBe(42);
    expect(parts.sequence).toBe(5);
  });

  it("parseSnowflake should auto-detect Crockford base32 (13 chars)", () => {
    const snowflake = new SnowflakeId({
      epoch: 1609459200000,
      workerId: 42,
      now: () => 1609459200000 + 3000,
    });
    const id = snowflake.generate();
    expect(id).toHaveLength(13);

    const parts = parseSnowflake(id);
    expect(parts.timestamp).toBe(3000);
    expect(parts.workerId).toBe(42);
  });

  it("parseSnowflake should auto-detect hex (non-13-char string)", () => {
    const id = (3000n << 22n) | (42n << 12n) | 0n;
    const hex = id.toString(16);
    expect(hex.length).not.toBe(13);

    const parts = parseSnowflake(hex);
    expect(parts.timestamp).toBe(3000);
    expect(parts.workerId).toBe(42);
  });

  it("parseSnowflake should auto-detect decimal (long all-digit string)", () => {
    const bigId = (1700000000000n << 22n) | (1n << 12n) | 0n;
    const bigDec = bigId.toString();
    const parts = parseSnowflake(bigDec);

    expect(parts.timestamp).toBe(1700000000000);
    expect(parts.workerId).toBe(1);
    expect(parts.sequence).toBe(0);
  });

  it("should round-trip between hex and decimal", () => {
    const id = (12345n << 22n) | (7n << 12n) | 99n;
    const hex = id.toString(16);
    const dec = id.toString();

    expect(snowflakeToDecimal(hex)).toBe(dec);
    expect(snowflakeToHex(dec)).toBe(hex);
  });

  it("extractTime should return absolute timestamp", () => {
    const time = 1700000000000;
    const snowflake = new SnowflakeId({ now: () => time });
    const id = snowflake.generate();
    expect(extractTime(id)).toBe(time);
  });
});
