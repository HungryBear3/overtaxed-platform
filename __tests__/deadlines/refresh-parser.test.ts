/** @jest-environment node */

/**
 * The snapshot builder.
 *
 * This is the only thing on the branch permitted to turn a county web page into
 * a date. Everything downstream — the state, the projection, all 52 consumer
 * paths — trusts whatever comes out of here, so the interesting tests are the
 * ones where it refuses.
 *
 * Two properties matter most:
 *
 *   1. **No partial publication.** A snapshot is published whole or not at all.
 *      A build where the Assessor page parsed and the Board's page 404'd must
 *      write nothing, because the alternative is a file that looks current and
 *      is silently half a cycle old on one stage.
 *   2. **No network by accident.** Fetching is injected. The tests below never
 *      touch the county, and `main()` refuses to run without an explicit
 *      opt-in flag, because a refresh script that reaches out on import is one
 *      `import` away from being an unauthorised provider call.
 */

import {
  parseCountyCalendar,
  sha256Hex,
  buildSnapshot,
  publishSnapshot,
  SOURCES,
  type FetchedSource,
  type SourceFetcher,
} from "@/scripts/refresh-township-deadlines"

const NOW = "2026-06-25T13:00:00.000Z"

const ASSESSOR_HTML = `
<html><body>
<table class="assessment-calendar">
  <tr><th>Township</th><th>Notice Date</th><th>Appeals Open</th><th>Last File Date</th></tr>
  <tr><td>Rogers Park</td><td>June 1, 2026</td><td>June 15, 2026</td><td>July 15, 2026</td></tr>
  <tr><td>Oak Park</td><td>May 4, 2026</td><td>05/18/2026</td><td>06/17/2026</td></tr>
</table>
</body></html>`

const BOR_HTML = `
<html><body>
<table class="appeal-calendar">
  <tr><th>Township</th><th>Opens</th><th>Closes</th></tr>
  <tr><td>Rogers Park</td><td>August 3, 2026</td><td>September 2, 2026</td></tr>
</table>
</body></html>`

const fetched = (body: string, over: Partial<FetchedSource> = {}): FetchedSource => ({
  status: 200,
  finalUrl: "https://example.gov/calendar",
  body,
  ...over,
})

/** A fetcher that serves fixtures and records that it was asked. */
function fixtureFetcher(bodies: Record<string, FetchedSource | Error>): SourceFetcher {
  return jest.fn(async (url: string) => {
    const hit = bodies[url]
    if (!hit) throw new Error(`no fixture for ${url}`)
    if (hit instanceof Error) throw hit
    return hit
  })
}

const assessorUrl = SOURCES.assessor.url
const borUrl = SOURCES.bor.url

const bothStages = (over: Record<string, FetchedSource | Error> = {}) =>
  fixtureFetcher({
    [assessorUrl]: fetched(ASSESSOR_HTML, { finalUrl: assessorUrl }),
    [borUrl]: fetched(BOR_HTML, { finalUrl: borUrl }),
    ...over,
  })

describe("sha256Hex", () => {
  it("hashes the exact bytes retrieved", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
    expect(sha256Hex(ASSESSOR_HTML)).toHaveLength(64)
    expect(sha256Hex(ASSESSOR_HTML)).not.toBe(sha256Hex(`${ASSESSOR_HTML} `))
  })
})

describe("parseCountyCalendar", () => {
  it("reads the assessor table into normalised county dates", () => {
    const result = parseCountyCalendar(ASSESSOR_HTML)

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return

    expect(result.rows).toEqual([
      {
        townshipKey: "rogers-park",
        townshipName: "Rogers Park",
        noticeDate: "2026-06-01",
        openDate: "2026-06-15",
        lastFileDate: "2026-07-15",
      },
      {
        townshipKey: "oak-park",
        townshipName: "Oak Park",
        noticeDate: "2026-05-04",
        openDate: "2026-05-18",
        lastFileDate: "2026-06-17",
      },
    ])
  })

  it("reads a three-column table as a window with no notice date", () => {
    const result = parseCountyCalendar(BOR_HTML)

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return

    expect(result.rows).toEqual([
      {
        townshipKey: "rogers-park",
        townshipName: "Rogers Park",
        noticeDate: null,
        openDate: "2026-08-03",
        lastFileDate: "2026-09-02",
      },
    ])
  })

  it("reports parse_error on markup with no calendar table in it", () => {
    for (const body of ["", "<html><body><p>Down for maintenance</p></body></html>"]) {
      expect(parseCountyCalendar(body).status).toBe("parse_error")
    }
  })

  it("reports parse_error on a PDF or other binary body", () => {
    // The county publishes some calendars as PDFs. A PDF handed to an HTML
    // parser used to yield zero rows, which is indistinguishable from "no
    // townships are open" if nobody checks the status.
    const pdf = `%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj<</Type/Catalog>>endobj`

    expect(parseCountyCalendar(pdf).status).toBe("parse_error")
  })

  it("reports schema_error when a row is malformed rather than skipping it", () => {
    // Skipping the bad row is the tempting behaviour and the wrong one: the
    // township silently vanishes from the snapshot, and a vanished township
    // renders as "no date available" forever without anyone being told why.
    const missingCell = `
      <table><tr><th>Township</th><th>Notice</th><th>Open</th><th>Close</th></tr>
      <tr><td>Rogers Park</td><td>June 1, 2026</td><td>June 15, 2026</td><td>July 15, 2026</td></tr>
      <tr><td>Oak Park</td><td>May 4, 2026</td></tr></table>`

    const result = parseCountyCalendar(missingCell)

    expect(result.status).toBe("schema_error")
    expect(result.status === "schema_error" && result.detail).toMatch(/Oak Park/)
  })

  it("reports schema_error on an unreadable date rather than guessing the year", () => {
    const badDate = `
      <table><tr><th>Township</th><th>Notice</th><th>Open</th><th>Close</th></tr>
      <tr><td>Rogers Park</td><td>June 1, 2026</td><td>June 15</td><td>July 15, 2026</td></tr></table>`

    const result = parseCountyCalendar(badDate)

    expect(result.status).toBe("schema_error")
    expect(result.status === "schema_error" && result.detail).toMatch(/June 15/)
  })

  it("reports schema_error when a window closes before it opens", () => {
    const inverted = `
      <table><tr><th>Township</th><th>Notice</th><th>Open</th><th>Close</th></tr>
      <tr><td>Rogers Park</td><td>June 1, 2026</td><td>July 15, 2026</td><td>June 15, 2026</td></tr></table>`

    expect(parseCountyCalendar(inverted).status).toBe("schema_error")
  })

  it("reports schema_error on a duplicated township rather than picking one", () => {
    const duplicated = `
      <table><tr><th>Township</th><th>Notice</th><th>Open</th><th>Close</th></tr>
      <tr><td>Rogers Park</td><td>June 1, 2026</td><td>June 15, 2026</td><td>July 15, 2026</td></tr>
      <tr><td>Rogers Park</td><td>June 1, 2026</td><td>June 15, 2026</td><td>August 20, 2026</td></tr></table>`

    const result = parseCountyCalendar(duplicated)

    expect(result.status).toBe("schema_error")
    expect(result.status === "schema_error" && result.detail).toMatch(/rogers-park/)
  })
})

describe("buildSnapshot", () => {
  it("builds a whole snapshot with provenance for every stage", async () => {
    const fetcher = bothStages()

    const result = await buildSnapshot({ fetchSource: fetcher, now: NOW, synthetic: false })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { snapshot } = result
    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.synthetic).toBe(false)

    const assessor = snapshot.sources.assessor
    expect(assessor).toMatchObject({
      authority: "cook_county_assessor",
      sourceUrl: assessorUrl,
      finalUrl: assessorUrl,
      httpStatus: 200,
      parseStatus: "ok",
      retrievedAt: NOW,
    })
    expect(assessor?.contentSha256).toBe(sha256Hex(ASSESSOR_HTML))

    expect(snapshot.sources.bor).toMatchObject({
      authority: "cook_county_board_of_review",
      parseStatus: "ok",
    })

    // Stages stay separate all the way through: Rogers Park has both, Oak Park
    // appears only on the Assessor's calendar and must not acquire a Board
    // window it was never listed for.
    expect(snapshot.townships["rogers-park"].stages).toEqual({
      assessor: { noticeDate: "2026-06-01", openDate: "2026-06-15", lastFileDate: "2026-07-15" },
      bor: { noticeDate: null, openDate: "2026-08-03", lastFileDate: "2026-09-02" },
    })
    expect(snapshot.townships["oak-park"].stages.bor ?? null).toBeNull()
  })

  it("marks the snapshot synthetic when it was built from fixtures", async () => {
    const result = await buildSnapshot({
      fetchSource: bothStages(),
      now: NOW,
      synthetic: true,
    })

    expect(result.ok && result.snapshot.synthetic).toBe(true)
  })

  it("publishes nothing when one stage returns a non-200", async () => {
    const result = await buildSnapshot({
      fetchSource: bothStages({ [borUrl]: fetched("Not Found", { status: 404 }) }),
      now: NOW,
      synthetic: false,
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failures).toEqual([
      { stage: "bor", parseStatus: "http_error", detail: expect.stringContaining("404") },
    ])
  })

  it("publishes nothing when one stage fails to parse", async () => {
    const result = await buildSnapshot({
      fetchSource: bothStages({ [assessorUrl]: fetched("<html>maintenance</html>") }),
      now: NOW,
      synthetic: false,
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failures[0]).toMatchObject({
      stage: "assessor",
      parseStatus: "parse_error",
    })
  })

  it("publishes nothing when the fetch itself throws", async () => {
    const result = await buildSnapshot({
      fetchSource: bothStages({ [borUrl]: new Error("ETIMEDOUT") }),
      now: NOW,
      synthetic: false,
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failures[0]).toMatchObject({
      stage: "bor",
      parseStatus: "http_error",
      detail: expect.stringContaining("ETIMEDOUT"),
    })
  })

  it("reports hash_error when a pinned digest does not match what arrived", async () => {
    const result = await buildSnapshot({
      fetchSource: bothStages(),
      now: NOW,
      synthetic: false,
      expectedSha256: { assessor: "b".repeat(64) },
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failures[0]).toMatchObject({
      stage: "assessor",
      parseStatus: "hash_error",
    })
  })

  it("collects every stage failure rather than stopping at the first", async () => {
    const result = await buildSnapshot({
      fetchSource: bothStages({
        [assessorUrl]: fetched("<html>maintenance</html>"),
        [borUrl]: fetched("Not Found", { status: 404 }),
      }),
      now: NOW,
      synthetic: false,
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failures.map((f) => f.stage).sort()).toEqual([
      "assessor",
      "bor",
    ])
  })

  it("refuses a retrieval instant it cannot parse", async () => {
    const result = await buildSnapshot({
      fetchSource: bothStages(),
      now: "sometime tuesday",
      synthetic: false,
    })

    expect(result.ok).toBe(false)
  })
})

describe("publishSnapshot", () => {
  const writes: Array<{ path: string; body: string }> = []
  const renames: Array<{ from: string; to: string }> = []

  const io = {
    writeFile: jest.fn(async (path: string, body: string) => {
      writes.push({ path, body })
    }),
    rename: jest.fn(async (from: string, to: string) => {
      renames.push({ from, to })
    }),
    unlink: jest.fn(async () => {}),
  }

  beforeEach(() => {
    writes.length = 0
    renames.length = 0
    jest.clearAllMocks()
  })

  it("writes a temp file and renames it into place, never writing the target directly", async () => {
    const built = await buildSnapshot({ fetchSource: bothStages(), now: NOW, synthetic: true })
    if (!built.ok) throw new Error("fixture build failed")

    await publishSnapshot("data/deadlines/cook-county.json", built.snapshot, io)

    expect(io.writeFile).toHaveBeenCalledTimes(1)
    expect(writes[0].path).not.toBe("data/deadlines/cook-county.json")
    expect(writes[0].path).toMatch(/\.tmp$/)

    expect(renames).toEqual([
      { from: writes[0].path, to: "data/deadlines/cook-county.json" },
    ])

    // A half-written JSON file is a snapshot that parses as garbage on the next
    // deploy; the rename is what makes the swap atomic.
    expect(JSON.parse(writes[0].body)).toMatchObject({ schemaVersion: 1, synthetic: true })
    expect(writes[0].body.endsWith("\n")).toBe(true)
  })

  it("removes the temp file and rethrows if the rename fails, leaving the target alone", async () => {
    const built = await buildSnapshot({ fetchSource: bothStages(), now: NOW, synthetic: true })
    if (!built.ok) throw new Error("fixture build failed")

    io.rename.mockRejectedValueOnce(new Error("EXDEV"))

    await expect(
      publishSnapshot("data/deadlines/cook-county.json", built.snapshot, io),
    ).rejects.toThrow("EXDEV")

    expect(io.unlink).toHaveBeenCalledWith(writes[0].path)
  })
})

describe("the committed snapshot", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs")
  const { join } = require("node:path") as typeof import("node:path")

  it("is marked synthetic, because no county page has been fetched for it", () => {
    const raw = readFileSync(join(process.cwd(), "data/deadlines/cook-county.json"), "utf8")
    const snapshot = JSON.parse(raw)

    // This is the load-bearing assertion for the whole candidate. The dates in
    // that file are invented. Marked synthetic, they can never reach a
    // homeowner: `evaluateOfficialDeadlineState` refuses the snapshot outright.
    // If this flag is ever flipped without a real retrieval behind it, every
    // one of the 52 paths starts publishing fabricated deadlines.
    expect(snapshot.synthetic).toBe(true)
    expect(snapshot.schemaVersion).toBe(1)
  })
})

export {}
