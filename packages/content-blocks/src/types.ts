/**
 * Properties for sections and documents.
 * Key-value pairs serialized as YAML-like headers.
 */
export interface ContentProps {
  /** Unique ID (Snowflake or SHA1-based UUID). */
  id?: string;
  /** Arbitrary additional properties. */
  [key: string]: string | undefined;
}

/**
 * A document: optional properties (frontmatter) + a flat list of sections.
 * Generic over the section type to allow typed specializations.
 */
export interface ContentDocument<Section extends ContentSection = ContentSection> {
  /** Document-level properties (frontmatter). */
  props?: ContentProps;
  /** Flat list of sections separated by `---`. */
  content: Section[];
}

/**
 * A section within a document. Sections are separated by `\n\n---\n`.
 * Each section has optional properties and a list of content blocks.
 * Generic over the block type for typed specializations.
 */
export interface ContentSection<Block extends ContentBlock = ContentBlock> {
  /** Section properties, serialized after the `---` delimiter. */
  props?: ContentProps;
  /** Content blocks parsed from markdown headers. */
  blocks: Block[];
}

/**
 * A content block corresponding to a markdown header (`# H1`, `## H2`, etc.).
 * The first block of a section may have no title (content before the first header).
 */
export interface ContentBlock {
  /** Synthetic ID derived from the section ID. */
  id?: string;
  /** Title from the markdown header (e.g. "Header 1" from `# Header 1`). */
  title?: string;
  /** Text content (may be empty). */
  content: string;
  /** Nested sub-blocks from deeper headers. */
  children?: ContentBlock[];
}

// --------------------------------------------------------------
// Messages — typed sections for pipeline/chat communication
// --------------------------------------------------------------

/**
 * Properties for pipeline messages with well-known fields.
 * Extends ContentProps so arbitrary fields are still allowed.
 */
export interface ContentMessageProps extends ContentProps {
  /** ISO 8601 timestamp — required for all messages. */
  time: string;
  /** Source that generated the message (e.g. "user", "tool:content-scanner"). */
  role: string;
  /** Event kind (e.g. "content-changed", "scan-started", "extraction-done"). */
  type?: string;
  /** Processing phase, role-specific (e.g. "scanning", "extracting", "normalizing"). */
  stage?: string;
}

/**
 * A typed message — a ContentSection with required, well-typed props.
 * Structurally assignable to ContentSection.
 * The `blocks` field holds the raw parsed content from markdown.
 */
export interface ContentMessage extends ContentSection {
  /** Message properties — required and typed (not optional). */
  props: ContentMessageProps;
}

/**
 * A sequential log of typed messages stored as a document.
 * Each section in the document is a message with required props (time, role, etc.).
 *
 * Use cases: chat sessions, scanner event logs, extraction pipelines.
 * Serialized/parsed using the standard ContentDocument format.
 */
export interface MessageLog<Message extends ContentMessage = ContentMessage>
  extends ContentDocument<Message> {}
