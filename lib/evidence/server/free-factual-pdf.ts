import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { MAX_ARTIFACT_BYTES, parseStrictInstant } from "@/lib/fulfillment/validation";

/** Characters per printed line: Courier 9pt across the 516pt text block. */
export const T2_PDF_LINE_WIDTH = 94;

/**
 * Line layout.
 *
 * `"hard"` is the original behaviour, kept byte-identical for the neutral
 * report: cut every line at exactly 94 characters, wherever that falls.
 *
 * `"word-wrap"` is used by the $69 DIY documents. It breaks only AFTER a space
 * or a comma, so no word, number or JSON key is split, and it never drops or
 * adds a character on a line without indentation — the canonical provenance
 * JSON can be recovered exactly by joining its printed lines with nothing in
 * between. Indented prose and list items get a hanging indent on continuation
 * lines. A single token longer than a whole line (none exists in the current
 * documents) is still cut, at the line width, rather than overflowing the page.
 * It also prints the WinAnsi characters the standard fonts can draw — the em
 * dash, curly quotes, Latin-1 — instead of escaping them.
 */
export type T2PdfLayout = "hard" | "word-wrap";

/** Printable in the standard fonts' WinAnsi encoding, beyond ASCII. */
const WINANSI_EXTRA = new Set(
  // The soft hyphen (U+00AD) is left out: it is invisible when drawn.
  Array.from("\u2014\u2013\u2018\u2019\u201c\u201d\u2026").concat(
    Array.from({ length: 0xff - 0xa1 + 1 }, (_, i) => String.fromCharCode(0xa1 + i)).filter(
      (c) => c !== "\u00ad",
    ),
  ),
);

function escapeForFont(text: string, layout: T2PdfLayout): string {
  // Standard PDF fonts cannot represent arbitrary Unicode. Escapes preserve
  // unsupported characters visibly instead of silently dropping/replacing them.
  return Array.from(text.replace(/\r\n?/g, "\n"))
    .map((c) =>
      c === "\\"
        ? "\\\\"
        : c === "\n" || (c >= " " && c <= "~")
          ? c
          : layout === "word-wrap" && WINANSI_EXTRA.has(c)
            ? c
            : `\\u{${c.codePointAt(0)!.toString(16)}}`,
    )
    .join("");
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const indent = /^ */.exec(line)![0].length;
  // Hanging indent under a list marker ("- " or "[ ] "), else the line's own.
  const marker = /^ *(?:- |\[ \] )/.exec(line);
  const hang = " ".repeat(Math.min(marker ? marker[0].length : indent, 24));
  // Unindented lines (the provenance JSON among them) wrap losslessly; indented
  // prose and list items trade that for a readable hanging indent.
  const hanging = indent > 0 || marker !== null;
  const out: string[] = [];
  let rest = line;
  let prefix = "";
  while (prefix.length + rest.length > width) {
    const room = width - prefix.length;
    let cut = -1;
    // The last space or comma that still fits; break AFTER it so the
    // character stays on the earlier line and nothing is lost.
    for (let i = Math.min(room, rest.length) - 1; i > 0; i -= 1) {
      if (rest[i] === " " || rest[i] === ",") {
        cut = i + 1;
        break;
      }
    }
    if (cut <= 0) cut = room;
    const head = rest.slice(0, cut);
    out.push(prefix + (hanging ? head.replace(/ +$/, "") : head));
    rest = rest.slice(cut);
    if (hanging) {
      rest = rest.replace(/^ +/, "");
      prefix = hang;
    }
  }
  out.push(prefix + rest);
  return out;
}

/** The printed lines for `text`, exactly as the PDF draws them. Pure. */
export function layoutT2PrintLines(
  text: string,
  layout: T2PdfLayout = "hard",
  width: number = T2_PDF_LINE_WIDTH,
): string[] {
  const printable = escapeForFont(text, layout);
  return printable.split("\n").flatMap((line) => {
    if (layout === "word-wrap") return wrapLine(line, width);
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += width)
      chunks.push(line.slice(i, i + width));
    return chunks.length ? chunks : [""];
  });
}

/** Stable, bounded PDF serialization; no clock, data lookup or provider access. */
export async function renderT2ArtifactPdf(
  text: string,
  generatedAt: string,
  presentation: {
    title?: string;
    heading?: string;
    disclaimer?: string;
    layout?: T2PdfLayout;
  } = {},
): Promise<Buffer> {
  const instant = parseStrictInstant(generatedAt);
  if (!text.trim() || text.length > 200000 || instant === null)
    throw new Error("PDF_INPUT_INVALID");
  const lines = layoutT2PrintLines(text, presentation.layout ?? "hard");
  const perPage = 53;
  const pageCount = Math.ceil(lines.length / perPage);
  if (pageCount > 100) throw new Error("PDF_INPUT_INVALID");
  const pdf = await PDFDocument.create();
  pdf.setTitle(presentation.title ?? "OverTaxed IL - Property Record Evidence");
  pdf.setCreator("OverTaxed IL");
  pdf.setProducer("OverTaxed IL deterministic PDF renderer v1");
  pdf.setCreationDate(new Date(instant));
  pdf.setModificationDate(new Date(instant));
  const body = await pdf.embedFont(StandardFonts.Courier);
  const heading = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.08, 0.16, 0.26);
  for (let index = 0; index < pageCount; index++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(presentation.heading ?? "OVERTAXED IL  |  PROPERTY RECORD EVIDENCE", {
      x: 48,
      y: 751,
      size: 11,
      font: heading,
      color: navy,
    });
    page.drawText(
      presentation.disclaimer ?? "Review supporting records before filing. No outcome is guaranteed.",
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
