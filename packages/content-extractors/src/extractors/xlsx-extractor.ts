import ExcelJS from "exceljs";
import { collectBytes } from "../collect-bytes.js";
import type { ContentExtractor } from "../types.js";

/**
 * Converts Excel spreadsheets into markdown tables so the content
 * is searchable and consumable by text-based pipelines. Each worksheet
 * becomes a separate section with a level-2 heading. Empty sheets are
 * skipped to avoid noise.
 */
export const xlsxExtractor: ContentExtractor = async (content) => {
  const bytes = await collectBytes(content);
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await workbook.xlsx.load(arrayBuffer as ArrayBuffer);

  const sections: string[] = [];

  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];

    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        try {
          const v = cell.value;
          cells.push(v == null ? "" : String(v));
        } catch {
          cells.push("");
        }
      });
      rows.push(cells);
    });

    if (rows.length === 0) return;

    // Normalize column count to the widest row
    const colCount = Math.max(...rows.map((r) => r.length));
    const padded = rows.map((r) => {
      while (r.length < colCount) r.push("");
      return r;
    });

    // First row as headers, rest as data
    const [headers, ...dataRows] = padded;
    if (!headers) return;

    const headerLine = `| ${headers.join(" | ")} |`;
    const separator = `| ${headers.map(() => "---").join(" | ")} |`;
    const bodyLines = dataRows.map((r) => `| ${r.join(" | ")} |`);

    const table = [headerLine, separator, ...bodyLines].join("\n");
    sections.push(`## ${sheet.name}\n\n${table}`);
  });

  return sections.join("\n\n");
};
