/**
 * Build `data/deadlines/cook-county.json` from the county's published calendars.
 *
 * This is the only code on the branch permitted to turn a web page into a date.
 * Everything downstream trusts it, so it is built to refuse:
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
 * NOTE: this script has never been run against live county sources. The
 * committed snapshot was built from local fixtures and is marked
 * `synthetic: true`, which `evaluateOfficialDeadlineState` refuses outright.
 */

import { createHash } from "node:crypto"

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
  TownshipSnapshotRow,
} from "@/lib/deadlines/official-source-state"

export const PARSER_VERSION = "1.0.0"
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
    url: "https://www.cookcountyboardofreview.com/appeal-calendar",
  },
}

export type FetchedSource = {
  status: number
  finalUrl: string
  body: string
}

export type SourceFetcher = (url: string) => Promise<FetchedSource>

export type CalendarRow = {
  townshipKey: string
  townshipName: string
  noticeDate: string | null
  openDate: string
  lastFileDate: string
}

export type CalendarParse =
  | { status: "ok"; rows: CalendarRow[] }
  | { status: Exclude<ParseStatus, "ok">; detail: string }

export function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex")
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
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

/**
 * Parse a county calendar table.
 *
 * Accepts a four-column table (township, notice, open, last file) or a
 * three-column one (township, open, last file) — the Board publishes the
 * shorter form. Any other shape is a schema error rather than a best guess.
 */
export function parseCountyCalendar(html: string): CalendarParse {
  if (html.startsWith("%PDF")) {
    return {
      status: "parse_error",
      detail: "body is a PDF; this parser reads the HTML calendar only",
    }
  }

  const rows: CalendarRow[] = []
  const seen = new Map<string, string>()
  let sawTable = false

  for (const [, tableBody] of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    for (const [, rowBody] of tableBody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowBody.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
        stripTags(m[1]),
      )
      if (cells.length === 0) continue

      // Header rows carry no dates at all; that is how they are recognised,
      // rather than by position, so a table with a caption row above the header
      // does not shift everything by one.
      const isHeader = cells.slice(1).every((cell) => parsePrintedDate(cell) === null)
      if (isHeader && rows.length === 0) {
        sawTable = true
        continue
      }

      sawTable = true

      const townshipName = cells[0]
      if (!townshipName) {
        return { status: "schema_error", detail: `row with no township name: ${cells.join(" | ")}` }
      }

      let printedNotice: string | null
      let printedOpen: string
      let printedLastFile: string

      if (cells.length === 4) {
        printedNotice = cells[1]
        printedOpen = cells[2]
        printedLastFile = cells[3]
      } else if (cells.length === 3) {
        printedNotice = null
        printedOpen = cells[1]
        printedLastFile = cells[2]
      } else {
        return {
          status: "schema_error",
          detail: `${townshipName}: expected 3 or 4 cells, found ${cells.length}`,
        }
      }

      const noticeDate = printedNotice === null ? null : parsePrintedDate(printedNotice)
      if (printedNotice !== null && noticeDate === null) {
        return { status: "schema_error", detail: `${townshipName}: unreadable date "${printedNotice}"` }
      }

      const openDate = parsePrintedDate(printedOpen)
      if (openDate === null) {
        return { status: "schema_error", detail: `${townshipName}: unreadable date "${printedOpen}"` }
      }

      const lastFileDate = parsePrintedDate(printedLastFile)
      if (lastFileDate === null) {
        return {
          status: "schema_error",
          detail: `${townshipName}: unreadable date "${printedLastFile}"`,
        }
      }

      if (openDate > lastFileDate) {
        return {
          status: "schema_error",
          detail: `${townshipName}: window closes ${lastFileDate} before it opens ${openDate}`,
        }
      }

      const townshipKey = townshipKeyFromName(townshipName)
      if (seen.has(townshipKey)) {
        return {
          status: "schema_error",
          detail: `${townshipKey}: listed twice; refusing to choose between the rows`,
        }
      }
      seen.set(townshipKey, townshipName)

      rows.push({ townshipKey, townshipName, noticeDate, openDate, lastFileDate })
    }
  }

  if (rows.length === 0) {
    return {
      status: "parse_error",
      detail: sawTable ? "calendar table contained no rows" : "no calendar table found",
    }
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

  const parsed = parseCountyCalendar(response.body)
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
      existing.stages[stage] = {
        noticeDate: row.noticeDate,
        openDate: row.openDate,
        lastFileDate: row.lastFileDate,
      }
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
    return { status: response.status, finalUrl: response.url, body: await response.text() }
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
