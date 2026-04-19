import { describe, expect, it } from "vitest";
import { pdfExtractor } from "../../src/extractors/pdf-extractor.js";

// Minimal valid PDF with text "Hello PDF World"
function createMinimalPdf(): Uint8Array {
  const pdf = `%PDF-1.0
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj

4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (Hello PDF World) Tj ET
endstream
endobj

5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000360 00000 n

trailer
<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("pdfExtractor", () => {
  it("extracts text from a minimal PDF", async () => {
    const pdfBytes = createMinimalPdf();
    const result = await pdfExtractor([pdfBytes]);
    expect(result).toContain("Hello PDF World");
  });

  it("returns empty string for PDF with no text", async () => {
    // Minimal PDF with an empty content stream
    const pdf = `%PDF-1.0
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << >> >>
endobj

4 0 obj
<< /Length 0 >>
stream

endstream
endobj

xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000232 00000 n

trailer
<< /Size 5 /Root 1 0 R >>
startxref
292
%%EOF`;
    const pdfBytes = new TextEncoder().encode(pdf);
    const result = await pdfExtractor([pdfBytes]);
    expect(result).toBe("");
  });
});
