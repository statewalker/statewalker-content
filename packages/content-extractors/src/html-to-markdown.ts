/// <reference path="./turndown-plugin-gfm.d.ts" />
import { gfm } from "@joplin/turndown-plugin-gfm";
import TurndownService from "turndown";

/**
 * Normalizes HTML into markdown so downstream consumers get a uniform
 * text format regardless of whether the source was HTML, DOCX (via
 * mammoth's HTML output), or any other HTML-producing extractor.
 * Uses Turndown with GFM tables and strikethrough support.
 */
export function htmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "*",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  turndownService.use(gfm);
  return turndownService.turndown(html);
}
