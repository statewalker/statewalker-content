import type { ContentBlock } from "@statewalker/content-blocks";
import { buildBlockTree } from "@statewalker/content-blocks/parser";
import { SnowflakeId } from "@statewalker/shared-ids";
import type { ExtractorRegistry } from "./extractor-registry.js";
import type {
  ExtractionEventType,
  ExtractionMessage,
  ExtractionMessageProps,
  ExtractionOptions,
  ExtractionStage,
} from "./types.js";

const snowflake = new SnowflakeId();

/**
 * Ensures every pipeline message gets a globally-unique ID and timestamp
 * so consumers can order, deduplicate, and trace messages reliably.
 */
function makeMessage(
  partial: { role: string; stage: ExtractionStage; type: ExtractionEventType },
  blocks: ContentBlock[],
): ExtractionMessage {
  const props: ExtractionMessageProps = {
    id: snowflake.generate(),
    time: new Date().toISOString(),
    role: partial.role,
    stage: partial.stage,
    type: partial.type,
  };
  return { props, blocks };
}

/**
 * Orchestrates the full bytes-to-blocks journey: resolve the right extractor,
 * run it, optionally normalize, and parse into a block tree. Yields progress
 * messages at each stage so callers (e.g. a chat UI) can show real-time
 * feedback without polling. The generator design lets consumers stream
 * results incrementally instead of waiting for the entire pipeline to finish.
 */
export async function* extractContent(
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: ExtractionOptions,
  registry: ExtractorRegistry,
): AsyncGenerator<ExtractionMessage> {
  const role = options.role ?? "tool:content-extractor";

  const extractor = registry.get(options.path, options.mimeType);
  if (!extractor) {
    throw new Error(`No extractor found for: ${options.path}`);
  }

  // Stage 1: extracting
  yield makeMessage({ role, stage: "extracting", type: "extraction-progress" }, []);

  // Run the extractor
  const rawResult = await extractor(content);
  let markdown = String(rawResult);

  // Stage 2: normalizing (only if normalizer provided)
  if (options.normalizer) {
    yield makeMessage({ role, stage: "normalizing", type: "extraction-progress" }, []);
    const normalized = await options.normalizer.normalize({
      markdown,
      context: options.context,
    });
    markdown = normalized.markdown;
  }

  // Stage 3: done — parse markdown into block tree
  const rootBlock = buildBlockTree(markdown);

  yield makeMessage({ role, stage: "done", type: "extraction-done" }, [rootBlock]);
}
