import { SnowflakeId } from "@statewalker/shared-ids";
import type { ScanEventType, ScanMessage, ScanMessageProps } from "./types.js";

const snowflake = new SnowflakeId();

/**
 * Wraps raw scan data into a `ScanMessage` so scan events are
 * wire-compatible with the rest of the content-blocks pipeline.
 * Assigns a snowflake ID and timestamp to each event, making them
 * orderable and dedupable by downstream consumers without extra coordination.
 */
export function createScanEvent(params: {
  type: ScanEventType;
  uri?: string;
  collectionId: string;
  extra?: Record<string, string>;
}): ScanMessage {
  const props: ScanMessageProps = {
    id: snowflake.generate(),
    role: "tool:content-scanner",
    stage: "scanning",
    time: new Date().toISOString(),
    type: params.type,
    collection: params.collectionId,
    ...(params.uri !== undefined ? { uri: params.uri } : {}),
    ...(params.extra ?? {}),
  };
  return {
    props,
    blocks: [],
  };
}
