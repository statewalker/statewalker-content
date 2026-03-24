/**
 * SnowflakeId generator.
 * Based on https://github.com/dustinrouillard/snowflake-id (MIT License)
 * Modified to accept injectable clock for deterministic testing.
 * Returns hex-encoded IDs.
 *
 * Browser-compatible: uses only BigInt and Date.now().
 */

export interface SnowflakeOptions {
  /** Custom epoch (default: 1609459200000 = 2021-01-01T00:00:00Z) */
  epoch?: number;
  /** Machine/worker ID (0-1023, default: 1) */
  workerId?: number;
  /** Function returning current timestamp in ms (default: Date.now) */
  now?: () => number;
}

export interface SnowflakeParts {
  timestamp: number;
  workerId: number;
  sequence: number;
}

export class SnowflakeId {
  private epoch: number;
  private workerId: number;
  private now: () => number;
  private sequence = 0;
  private lastTimestamp = -1;

  constructor(options: SnowflakeOptions = {}) {
    this.epoch = options.epoch ?? 1609459200000;
    this.workerId = options.workerId ?? 1;
    this.now = options.now ?? Date.now;
  }

  generate(): string {
    let timestamp = this.now() - this.epoch;

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1) & 0xfff; // 12-bit sequence
      if (this.sequence === 0) {
        // Sequence overflow — wait for next millisecond
        while (timestamp <= this.lastTimestamp) {
          timestamp = this.now() - this.epoch;
        }
      }
    } else {
      this.sequence = 0;
    }

    this.lastTimestamp = timestamp;

    // 42-bit timestamp | 10-bit worker ID | 12-bit sequence
    const id =
      (BigInt(timestamp) << 22n) |
      (BigInt(this.workerId) << 12n) |
      BigInt(this.sequence);

    return id.toString(16);
  }

  /** Parse a hex-encoded snowflake ID into its component parts. */
  static parseHex(hex: string): SnowflakeParts {
    const id = BigInt(`0x${hex}`);
    return {
      timestamp: Number(id >> 22n),
      workerId: Number((id >> 12n) & 0x3ffn),
      sequence: Number(id & 0xfffn),
    };
  }

  /** Parse a decimal snowflake ID into its component parts. */
  static parseDec(decimal: string): SnowflakeParts {
    const id = BigInt(decimal);
    return {
      timestamp: Number(id >> 22n),
      workerId: Number((id >> 12n) & 0x3ffn),
      sequence: Number(id & 0xfffn),
    };
  }

  /**
   * Auto-detect format and parse a snowflake ID.
   * If the string contains [a-f] chars, it's hex.
   * Otherwise, strings up to 16 chars are treated as hex (max 64-bit hex),
   * longer strings as decimal.
   */
  static parse(id: string): SnowflakeParts {
    const isHex = /[a-f]/i.test(id) || id.length <= 16;
    return isHex ? SnowflakeId.parseHex(id) : SnowflakeId.parseDec(id);
  }

  /** Convert a decimal snowflake string to hex. */
  static toHex(decimal: string): string {
    return BigInt(decimal).toString(16);
  }

  /** Convert a hex snowflake string to decimal. */
  static toDecimal(hex: string): string {
    return BigInt(`0x${hex}`).toString();
  }
}
