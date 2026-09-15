/**
 * Build `data/deadlines/cook-county.json` from the county's published calendars.
 *
 * This is the only code on the branch permitted to turn a county publication
 * into a date. Everything downstream trusts it, so it is built to refuse:
 *
 *   - **Fetching is injected.** Nothing here reaches the network on import, and
 *     `main()` will not run without an explicit `--allow-network` flag. A
 *     refresh script that fetches on import is one stray `import` away from
 *     being an unauthorised provider call from a request handler.
 *   - **Whole snapshots only.** If any stage fails to fetch, hash, parse, or
 *     validate, nothing is written. A file where one stage is current and the
 *     other is half a cycle stale is worse than no file, because it looks fine.
 *   - **Atomic publication.** The snapshot is written to a temp file and
 *     renamed. A reader never observes a partially written JSON document.
 *   - **Loud failure.** A malformed row is an error, not a row to skip. A
 *     skipped township silently disappears from the snapshot and renders as
 *     "no date available" forever with nobody told why.
 *
 * The two sources, as actually published in the 2026 session:
 *
 *   - The Assessor's calendar is a Drupal accordion of per-township cards
 *     (`.views-row`), not an HTML table. Each card carries a
 *     "Reassessment Notice Date" and a "Last File Date" as `<time>` elements,
 *     and — while the window is open — an "Open For Appeals Until <date>"
 *     banner. The page's own prose defines opening: "When a township 'opens'
 *     property owners will receive a Reassessment Notice in the mail", so the
 *     notice date is the open date. Cards for townships with no published
 *     window yet are completely empty of dates; they are recorded as
 *     listed-without-a-window (`window: null`), which downstream renders as
 *     pending. A card with *some* dates but not all is a schema error.
 *   - The Board of Review retired its HTML calendar routes; the current
 *     official publication is a first-party PDF ("DATES AND DEADLINES ...
 *     SESSION") linked from the Board's own site. It is a single-page,
 *     digitally produced (Distiller, real text layer) grouped table. The
 *     parser below reads the PDF text operators directly — no OCR, no AI, no
 *     external converter — and refuses any deviation from the known layout.
 *
 * NOTE: this script has never been run against live county sources. The
 * committed snapshot was built from local fixtures and is marked
 * `synthetic: true`, which `evaluateOfficialDeadlineState` refuses outright.
 */

import { createHash } from "node:crypto"
import { inflateSync } from "node:zlib"

import {
  townshipKeyFromName,
  type TownshipResolution,
} from "@/lib/deadlines/township-resolution"
import type {
  DeadlineStage,
  OfficialDeadlineSnapshot,
  ParseStatus,
  SourceAuthority,
  SourceProvenance,
  StageWindow,
  TownshipSnapshotRow,
} from "@/lib/deadlines/official-source-state"

export const PARSER_VERSION = "2.0.0"
export const SCHEMA_VERSION = 1
export const SNAPSHOT_PATH = "data/deadlines/cook-county.json"

export const SOURCES: Record<
  DeadlineStage,
  { authority: SourceAuthority; url: string }
> = {
  assessor: {
    authority: "cook_county_assessor",
    url: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
  },
  bor: {
    authority: "cook_county_board_of_review",
    // The Board's former HTML calendar routes now 404; the 404 page itself
    // links to this first-party PDF, which is the current official
    // publication of township open/close dates for the session.
    url: "https://www.cookcountyboardofreview.com/sites/g/files/ywwepo261/files/document/file/2026-08/2026TOWNSHIPOPEN-CLOSE.pdf",
  },
}

export type FetchedSource = {
  status: number
  finalUrl: string
  /**
   * The exact bytes retrieved. Bytes rather than a string because the Board's
   * source is a PDF, and because the provenance hash must be the hash of what
   * actually arrived, not of a lossy text decoding of it.
   */
  body: Uint8Array
}

export type SourceFetcher = (url: string) => Promise<FetchedSource>

/**
 * One township as listed by a stage. `window` is null when the county lists
 * the township with no published dates (the Assessor's calendar shows every
 * township year-round; most have no window yet). A null window is a real
 * observation — "listed, nothing published" — and downstream renders it as
 * pending, never as a date.
 */
export type CalendarRow = {
  townshipKey: string
  townshipName: string
  window: StageWindow | null
}

export type CalendarParse =
  | { status: "ok"; rows: CalendarRow[] }
  | { status: Exclude<ParseStatus, "ok">; detail: string }

export function sha256Hex(body: Uint8Array | string): string {
  const hash = createHash("sha256")
  if (typeof body === "string") hash.update(body, "utf8")
  else hash.update(body)
  return hash.digest("hex")
}

/** Strict UTF-8; invalid bytes are a parse failure, not replacement chars. */
export function decodeUtf8(body: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body)
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
}

/**
 * A county date as printed, normalised to YYYY-MM-DD — or null.
 *
 * Only the two formats the county actually publishes are accepted, both with an
 * explicit four-digit year. A date with no year ("June 15") is rejected rather
 * than defaulted to the current one: inferring the year is how a snapshot
 * quietly acquires a deadline from the wrong cycle.
 */
export function parsePrintedDate(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim()

  const long = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text)
  if (long) {
    const month = MONTHS[long[1].toLowerCase()]
    if (!month) return null
    return isRealDate(`${long[3]}-${month}-${long[2].padStart(2, "0")}`)
  }

  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (numeric) {
    return isRealDate(
      `${numeric[3]}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`,
    )
  }

  return null
}

/** Round-trips the date so 2026-02-31 is rejected rather than rolled forward. */
function isRealDate(iso: string): string | null {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().slice(0, 10) === iso ? iso : null
}

function stripTags(cell: string): string {
  return cell
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

/* -------------------------------------------------------------------------- */
/* Assessor: accordion calendar                                               */
/* -------------------------------------------------------------------------- */

type ParsedField =
  | { present: false }
  | { present: true; iso: string }
  | { present: true; iso: null; detail: string }

/**
 * Read one dated card field: a Drupal datetime field carrying
 * `<time datetime="ISO">printed</time>`. The printed text and the machine
 * `datetime` attribute must agree; a card where they disagree is ambiguous
 * and ambiguity is an error, not a choice.
 */
function readCardDate(rowHtml: string, fieldClass: string): ParsedField {
  if (!rowHtml.includes(fieldClass)) return { present: false }

  const re = new RegExp(
    `${fieldClass}[^>]*>\\s*<time datetime="([^"]+)">([^<]*)</time>`,
  )
  const match = re.exec(rowHtml)
  if (!match) {
    // The field div exists but carries no <time>: an empty field. The county
    // renders unscheduled townships with the labelled field absent entirely,
    // so an empty field container is simply "no date published".
    return { present: false }
  }

  const printed = parsePrintedDate(stripTags(match[2]))
  if (printed === null) {
    return { present: true, iso: null, detail: `unreadable printed date "${match[2]}"` }
  }

  const machine = isRealDate(match[1].slice(0, 10))
  if (machine === null || machine !== printed) {
    return {
      present: true,
      iso: null,
      detail: `printed date "${match[2]}" disagrees with datetime attribute "${match[1]}"`,
    }
  }

  return { present: true, iso: printed }
}

/**
 * Parse the Assessor's accordion calendar.
 *
 * Every card (`.views-row` containing a `row On|Off title` header) is one
 * township. Cards with both dates yield a window; cards with neither yield a
 * null window; anything in between — one date, an "Open For Appeals Until"
 * banner that contradicts the last-file date, an unreadable or ambiguous
 * date, a duplicate township — fails the whole stage.
 */
export function parseAssessorCalendar(html: string): CalendarParse {
  if (html.startsWith("%PDF")) {
    return {
      status: "parse_error",
      detail: "body is a PDF; the assessor parser reads the HTML calendar only",
    }
  }

  const rows: CalendarRow[] = []
  const seen = new Set<string>()

  const segments = html.split('<div class="views-row">').slice(1)
  for (const segment of segments) {
    // Non-calendar views (announcement banners share the class) carry no
    // title row; they are not township cards and are not parsed.
    const titleRow = /<div class="row (On|Off) title">/.exec(segment)
    if (!titleRow) continue

    const title = /views-field-title"><a[^>]*>([\s\S]*?)<\/a>/.exec(segment)
    const townshipName = title ? stripTags(title[1]) : ""
    if (!townshipName) {
      return { status: "schema_error", detail: "township card with no township name" }
    }

    const notice = readCardDate(segment, "field--name-field-reassessment-notice-date")
    const lastFile = readCardDate(segment, "field--name-field-last-file-date")
    for (const [label, field] of [
      ["reassessment notice date", notice],
      ["last file date", lastFile],
    ] as const) {
      if (field.present && field.iso === null) {
        return { status: "schema_error", detail: `${townshipName}: ${label}: ${field.detail}` }
      }
    }

    const openAppeal = /class="[^"]*\bopen-appeal\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(segment)
    const openAppealText = openAppeal ? stripTags(openAppeal[1]) : ""

    const noticeIso = notice.present ? (notice.iso as string) : null
    const lastFileIso = lastFile.present ? (lastFile.iso as string) : null

    let window: StageWindow | null
    if (noticeIso !== null && lastFileIso !== null) {
      if (noticeIso > lastFileIso) {
        return {
          status: "schema_error",
          detail: `${townshipName}: window closes ${lastFileIso} before it opens ${noticeIso}`,
        }
      }
      // While a window is open the card carries an "Open For Appeals Until"
      // banner; once it closes the banner disappears but the dates remain.
      // A banner that exists must agree with the last-file date exactly.
      if (openAppealText !== "") {
        const until = /^Open For Appeals Until (.+)$/.exec(openAppealText)
        const untilIso = until ? parsePrintedDate(until[1]) : null
        if (untilIso === null || untilIso !== lastFileIso) {
          return {
            status: "schema_error",
            detail: `${townshipName}: banner "${openAppealText}" disagrees with last file date ${lastFileIso}`,
          }
        }
      }
      // The page defines opening as the notice mailing ("When a township
      // 'opens' property owners will receive a Reassessment Notice in the
      // mail"), so the open date is the notice date.
      window = { noticeDate: noticeIso, openDate: noticeIso, lastFileDate: lastFileIso }
    } else if (noticeIso === null && lastFileIso === null) {
      if (openAppealText !== "") {
        return {
          status: "schema_error",
          detail: `${townshipName}: "${openAppealText}" banner on a card with no dates`,
        }
      }
      window = null
    } else {
      return {
        status: "schema_error",
        detail: `${townshipName}: partial card — notice ${noticeIso ?? "missing"}, last file ${lastFileIso ?? "missing"}`,
      }
    }

    const townshipKey = townshipKeyFromName(townshipName)
    if (seen.has(townshipKey)) {
      return {
        status: "schema_error",
        detail: `${townshipKey}: listed twice; refusing to choose between the cards`,
      }
    }
    seen.add(townshipKey)

    rows.push({ townshipKey, townshipName, window })
  }

  if (rows.length === 0) {
    return { status: "parse_error", detail: "no township cards found in the assessor calendar" }
  }

  return { status: "ok", rows }
}

/* -------------------------------------------------------------------------- */
/* Board of Review: open/close PDF                                            */
/* -------------------------------------------------------------------------- */

/**
 * The Board's PDF is a digitally produced single page: a rotated table where
 * each *group* of townships shares one open/close row. The text layer is real
 * (plain ASCII strings shown with `Tj`/`TJ`), so extraction is a bounded,
 * deterministic read of the PDF content stream — no OCR, no AI, no external
 * converter, no browser.
 *
 * The interpreter below models exactly the constructs this document uses and
 * treats anything else as a parse error. That is deliberate: when the Board
 * changes the layout, the refresh must fail loudly and wait for a human, not
 * guess at a homeowner's filing deadline.
 */

type PdfChunk = {
  /** Position across the reading lines (device x; the page is rotated 90°). */
  line: number
  /** Position along the reading direction (device y). */
  along: number
  /** Cell texts, split where the county's typesetter jumped columns. */
  segments: string[]
}

const latin1 = (bytes: Uint8Array): string => {
  let out = ""
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return out
}

/** Column jumps inside a TJ array are thousands of units; kerns are tens. */
const TJ_COLUMN_JUMP = 500

type PdfTextResult =
  | { ok: true; chunks: PdfChunk[] }
  | { ok: false; detail: string }

function extractPdfText(bytes: Uint8Array): PdfTextResult {
  const raw = latin1(bytes)
  if (!raw.startsWith("%PDF-")) return { ok: false, detail: "not a PDF" }

  // Exactly one page, located by its uncompressed page dictionary. A page
  // count change means the Board reshaped the publication.
  const pageDicts = [...raw.matchAll(/(\d+)\s+0\s+obj\s*<<([^]*?)>>/g)].filter(
    ([, , dict]) => /\/Type\s*\/Page\b/.test(dict) && !/\/Type\s*\/Pages\b/.test(dict),
  )
  if (pageDicts.length !== 1) {
    return { ok: false, detail: `expected exactly one page, found ${pageDicts.length}` }
  }

  const contentsRef = /\/Contents\s+(\d+)\s+0\s+R\b/.exec(pageDicts[0][2])
  if (!contentsRef) {
    return { ok: false, detail: "page has no single /Contents stream reference" }
  }

  const streamHead = new RegExp(
    `(?:^|[^0-9])${contentsRef[1]}\\s+0\\s+obj\\s*<<([^]*?)>>\\s*stream\\r?\\n`,
  ).exec(raw)
  if (!streamHead) return { ok: false, detail: "content stream object not found" }

  const dict = streamHead[1]
  const length = /\/Length\s+(\d+)\b/.exec(dict)
  if (!length) return { ok: false, detail: "content stream /Length is not a direct integer" }
  if (/\/DecodeParms\b/.test(dict)) {
    return { ok: false, detail: "content stream carries unexpected /DecodeParms" }
  }
  const filter = /\/Filter\s*\/(\w+)/.exec(dict)
  if (filter && filter[1] !== "FlateDecode") {
    return { ok: false, detail: `unsupported content stream filter /${filter[1]}` }
  }

  const start = streamHead.index + streamHead[0].length
  const streamBytes = bytes.slice(start, start + Number(length[1]))
  let content: string
  try {
    content = filter
      ? latin1(new Uint8Array(inflateSync(streamBytes)))
      : latin1(streamBytes)
  } catch (error) {
    return {
      ok: false,
      detail: `content stream failed to inflate: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return interpretContentStream(content)
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "name"; value: string }
  | { kind: "arrayStart" }
  | { kind: "arrayEnd" }
  | { kind: "op"; value: string }

function tokenizeContentStream(content: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < content.length) {
    const ch = content[i]
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f") {
      i += 1
    } else if (ch === "%") {
      while (i < content.length && content[i] !== "\n" && content[i] !== "\r") i += 1
    } else if (ch === "[") {
      tokens.push({ kind: "arrayStart" })
      i += 1
    } else if (ch === "]") {
      tokens.push({ kind: "arrayEnd" })
      i += 1
    } else if (ch === "/") {
      let j = i + 1
      while (j < content.length && /[^\s[\]()<>/%]/.test(content[j])) j += 1
      tokens.push({ kind: "name", value: content.slice(i + 1, j) })
      i = j
    } else if (ch === "(") {
      let depth = 1
      let j = i + 1
      let value = ""
      while (j < content.length && depth > 0) {
        const c = content[j]
        if (c === "\\") {
          const next = content[j + 1]
          if (next === "n") value += "\n"
          else if (next === "r") value += "\r"
          else if (next === "t") value += "\t"
          else if (next === "b" || next === "f") value += ""
          else if (next >= "0" && next <= "7") {
            const octal = /^[0-7]{1,3}/.exec(content.slice(j + 1))![0]
            value += String.fromCharCode(parseInt(octal, 8))
            j += octal.length - 1
          } else value += next
          j += 2
        } else if (c === "(") {
          depth += 1
          value += c
          j += 1
        } else if (c === ")") {
          depth -= 1
          if (depth > 0) value += c
          j += 1
        } else {
          value += c
          j += 1
        }
      }
      if (depth !== 0) return null
      tokens.push({ kind: "string", value })
      i = j
    } else if (ch === "<") {
      // Hex strings and inline dicts are not part of this document's layout.
      return null
    } else if (/[-+.\d]/.test(ch)) {
      const match = /^[-+]?(?:\d+\.?\d*|\.\d+)/.exec(content.slice(i))
      if (!match) return null
      tokens.push({ kind: "number", value: Number(match[0]) })
      i += match[0].length
    } else {
      let j = i
      while (j < content.length && /[A-Za-z'"*0-9]/.test(content[j])) j += 1
      if (j === i) return null
      tokens.push({ kind: "op", value: content.slice(i, j) })
      i = j
    }
  }
  return tokens
}

/** Operators this layout uses outside text objects; anything else refuses. */
const IGNORED_GRAPHICS_OPS = new Set([
  "g", "G", "rg", "RG", "gs", "re", "f", "f*", "W", "n", "m", "l", "c", "v",
  "y", "h", "i", "j", "J", "w", "d", "M", "Do", "cs", "CS", "sc", "scn", "SC",
  "SCN", "BDC", "BMC", "EMC", "S", "s", "B", "b",
])

const TEXT_STATE_OPS = new Set(["Tf", "Tc", "Tw", "TL", "g", "G", "rg", "RG", "gs"])

function interpretContentStream(content: string): PdfTextResult {
  const tokens = tokenizeContentStream(content)
  if (!tokens) return { ok: false, detail: "content stream failed to tokenize" }

  const chunks: PdfChunk[] = []
  const identity = [1, 0, 0, 1, 0, 0]
  let ctm = [...identity]
  const ctmStack: number[][] = []
  let inText = false
  let tm: number[] | null = null
  let lm: number[] | null = null
  let leading = 0
  let moved = true

  const stack: Token[] = []
  const num = (t: Token | undefined): number | null =>
    t && t.kind === "number" ? t.value : null

  const show = (segments: string[]): { ok: false; detail: string } | null => {
    if (!tm) return { ok: false, detail: "text shown before Tm set a position" }
    const [a, b, c, d, e, f] = tm
    if (a !== 0 || d !== 0 || b <= 0 || c >= 0) {
      return {
        ok: false,
        detail: `text matrix [${tm.join(" ")}] is not the rotated layout this parser pins`,
      }
    }
    if (!moved && chunks.length > 0) {
      // A second show at the same position continues the previous chunk.
      const prev = chunks[chunks.length - 1]
      const first = segments.shift()
      if (first !== undefined) {
        prev.segments[prev.segments.length - 1] += first
        prev.segments.push(...segments)
      }
    } else {
      chunks.push({ line: e, along: f, segments })
    }
    moved = false
    return null
  }

  for (const token of tokens) {
    if (token.kind !== "op") {
      stack.push(token)
      continue
    }
    const op = token.value
    if (op === "q") {
      ctmStack.push([...ctm])
    } else if (op === "Q") {
      ctm = ctmStack.pop() ?? [...identity]
    } else if (op === "cm") {
      const [a, b, c, d, e, f] = stack.slice(-6).map((t) => num(t) ?? NaN)
      ctm = [
        a * ctm[0] + b * ctm[2],
        a * ctm[1] + b * ctm[3],
        c * ctm[0] + d * ctm[2],
        c * ctm[1] + d * ctm[3],
        e * ctm[0] + f * ctm[2] + ctm[4],
        e * ctm[1] + f * ctm[3] + ctm[5],
      ]
    } else if (op === "BT") {
      if (ctm.some((v, idx) => v !== identity[idx])) {
        return { ok: false, detail: "text object under a transformed CTM; layout changed" }
      }
      inText = true
      tm = null
      lm = null
      moved = true
    } else if (op === "ET") {
      inText = false
    } else if (!inText) {
      if (!IGNORED_GRAPHICS_OPS.has(op)) {
        return { ok: false, detail: `unsupported graphics operator "${op}"` }
      }
    } else if (op === "Tm") {
      const values = stack.slice(-6).map((t) => num(t))
      if (values.some((v) => v === null)) {
        return { ok: false, detail: "malformed Tm operands" }
      }
      tm = values as number[]
      lm = [...tm]
      moved = true
    } else if (op === "Td" || op === "TD") {
      const ty = num(stack[stack.length - 1])
      const tx = num(stack[stack.length - 2])
      if (tx === null || ty === null || !lm) {
        return { ok: false, detail: `malformed ${op} before a text matrix` }
      }
      if (op === "TD") leading = -ty
      const [a, b, c, d, e, f]: number[] = lm
      lm = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f]
      tm = [...lm]
      moved = true
    } else if (op === "T*") {
      if (!lm) return { ok: false, detail: "T* before a text matrix" }
      const [a, b, c, d, e, f]: number[] = lm
      lm = [a, b, c, d, -leading * c + e, -leading * d + f]
      tm = [...lm]
      moved = true
    } else if (op === "Tj") {
      const text = stack[stack.length - 1]
      if (!text || text.kind !== "string") return { ok: false, detail: "malformed Tj" }
      const failure = show([text.value])
      if (failure) return failure
    } else if (op === "TJ") {
      const end = stack.length - 1
      if (!stack[end] || stack[end].kind !== "arrayEnd") {
        return { ok: false, detail: "malformed TJ" }
      }
      let startIdx = end - 1
      while (startIdx >= 0 && stack[startIdx].kind !== "arrayStart") startIdx -= 1
      if (startIdx < 0) return { ok: false, detail: "malformed TJ" }
      const segments: string[] = [""]
      for (const item of stack.slice(startIdx + 1, end)) {
        if (item.kind === "string") {
          segments[segments.length - 1] += item.value
        } else if (item.kind === "number") {
          if (Math.abs(item.value) >= TJ_COLUMN_JUMP) segments.push("")
        } else {
          return { ok: false, detail: "unexpected token inside TJ array" }
        }
      }
      const failure = show(segments)
      if (failure) return failure
    } else if (TEXT_STATE_OPS.has(op)) {
      // Colour, font, and spacing state do not move text between cells.
    } else {
      return { ok: false, detail: `unsupported text operator "${op}"` }
    }
    stack.length = 0
  }

  return { ok: true, chunks }
}

type PdfLine = { line: number; segments: string[] }

/** Cluster chunks into printed lines, then lines into table blocks. */
function toBlocks(chunks: PdfChunk[]): PdfLine[][] {
  const sorted = [...chunks].sort((a, b) => a.line - b.line || a.along - b.along)
  const lines: Array<{ line: number; chunks: PdfChunk[] }> = []
  for (const chunk of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(chunk.line - last.line) <= 2) last.chunks.push(chunk)
    else lines.push({ line: chunk.line, chunks: [chunk] })
  }

  const flat: PdfLine[] = lines.map(({ line, chunks: lineChunks }) => ({
    line,
    segments: lineChunks
      .sort((a, b) => a.along - b.along)
      .flatMap((c) => c.segments)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s !== ""),
  }))

  const blocks: PdfLine[][] = []
  for (const line of flat) {
    const currentBlock = blocks[blocks.length - 1]
    const previousLine = currentBlock?.[currentBlock.length - 1]
    if (previousLine && line.line - previousLine.line <= 12) currentBlock.push(line)
    else blocks.push([line])
  }
  return blocks
}

const PRINTED_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/

/**
 * Parse the Board's township open/close PDF.
 *
 * The document is: a title line, a header block naming the columns, then one
 * block per group — the group's townships listed vertically with a single
 * dates line (open for filing, closed for filing, and optionally an evidence
 * deadline) centred beside them. The exemptions block ("Exemptions /
 * (1st Installment) / All townships") is a filing session for exemption
 * complaints, not a township appeal window, and is recognised and skipped
 * explicitly. Anything not matching one of these shapes fails the stage.
 */
export function parseBorOpenClosePdf(bytes: Uint8Array): CalendarParse {
  const extracted = extractPdfText(bytes)
  if (!extracted.ok) {
    return { status: "parse_error", detail: `PDF text extraction failed: ${extracted.detail}` }
  }

  const blocks = toBlocks(extracted.chunks)
  const allText = blocks
    .flat()
    .flatMap((line) => line.segments)
    .join(" ")

  // Whitespace-insensitive: the typesetter splits "REVIEW" across two chunks.
  if (!/BOARDOFREVIEWDATESANDDEADLINES\d{4}SESSION/.test(allText.replace(/\s+/g, ""))) {
    return {
      status: "schema_error",
      detail: "PDF title is not the Board's dates-and-deadlines session document",
    }
  }

  const headerIndex = blocks.findIndex((block) =>
    block.some((line) => line.segments.some((s) => s === "GROUP")),
  )
  if (headerIndex === -1) {
    return { status: "schema_error", detail: "column header block (GROUP/TOWNSHIP/...) not found" }
  }
  const headerText = blocks[headerIndex].flatMap((l) => l.segments).join(" | ")
  for (const label of ["GROUP", "TOWNSHIP", "OPEN FOR", "CLOSED FOR", "FILING COMPLAINT"]) {
    if (!headerText.includes(label)) {
      return {
        status: "schema_error",
        detail: `column headers changed: "${label}" missing from "${headerText}"`,
      }
    }
  }

  const rows: CalendarRow[] = []
  const seen = new Set<string>()

  for (const block of blocks.slice(headerIndex + 1)) {
    const isTitleBlock = block.some((line) =>
      line.segments.some((s) => s.includes("BOARD OF REVI")),
    )
    if (isTitleBlock) continue

    const textSegments: string[] = []
    const dateLines: string[][] = []
    for (const line of block) {
      const dates = line.segments.filter((s) => PRINTED_DATE_RE.test(s))
      const texts = line.segments.filter((s) => !PRINTED_DATE_RE.test(s))
      // A cell of prose must never follow a date on the same line; columns
      // right of the deadlines hold dates or hearing-type words, and a word
      // there means segmentation drifted.
      if (dates.length > 0) {
        const firstDate = line.segments.findIndex((s) => PRINTED_DATE_RE.test(s))
        if (line.segments.slice(firstDate).some((s) => !PRINTED_DATE_RE.test(s))) {
          return {
            status: "schema_error",
            detail: `text after a date on one line: ${line.segments.join(" | ")}`,
          }
        }
        dateLines.push(dates)
      }
      textSegments.push(...texts)
    }

    const isExemptions = textSegments.some((s) => /exemption/i.test(s))
    if (isExemptions) {
      if (textSegments.some((s) => /^\d+$/.test(s))) {
        return {
          status: "schema_error",
          detail: "exemptions block carries a numeric group id; layout changed",
        }
      }
      continue
    }

    if (dateLines.length !== 1) {
      return {
        status: "schema_error",
        detail: `group block has ${dateLines.length} dates lines: ${block
          .map((l) => l.segments.join(" "))
          .join(" / ")}`,
      }
    }
    const dates = dateLines[0]
    if (dates.length < 2 || dates.length > 3) {
      return {
        status: "schema_error",
        detail: `group block has ${dates.length} dates; expected open, close, and at most an evidence deadline`,
      }
    }

    const groupIds = textSegments.filter((s) => /^\d+$/.test(s))
    const names = textSegments.filter((s) => !/^\d+$/.test(s))
    if (groupIds.length !== 1) {
      return {
        status: "schema_error",
        detail: `group block has ${groupIds.length} group ids: ${textSegments.join(" | ")}`,
      }
    }
    if (names.length === 0) {
      return { status: "schema_error", detail: `group ${groupIds[0]} lists no townships` }
    }

    const openDate = parsePrintedDate(dates[0])
    const lastFileDate = parsePrintedDate(dates[1])
    if (openDate === null || lastFileDate === null) {
      return {
        status: "schema_error",
        detail: `group ${groupIds[0]}: unreadable dates "${dates[0]}" / "${dates[1]}"`,
      }
    }
    if (openDate > lastFileDate) {
      return {
        status: "schema_error",
        detail: `group ${groupIds[0]}: window closes ${lastFileDate} before it opens ${openDate}`,
      }
    }

    for (const townshipName of names) {
      if (!/^[A-Za-z][A-Za-z .'-]*$/.test(townshipName) || /township/i.test(townshipName)) {
        return {
          status: "schema_error",
          detail: `group ${groupIds[0]}: "${townshipName}" does not look like a township name`,
        }
      }
      const townshipKey = townshipKeyFromName(townshipName)
      if (seen.has(townshipKey)) {
        return {
          status: "schema_error",
          detail: `${townshipKey}: listed twice; refusing to choose between the rows`,
        }
      }
      seen.add(townshipKey)
      rows.push({
        townshipKey,
        townshipName,
        window: { noticeDate: null, openDate, lastFileDate },
      })
    }
  }

  if (rows.length === 0) {
    return { status: "parse_error", detail: "PDF contained no township group rows" }
  }

  return { status: "ok", rows }
}

/* -------------------------------------------------------------------------- */
/* Building                                                                   */
/* -------------------------------------------------------------------------- */

export type StageFailure = {
  stage: DeadlineStage
  parseStatus: Exclude<ParseStatus, "ok">
  detail: string
}

export type BuildResult =
  | { ok: true; snapshot: OfficialDeadlineSnapshot }
  | { ok: false; failures: StageFailure[] }

function parseStageBody(stage: DeadlineStage, body: Uint8Array): CalendarParse {
  if (stage === "bor") return parseBorOpenClosePdf(body)
  const html = decodeUtf8(body)
  if (html === null) {
    return { status: "parse_error", detail: "assessor body is not valid UTF-8" }
  }
  return parseAssessorCalendar(html)
}

async function fetchStage(
  stage: DeadlineStage,
  fetchSource: SourceFetcher,
  now: string,
  expectedSha256?: string,
): Promise<
  | { ok: true; provenance: SourceProvenance; rows: CalendarRow[] }
  | { ok: false; failure: StageFailure }
> {
  const { authority, url } = SOURCES[stage]

  let response: FetchedSource
  try {
    response = await fetchSource(url)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, failure: { stage, parseStatus: "http_error", detail } }
  }

  if (response.status !== 200) {
    return {
      ok: false,
      failure: { stage, parseStatus: "http_error", detail: `${url} returned ${response.status}` },
    }
  }

  // The hash of the exact bytes that arrived — for the Board that is the PDF
  // file itself, byte for byte, never a decoding of it.
  const contentSha256 = sha256Hex(response.body)
  if (expectedSha256 && expectedSha256 !== contentSha256) {
    return {
      ok: false,
      failure: {
        stage,
        parseStatus: "hash_error",
        detail: `${url}: expected ${expectedSha256}, got ${contentSha256}`,
      },
    }
  }

  const parsed = parseStageBody(stage, response.body)
  if (parsed.status !== "ok") {
    return { ok: false, failure: { stage, parseStatus: parsed.status, detail: parsed.detail } }
  }

  return {
    ok: true,
    rows: parsed.rows,
    provenance: {
      authority,
      sourceUrl: url,
      retrievedAt: now,
      // Left null deliberately. Some county pages print a "last updated" line
      // and some do not, and a value scraped from prose is not reliable enough
      // to carry as provenance. `retrievedAt` is the timestamp that matters.
      sourceUpdatedAt: null,
      contentSha256,
      httpStatus: response.status,
      finalUrl: response.finalUrl,
      parseStatus: "ok",
      parserVersion: PARSER_VERSION,
    },
  }
}

export async function buildSnapshot(input: {
  fetchSource: SourceFetcher
  now: string
  /** True when the rows came from local fixtures rather than the county. */
  synthetic: boolean
  expectedSha256?: Partial<Record<DeadlineStage, string>>
}): Promise<BuildResult> {
  const { fetchSource, now, synthetic, expectedSha256 } = input

  if (Number.isNaN(Date.parse(now))) {
    return {
      ok: false,
      failures: [
        { stage: "assessor", parseStatus: "schema_error", detail: `unusable retrieval instant: ${now}` },
      ],
    }
  }

  const stages: DeadlineStage[] = ["assessor", "bor"]

  // Every stage is attempted even after one fails, so an operator sees the
  // whole picture in one run instead of fixing them one deploy at a time.
  const results = await Promise.all(
    stages.map((stage) => fetchStage(stage, fetchSource, now, expectedSha256?.[stage])),
  )

  const failures = results.flatMap((r) => (r.ok ? [] : [r.failure]))
  if (failures.length > 0) return { ok: false, failures }

  const sources: OfficialDeadlineSnapshot["sources"] = {}
  const townships: Record<string, TownshipSnapshotRow> = {}

  results.forEach((result, index) => {
    if (!result.ok) return
    const stage = stages[index]
    sources[stage] = result.provenance

    for (const row of result.rows) {
      const existing = townships[row.townshipKey] ?? {
        townshipName: row.townshipName,
        stages: {},
      }
      existing.stages[stage] = row.window
      townships[row.townshipKey] = existing
    }
  })

  return {
    ok: true,
    snapshot: { schemaVersion: SCHEMA_VERSION, synthetic, sources, townships },
  }
}

/* -------------------------------------------------------------------------- */
/* Publication                                                                */
/* -------------------------------------------------------------------------- */

export type SnapshotIO = {
  writeFile: (path: string, body: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  unlink: (path: string) => Promise<void>
}

/**
 * Write the snapshot atomically: temp file, then rename.
 *
 * The rename is the point. Writing the target in place means a reader — a
 * build, a running server — can observe a truncated JSON document, and a
 * snapshot that fails to parse is indistinguishable at the call site from one
 * that is merely absent.
 */
export async function publishSnapshot(
  path: string,
  snapshot: OfficialDeadlineSnapshot,
  io: SnapshotIO,
): Promise<void> {
  const tmp = `${path}.tmp`
  const body = `${JSON.stringify(snapshot, null, 2)}\n`

  await io.writeFile(tmp, body)
  try {
    await io.rename(tmp, path)
  } catch (error) {
    // Leave no half-published temp file behind, and leave the existing target
    // exactly as it was.
    await io.unlink(tmp).catch(() => {})
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Refresh the snapshot from the live county calendars.
 *
 * Requires `--allow-network` explicitly. This has not been run in the rebuild
 * task, and the committed snapshot is synthetic; a real refresh is a separate
 * authorisation because it is an outbound call to a public source.
 */
export async function main(argv: string[]): Promise<number> {
  if (!argv.includes("--allow-network")) {
    console.error(
      "refresh-township-deadlines: refusing to run.\n" +
        "This script fetches live Cook County pages. Re-run with --allow-network\n" +
        "once that call is authorised.",
    )
    return 2
  }

  const { writeFile, rename, unlink } = await import("node:fs/promises")

  const fetchSource: SourceFetcher = async (url) => {
    const response = await fetch(url, { redirect: "follow" })
    return {
      status: response.status,
      finalUrl: response.url,
      body: new Uint8Array(await response.arrayBuffer()),
    }
  }

  const built = await buildSnapshot({
    fetchSource,
    now: new Date().toISOString(),
    synthetic: false,
  })

  if (!built.ok) {
    for (const failure of built.failures) {
      console.error(`  ${failure.stage}: ${failure.parseStatus} — ${failure.detail}`)
    }
    console.error("Nothing written: a snapshot is published whole or not at all.")
    return 1
  }

  await publishSnapshot(SNAPSHOT_PATH, built.snapshot, { writeFile, rename, unlink })
  console.log(`Wrote ${SNAPSHOT_PATH} (${Object.keys(built.snapshot.townships).length} townships)`)
  return 0
}

// Referenced so the resolution contract and this builder stay type-coupled: the
// township keys written here are the keys `resolveTownship` produces.
export type SnapshotTownshipKey = TownshipResolution["townshipKey"]
