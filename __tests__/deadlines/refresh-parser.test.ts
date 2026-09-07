/** @jest-environment node */

/**
 * The snapshot builder.
 *
 * This is the only thing on the branch permitted to turn a county publication
 * into a date. Everything downstream — the state, the projection, all 52
 * consumer paths — trusts whatever comes out of here, so the interesting tests
 * are the ones where it refuses.
 *
 * Two properties matter most:
 *
 *   1. **No partial publication.** A snapshot is published whole or not at all.
 *      A build where the Assessor page parsed and the Board's PDF 404'd must
 *      write nothing, because the alternative is a file that looks current and
 *      is silently half a cycle old on one stage.
 *   2. **No network by accident.** Fetching is injected. The tests below never
 *      touch the county, and `main()` refuses to run without an explicit
 *      opt-in flag, because a refresh script that reaches out on import is one
 *      `import` away from being an unauthorised provider call.
 *
 * Two kinds of fixture drive the parsers:
 *
 *   - **Real captures** of the official sources (saved 2026-08-27; source URLs
 *     and SHA-256 digests below and in `__tests__/fixtures/deadlines/SOURCES.md`).
 *     These pin the parsers to what the county actually publishes.
 *   - **Synthetic mutations** of those shapes, for every refusal path.
 */

import { readFileSync } from "node:fs"
import { deflateSync } from "node:zlib"
import { join } from "node:path"

import {
  parseAssessorCalendar,
  parseBorOpenClosePdf,
  parsePrintedDate,
  sha256Hex,
  buildSnapshot,
  publishSnapshot,
  SOURCES,
  type FetchedSource,
  type SourceFetcher,
} from "@/scripts/refresh-township-deadlines"

const NOW = "2026-08-27T13:00:00.000Z"

const FIXTURES = join(process.cwd(), "__tests__/fixtures/deadlines")

/** Pinned digests of the saved official captures. See SOURCES.md alongside. */
const ASSESSOR_FIXTURE_SHA256 =
  "bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca"
const BOR_FIXTURE_SHA256 =
  "04eaa4db1b0be4bc00dd3ec5834cd67bc16ab0cba4bb0380e676461a16b7925b"

const assessorBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(join(FIXTURES, "assessor-calendar-20260827.html")))
const borBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(join(FIXTURES, "bor-township-open-close-20260827.pdf")))

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/* -------------------------------------------------------------------------- */
/* Synthetic assessor cards                                                   */
/* -------------------------------------------------------------------------- */

type Card = {
  name: string
  state?: "On" | "Off"
  banner?: string | null
  notice?: { datetime: string; printed: string } | null
  lastFile?: { datetime: string; printed: string } | null
}

function dateField(fieldName: string, value: Card["notice"]): string {
  if (!value) {
    return `<div class="col-md-2 col-sm-12"><span class="row label-a">${fieldName}</span><span class="row"></span></div>`
  }
  return `<div class="col-md-2 col-sm-12"><span class="row label-a">${fieldName}</span><span class="row">
    <div class="field field--name-field-${fieldName} field--type-datetime field--label-hidden field--item"><time datetime="${value.datetime}">${value.printed}</time>
</div></span></div>`
}

function assessorCard(card: Card): string {
  const state = card.state ?? (card.banner ? "On" : "Off")
  const bannerDiv =
    card.banner != null
      ? `<div class="col-md-6 col-sm-6 open-appeal">${card.banner}</div>`
      : `<div class="col-md-6 col-sm-6 appeal-options"></div>`
  return `<div class="views-row">
  <div class="row ${state} title">
      <div class="col-md-2 col-sm-12 views-field-title"><a href="">${card.name}</a></div>
    ${bannerDiv}
    <div class="col-md-2 col-sm-12"><a class="accordion-toggle" href="javascript:void(0);">View Details</a></div>
    </div>
  <div class="row copy">
    ${dateField("reassessment-notice-date", card.notice ?? null)}
    ${dateField("last-file-date", card.lastFile ?? null)}
  </div>
</div>`
}

function assessorPage(...cards: Card[]): string {
  return `<html><body><div class="calendar-view">${cards.map(assessorCard).join("\n")}</div></body></html>`
}

const openCard: Card = {
  name: "Lyons",
  banner: "Open For Appeals Until 9/3/2026",
  notice: { datetime: "2026-07-23T12:00:00Z", printed: "7/23/2026" },
  lastFile: { datetime: "2026-09-03T12:00:00Z", printed: "9/3/2026" },
}

/* -------------------------------------------------------------------------- */
/* Synthetic Board PDFs                                                       */
/* -------------------------------------------------------------------------- */

/** One positioned text chunk in the rotated layout the Board publishes. */
const tj = (line: number, along: number, arr: string): string =>
  `0 7.5581 -7.56 0 ${line} ${along} Tm\n${arr} TJ\n`

const BOR_TITLE = tj(132.96, 257.4, "[(COOK COUNTY BOARD OF REVIEW DATES AND DEADLINES 2026 SESSION)]")
const BOR_HEADER =
  tj(148.08, 189.84, "[(OPEN FOR)-3000(CLOSED FOR)-3000(FILING COMPLAINT)]") +
  tj(157.2, 33.24, "[(GROUP)-6414.1(TOWNSHIP)]")

/** A group block: townships stacked on their own lines, one dates line. */
function borGroup(input: {
  baseLine: number
  id?: string
  townships: string[]
  dates: string[]
}): string {
  const { baseLine, id = "1", townships, dates } = input
  let out = ""
  townships.forEach((name, index) => {
    out += tj(baseLine + index * 9.12, 110, `[(${name})]`)
  })
  const middle = baseLine + Math.floor(townships.length / 2) * 9.12
  if (id) out += tj(middle, 45, `[(${id})]`)
  if (dates.length > 0) {
    out += tj(middle, 190, `[${dates.map((d) => `(${d})`).join("-5842.6")}]`)
  }
  return out
}

const BOR_EXEMPTIONS =
  tj(187.56, 25.68, "[(Exemptions)]") +
  tj(196.68, 18, "[(\\(1st Installment\\))]") +
  tj(192.12, 105.24, "[(All townships)-5350.4(8/3/2026)-5842.6(9/1/2026)]")

/** Wrap content-stream text into a minimal, valid, deflated one-page PDF. */
function borPdf(body: string, over: { compress?: boolean } = {}): Uint8Array {
  const content = `BT\n${body}ET\n`
  const compress = over.compress ?? true
  const streamBytes = compress ? deflateSync(Buffer.from(content, "latin1")) : Buffer.from(content, "latin1")
  const objects = [
    `1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n`,
    `2 0 obj\n<</Type/Pages/Count 1/Kids[3 0 R]>>\nendobj\n`,
    `3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Rotate 90/Contents 4 0 R>>\nendobj\n`,
    `4 0 obj\n<</Length ${streamBytes.length}${compress ? "/Filter/FlateDecode" : ""}>>\nstream\n`,
  ]
  const head = Buffer.from(`%PDF-1.6\n${objects.join("")}`, "latin1")
  const tail = Buffer.from(`\nendstream\nendobj\n%%EOF\n`, "latin1")
  return new Uint8Array(Buffer.concat([head, streamBytes, tail]))
}

const standardBorPdf = (): Uint8Array =>
  borPdf(
    BOR_TITLE +
      BOR_HEADER +
      BOR_EXEMPTIONS +
      borGroup({
        baseLine: 219.72,
        townships: ["Evanston", "New Trier", "Oak Park"],
        dates: ["8/3/2026", "9/1/2026", "9/11/2026"],
      }),
  )

/* -------------------------------------------------------------------------- */
/* Fetch plumbing                                                             */
/* -------------------------------------------------------------------------- */

const fetched = (body: Uint8Array, over: Partial<FetchedSource> = {}): FetchedSource => ({
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
    [assessorUrl]: fetched(assessorBytes(), { finalUrl: assessorUrl }),
    [borUrl]: fetched(borBytes(), { finalUrl: borUrl }),
    ...over,
  })

/* -------------------------------------------------------------------------- */

describe("sha256Hex", () => {
  it("hashes exact bytes, and strings as their UTF-8 bytes", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
    expect(sha256Hex(new Uint8Array())).toBe(sha256Hex(""))
    expect(sha256Hex(utf8("abc"))).toBe(sha256Hex("abc"))
  })

  it("matches the pinned digests of the saved official captures", () => {
    // These are the digests recorded when the sources were captured; if the
    // fixture files are ever touched, this fails before any parser test lies.
    expect(sha256Hex(assessorBytes())).toBe(ASSESSOR_FIXTURE_SHA256)
    expect(sha256Hex(borBytes())).toBe(BOR_FIXTURE_SHA256)
  })
})

describe("parsePrintedDate", () => {
  it("rejects a date with no year rather than inferring one", () => {
    expect(parsePrintedDate("June 15")).toBeNull()
    expect(parsePrintedDate("6/15")).toBeNull()
    expect(parsePrintedDate("6/15/2026")).toBe("2026-06-15")
    expect(parsePrintedDate("June 15, 2026")).toBe("2026-06-15")
  })

  it("rejects an impossible date rather than rolling it forward", () => {
    expect(parsePrintedDate("2/31/2026")).toBeNull()
  })
})

describe("parseAssessorCalendar on the real capture", () => {
  const html = new TextDecoder("utf-8", { fatal: true }).decode(assessorBytes())

  it("reads every township card on the page", () => {
    const result = parseAssessorCalendar(html)

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return

    // 38 townships across the two 2026 calendar sets; the page's announcement
    // banner also renders as a `views-row` and must not become a township.
    expect(result.rows).toHaveLength(38)

    const byKey = Object.fromEntries(result.rows.map((r) => [r.townshipKey, r]))

    // Currently open: banner, notice date, last file date.
    expect(byKey["lyons"].window).toEqual({
      noticeDate: "2026-07-23",
      openDate: "2026-07-23",
      lastFileDate: "2026-09-03",
    })
    expect(byKey["hyde-park"].window).toEqual({
      noticeDate: "2026-08-26",
      openDate: "2026-08-26",
      lastFileDate: "2026-10-08",
    })

    // Already closed this cycle: dates remain, banner gone.
    expect(byKey["rogers-park"].window).toEqual({
      noticeDate: "2026-04-17",
      openDate: "2026-04-17",
      lastFileDate: "2026-06-01",
    })

    // Listed with no published window yet: a real observation, not a date.
    expect(byKey["worth"].window).toBeNull()
    expect(byKey["jefferson"].window).toBeNull()

    expect(result.rows.filter((r) => r.window === null)).toHaveLength(16)
  })
})

describe("parseAssessorCalendar refusals", () => {
  it("reports parse_error on markup with no township cards in it", () => {
    for (const body of ["", "<html><body><p>Down for maintenance</p></body></html>"]) {
      expect(parseAssessorCalendar(body).status).toBe("parse_error")
    }
  })

  it("reports parse_error on a PDF body", () => {
    expect(parseAssessorCalendar("%PDF-1.6 not html").status).toBe("parse_error")
  })

  it("reports schema_error on a partial card rather than skipping it", () => {
    // Skipping the bad card is the tempting behaviour and the wrong one: the
    // township silently vanishes from the snapshot, and a vanished township
    // renders as "no date available" forever without anyone being told why.
    const result = parseAssessorCalendar(
      assessorPage(openCard, {
        name: "Oak Park",
        banner: null,
        notice: { datetime: "2026-05-06T12:00:00Z", printed: "5/6/2026" },
        lastFile: null,
      }),
    )

    expect(result.status).toBe("schema_error")
    expect(result.status === "schema_error" && result.detail).toMatch(/Oak Park/)
  })

  it("reports schema_error when the printed date disagrees with the datetime attribute", () => {
    const result = parseAssessorCalendar(
      assessorPage({
        ...openCard,
        notice: { datetime: "2026-07-24T12:00:00Z", printed: "7/23/2026" },
      }),
    )

    expect(result.status).toBe("schema_error")
    expect(result.status === "schema_error" && result.detail).toMatch(/disagrees/)
  })

  it("reports schema_error when the open-appeals banner disagrees with the last file date", () => {
    const result = parseAssessorCalendar(
      assessorPage({ ...openCard, banner: "Open For Appeals Until 9/4/2026" }),
    )

    expect(result.status).toBe("schema_error")
    expect(result.status === "schema_error" && result.detail).toMatch(/banner/)
  })

  it("reports schema_error on a banner without dates behind it", () => {
    const result = parseAssessorCalendar(
      assessorPage({ name: "Worth", banner: "Open For Appeals Until 9/3/2026" }),
    )

    expect(result.status).toBe("schema_error")
  })

  it("reports schema_error on an unreadable date rather than guessing the year", () => {
    const result = parseAssessorCalendar(
      assessorPage({
        ...openCard,
        lastFile: { datetime: "2026-09-03T12:00:00Z", printed: "September 3" },
      }),
    )

    expect(result.status).toBe("schema_error")
  })

  it("reports schema_error when a window closes before it opens", () => {
    const result = parseAssessorCalendar(
      assessorPage({
        name: "Lyons",
        banner: "Open For Appeals Until 7/1/2026",
        notice: { datetime: "2026-07-23T12:00:00Z", printed: "7/23/2026" },
        lastFile: { datetime: "2026-07-01T12:00:00Z", printed: "7/1/2026" },
      }),
    )

    expect(result.status).toBe("schema_error")
  })

  it("reports schema_error on a duplicated township rather than picking one", () => {
    const result = parseAssessorCalendar(assessorPage(openCard, openCard))

    expect(result.status).toBe("schema_error")
    expect(result.status === "schema_error" && result.detail).toMatch(/lyons/)
  })
})

describe("parseBorOpenClosePdf on the real capture", () => {
  it("reads the group table into per-township windows", () => {
    const result = parseBorOpenClosePdf(borBytes())

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return

    // The Board publishes groups as the session progresses; the 2026-08-27
    // capture lists Group 1 only, plus the exemptions session (which is not a
    // township appeal window and must not become one).
    expect(result.rows.map((r) => r.townshipKey).sort()).toEqual([
      "evanston",
      "new-trier",
      "norwood-park",
      "oak-park",
      "river-forest",
      "riverside",
      "rogers-park",
    ])

    for (const row of result.rows) {
      expect(row.window).toEqual({
        noticeDate: null,
        openDate: "2026-08-03",
        lastFileDate: "2026-09-01",
      })
    }

    expect(result.rows.map((r) => r.townshipKey)).not.toContain("all-townships")
  })

  it("reads the synthetic standard document the refusal tests mutate", () => {
    // Guards the test rig itself: every refusal below is a one-change mutation
    // of a document this parser accepts.
    const result = parseBorOpenClosePdf(standardBorPdf())

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.rows.map((r) => r.townshipKey)).toEqual(["evanston", "new-trier", "oak-park"])
    expect(result.rows[0].window).toEqual({
      noticeDate: null,
      openDate: "2026-08-03",
      lastFileDate: "2026-09-01",
    })
  })
})

describe("parseBorOpenClosePdf refusals", () => {
  it("reports parse_error on bytes that are not a PDF", () => {
    expect(parseBorOpenClosePdf(utf8("<html>calendar</html>")).status).toBe("parse_error")
  })

  it("reports parse_error on a truncated or corrupted PDF", () => {
    expect(parseBorOpenClosePdf(borBytes().slice(0, 2000)).status).toBe("parse_error")

    // Zero eight bytes inside the page's compressed content stream (object 14
    // in the pinned capture) so inflation fails.
    const corrupted = borBytes()
    const raw = Buffer.from(corrupted).toString("latin1")
    const streamAt = raw.indexOf("stream", raw.indexOf("14 0 obj"))
    expect(streamAt).toBeGreaterThan(0)
    corrupted.set([0, 0, 0, 0, 0, 0, 0, 0], streamAt + 16)
    expect(parseBorOpenClosePdf(corrupted).status).toBe("parse_error")
  })

  it("reports schema_error when the document title changes", () => {
    const pdf = borPdf(
      tj(132.96, 257.4, "[(SOME OTHER COUNTY DOCUMENT)]") +
        BOR_HEADER +
        borGroup({ baseLine: 219.72, townships: ["Evanston"], dates: ["8/3/2026", "9/1/2026"] }),
    )

    expect(parseBorOpenClosePdf(pdf).status).toBe("schema_error")
  })

  it("reports schema_error when the column headers change", () => {
    const pdf = borPdf(
      BOR_TITLE +
        tj(157.2, 33.24, "[(GROUP)-6414.1(MUNICIPALITY)]") +
        borGroup({ baseLine: 219.72, townships: ["Evanston"], dates: ["8/3/2026", "9/1/2026"] }),
    )

    const result = parseBorOpenClosePdf(pdf)
    expect(result.status).toBe("schema_error")
  })

  it("reports schema_error on a group with only one date", () => {
    const pdf = borPdf(
      BOR_TITLE +
        BOR_HEADER +
        borGroup({ baseLine: 219.72, townships: ["Evanston"], dates: ["8/3/2026"] }),
    )

    expect(parseBorOpenClosePdf(pdf).status).toBe("schema_error")
  })

  it("reports schema_error on a group with more dates than open/close/evidence", () => {
    const pdf = borPdf(
      BOR_TITLE +
        BOR_HEADER +
        borGroup({
          baseLine: 219.72,
          townships: ["Evanston"],
          dates: ["8/3/2026", "9/1/2026", "9/11/2026", "10/1/2026"],
        }),
    )

    expect(parseBorOpenClosePdf(pdf).status).toBe("schema_error")
  })

  it("reports schema_error when a group's window closes before it opens", () => {
    const pdf = borPdf(
      BOR_TITLE +
        BOR_HEADER +
        borGroup({ baseLine: 219.72, townships: ["Evanston"], dates: ["9/1/2026", "8/3/2026"] }),
    )

    expect(parseBorOpenClosePdf(pdf).status).toBe("schema_error")
  })

  it("reports schema_error on a duplicated township across groups", () => {
    const pdf = borPdf(
      BOR_TITLE +
        BOR_HEADER +
        borGroup({ baseLine: 219.72, townships: ["Evanston"], dates: ["8/3/2026", "9/1/2026"] }) +
        borGroup({
          baseLine: 260,
          id: "2",
          townships: ["Evanston"],
          dates: ["9/14/2026", "10/13/2026"],
        }),
    )

    const result = parseBorOpenClosePdf(pdf)
    expect(result.status).toBe("schema_error")
    expect(result.status === "schema_error" && result.detail).toMatch(/evanston/)
  })

  it("reports schema_error on a group block without a group id", () => {
    const pdf = borPdf(
      BOR_TITLE +
        BOR_HEADER +
        borGroup({ baseLine: 219.72, id: "", townships: ["Evanston"], dates: ["8/3/2026", "9/1/2026"] }),
    )

    expect(parseBorOpenClosePdf(pdf).status).toBe("schema_error")
  })

  it("reports schema_error when prose lands where the parser expects dates", () => {
    const pdf = borPdf(
      BOR_TITLE +
        BOR_HEADER +
        tj(219.72, 110, "[(Evanston)]") +
        tj(219.72, 45, "[(1)]") +
        tj(219.72, 190, "[(8/3/2026)-5842.6(see website)]"),
    )

    expect(parseBorOpenClosePdf(pdf).status).toBe("schema_error")
  })

  it("reports schema_error on a cell that is not a township name", () => {
    const pdf = borPdf(
      BOR_TITLE +
        BOR_HEADER +
        borGroup({
          baseLine: 219.72,
          townships: ["Evanston", "3rd Notice Mailed"],
          dates: ["8/3/2026", "9/1/2026"],
        }),
    )

    expect(parseBorOpenClosePdf(pdf).status).toBe("schema_error")
  })

  it("reports parse_error when only the exemptions session is listed", () => {
    const pdf = borPdf(BOR_TITLE + BOR_HEADER + BOR_EXEMPTIONS)

    expect(parseBorOpenClosePdf(pdf).status).toBe("parse_error")
  })

  it("reports parse_error on an unrotated text layout rather than misreading it", () => {
    const pdf = borPdf(
      "1 0 0 1 100 700 Tm\n[(COOK COUNTY BOARD OF REVIEW DATES AND DEADLINES 2026 SESSION)] TJ\n",
    )

    expect(parseBorOpenClosePdf(pdf).status).toBe("parse_error")
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

    // The provenance hash is the hash of the exact bytes that arrived — for
    // the Board, the PDF file itself, never a text decoding of it.
    expect(assessor?.contentSha256).toBe(ASSESSOR_FIXTURE_SHA256)
    expect(snapshot.sources.bor?.contentSha256).toBe(BOR_FIXTURE_SHA256)

    expect(snapshot.sources.bor).toMatchObject({
      authority: "cook_county_board_of_review",
      parseStatus: "ok",
    })

    // Stages stay separate all the way through: Rogers Park has both, Lyons
    // appears only on the Assessor's calendar and must not acquire a Board
    // window it was never listed for.
    expect(snapshot.townships["rogers-park"].stages).toEqual({
      assessor: { noticeDate: "2026-04-17", openDate: "2026-04-17", lastFileDate: "2026-06-01" },
      bor: { noticeDate: null, openDate: "2026-08-03", lastFileDate: "2026-09-01" },
    })
    expect(snapshot.townships["lyons"].stages.bor ?? null).toBeNull()

    // A township the Assessor lists with no published window is carried as an
    // explicit null, not dropped and not given a date.
    expect(snapshot.townships["worth"].stages.assessor).toBeNull()
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
      fetchSource: bothStages({ [borUrl]: fetched(utf8("Not Found"), { status: 404 }) }),
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
      fetchSource: bothStages({ [assessorUrl]: fetched(utf8("<html>maintenance</html>")) }),
      now: NOW,
      synthetic: false,
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failures[0]).toMatchObject({
      stage: "assessor",
      parseStatus: "parse_error",
    })
  })

  it("publishes nothing when the county swaps a PDF in for the HTML page", async () => {
    const result = await buildSnapshot({
      fetchSource: bothStages({ [assessorUrl]: fetched(borBytes()) }),
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
        [assessorUrl]: fetched(utf8("<html>maintenance</html>")),
        [borUrl]: fetched(utf8("Not Found"), { status: 404 }),
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
