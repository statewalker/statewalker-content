import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
});

/**
 * Provides the reverse of `htmlToMarkdown` for cases where extracted
 * markdown needs to be rendered back to HTML (e.g. previews, email
 * output). Configured with pass-through raw HTML and auto-linking
 * so embedded markup and bare URLs survive the round-trip.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === "") {
    return "";
  }
  return md.render(markdown);
}
