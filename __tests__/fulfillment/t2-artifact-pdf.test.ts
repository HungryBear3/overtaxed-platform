/** @jest-environment node */
import { PDFDocument } from "pdf-lib";
import { renderT2ArtifactPdf } from "@/lib/fulfillment/t2-artifact-pdf";
const AT = "2026-06-08T10:15:30Z";
test("literal escape text never aliases non-ASCII source content", async () => {
  const unicode = await renderT2ArtifactPdf("Café", AT);
  const literal = await renderT2ArtifactPdf("Caf\\u{e9}", AT);
  expect(unicode.equals(literal)).toBe(false);
});
test("emits a readable PDF with stable creation metadata and deterministic bytes", async () => {
  const input = "OT SYNTHETIC EVIDENCE\n1. SUMMARY\nPrepared: " + AT;
  const first = await renderT2ArtifactPdf(input, AT);
  const second = await renderT2ArtifactPdf(input, AT);
  expect(first.subarray(0, 5).toString()).toBe("%PDF-");
  expect(first.equals(second)).toBe(true);
  const pdf = await PDFDocument.load(first, { updateMetadata: false });
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  expect(pdf.getCreationDate()?.toISOString()).toBe(new Date(AT).toISOString());
  expect(pdf.getModificationDate()?.toISOString()).toBe(
    new Date(AT).toISOString(),
  );
});
test("paginates long evidence and supports escaped non-ASCII without encoding failures", async () => {
  const bytes = await renderT2ArtifactPdf(
    Array.from({ length: 180 }, (_, i) => `ROW ${i}: ` + "x".repeat(200)).join(
      "\n",
    ) + "\nCafé 😀",
    AT,
  );
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(3);
  expect(pdf.getPageCount()).toBeLessThan(20);
});
test.each(["", "not-an-instant", "2026-02-30T10:00:00Z"])(
  "refuses invalid generation time %s",
  async (at) => {
    await expect(renderT2ArtifactPdf("synthetic", at)).rejects.toThrow(
      "PDF_INPUT_INVALID",
    );
  },
);
test.each(["", "x".repeat(200001), "\n".repeat(10001)])(
  "refuses empty or excessive input",
  async (input) => {
    await expect(renderT2ArtifactPdf(input, AT)).rejects.toThrow(
      "PDF_INPUT_INVALID",
    );
  },
);
