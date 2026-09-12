import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { MAX_ARTIFACT_BYTES, parseStrictInstant } from "./validation";

/** Stable, bounded PDF serialization; no clock, data lookup or provider access. */
export async function renderT2ArtifactPdf(
  text: string,
  generatedAt: string,
): Promise<Buffer> {
  const instant = parseStrictInstant(generatedAt);
  if (!text.trim() || text.length > 200000 || instant === null)
    throw new Error("PDF_INPUT_INVALID");
  // Standard PDF fonts cannot represent arbitrary Unicode. Escapes preserve
  // unsupported characters visibly instead of silently dropping/replacing them.
  const printable = Array.from(text.replace(/\r\n?/g, "\n"))
    .map((c) =>
      c === "\\"
        ? "\\\\"
        : c === "\n" || (c >= " " && c <= "~")
          ? c
          : `\\u{${c.codePointAt(0)!.toString(16)}}`,
    )
    .join("");
  const lines = printable.split("\n").flatMap((line) => {
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += 94)
      chunks.push(line.slice(i, i + 94));
    return chunks.length ? chunks : [""];
  });
  const perPage = 53;
  const pageCount = Math.ceil(lines.length / perPage);
  if (pageCount > 100) throw new Error("PDF_INPUT_INVALID");
  const pdf = await PDFDocument.create();
  pdf.setTitle("OverTaxed IL - Property Record Evidence");
  pdf.setCreator("OverTaxed IL");
  pdf.setProducer("OverTaxed IL deterministic PDF renderer v1");
  pdf.setCreationDate(new Date(instant));
  pdf.setModificationDate(new Date(instant));
  const body = await pdf.embedFont(StandardFonts.Courier);
  const heading = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.08, 0.16, 0.26);
  for (let index = 0; index < pageCount; index++) {
    const page = pdf.addPage([612, 792]);
    page.drawText("OVERTAXED IL  |  PROPERTY RECORD EVIDENCE", {
      x: 48,
      y: 751,
      size: 11,
      font: heading,
      color: navy,
    });
    page.drawText(
      "Review supporting records before filing. No outcome is guaranteed.",
      { x: 48, y: 733, size: 8, font: body, color: navy },
    );
    page.drawLine({
      start: { x: 48, y: 723 },
      end: { x: 564, y: 723 },
      thickness: 0.5,
      color: navy,
    });
    const section = lines.slice(index * perPage, (index + 1) * perPage);
    section.forEach((line, row) =>
      page.drawText(line, { x: 48, y: 703 - row * 12, size: 9, font: body }),
    );
    page.drawLine({
      start: { x: 48, y: 65 },
      end: { x: 564, y: 65 },
      thickness: 0.5,
      color: navy,
    });
    page.drawText(
      `Page ${index + 1} of ${pageCount} | Unicode and literal backslashes use escaped notation.`,
      { x: 48, y: 48, size: 7, font: body, color: navy },
    );
  }
  const bytes = Buffer.from(
    await pdf.save({ useObjectStreams: false, addDefaultPage: false }),
  );
  if (bytes.byteLength > MAX_ARTIFACT_BYTES)
    throw new Error("PDF_INPUT_INVALID");
  return bytes;
}
