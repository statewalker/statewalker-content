// Re-export from @repo/ids for backward compatibility.
// New code should import directly from @repo/ids.

export type { SnowflakeOptions, SnowflakeParts } from "@repo/ids";
export {
  crockfordDecode,
  crockfordEncode,
  SNOWFLAKE_BASE32_LENGTH,
  SnowflakeId,
  sha1Bytes,
  sha1Uuid,
} from "@repo/ids";
