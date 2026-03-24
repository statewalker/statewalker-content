import type { ContentProps } from "../types.js";

/**
 * Parse YAML-like key-value pairs from a text block.
 * Each line is `key: value`. Lines without `:` are skipped.
 */
export function parseProperties(text: string): ContentProps {
  const result: ContentProps = {};
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Serialize properties to YAML-like key-value lines.
 * The `id` field is always first; remaining keys are sorted alphabetically.
 */
export function serializeProperties(properties: ContentProps): string {
  const keys = Object.keys(properties).filter(
    (k) => properties[k] !== undefined,
  );

  const sorted: string[] = [];
  if (keys.includes("id")) {
    sorted.push("id");
  }
  for (const key of keys.sort()) {
    if (key !== "id") {
      sorted.push(key);
    }
  }

  return sorted.map((k) => `${k}: ${properties[k]}`).join("\n");
}
