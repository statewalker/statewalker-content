// Re-export from @statewalker/ids for backward compatibility.
// New code should import directly from @statewalker/ids.

export type { SnowflakeOptions, SnowflakeParts } from "@statewalker/ids";
export {
  crockfordDecode,
  crockfordEncode,
  extractTime,
  parseSnowflake,
  parseSnowflakeBase32,
  parseSnowflakeDec,
  parseSnowflakeHex,
  SNOWFLAKE_BASE32_LENGTH,
  SnowflakeId,
  sha1Bytes,
  sha1Uuid,
  snowflakeToDecimal,
  snowflakeToHex,
} from "@statewalker/ids";
