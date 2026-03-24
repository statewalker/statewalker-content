/**
 * Unescape `\---` back to `---` in block content.
 */
export function unescapeBlockSeparators(text: string): string {
  return text.replace(/^\\---/gm, "---");
}

/**
 * Escape `---` to `\---` in block content to avoid confusion with block separators.
 */
export function escapeBlockSeparators(text: string): string {
  return text.replace(/^---/gm, "\\---");
}
