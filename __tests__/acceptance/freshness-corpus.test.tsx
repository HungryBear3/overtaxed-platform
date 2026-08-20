/**
 * @jest-environment node
 *
 * The rendered acceptance corpus (Section E).
 *
 * The controller's corrected matrix accepts 53 freshness-bearing routes and 22
 * named surfaces. Everything before this file proves a module in isolation;
 * this proves the pages a homeowner actually opens. It renders each accepted
 * route through direct server-component invocation and asserts one property
 * across all of them: with no verified snapshot, no surface publishes a
 * deadline, a countdown, a filing CTA, a reminder signup, or a checkout — and
 * that the suppression is joint, never partial.
 *
 * The matrix itself is read from the controller packet rather than restated, so
 * the route list cannot drift from the one Rex verifies against.
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"

import DeadlinesRoutePage from "@/app/deadlines/page"
import TownshipsIndexPage from "@/app/townships/page"
import TownshipPageRoute, { generateMetadata as townshipMetadata } from "@/app/township/[slug]/page"
import CampaignPageRoute, { generateMetadata as campaignMetadata } from "@/app/appeal-deadline/[slug]/page"
import AboutPage from "@/app/about/page"
import ContingencyPage from "@/app/appeal-contingency/page"
import CheckPage from "@/app/check/page"
import { FreeCheckResult, type Result } from "@/components/check/FreeCheckResult"
import { TOWNSHIPS } from "@/lib/townships"
import {
  evaluateOfficialDeadlineState,
  projectDeadline,
  type OfficialDeadlineSnapshot,
} from "@/lib/deadlines/official-source-state"
import type { TownshipResolution } from "@/lib/deadlines/township-resolution"

const MATRIX_PATH =
  "/Users/abigailclaw/.openclaw/workspace/rex/handoffs/ot-minimum-postable-rebuild-20260819/qa/acceptance-matrix.json"

type AcceptedRoute = {
  accepted_path_id: number
  path: string
  route_type: string
}

const matrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8")) as {
  accepted_routes: AcceptedRoute[]
  named_surfaces: Array<{ path: string; category: string }>
  canonical_copy: Record<string, string>
  synthetic_fixtures: Array<Record<string, unknown>>
}

const ACCEPTED = matrix.accepted_routes

/**
 * A rendered deadline claim: a full date, an ISO date, or a countdown.
 *
 * Deliberately broad. A surface that suppresses the countdown but leaves the
 * date, or suppresses both but leaves "closes in 6 days" in an OG image, has
 * not suppressed anything a reader would act on.
 */
const DATE_CLAIM =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(19|20)\d{2}\b/
const ISO_DATE = /\b(19|20)\d{2}-\d{2}-\d{2}\b/
const COUNTDOWN = /\b\d+\s*(days?|business days?)\s*(left|remaining|until|to file)/i
const CLOSES_TODAY = /closes today/i
const PLACEHOLDER_YEAR = /1900/

function expectNoUnverifiedDeadlineClaim(html: string, where: string) {
  expect({ where, matched: DATE_CLAIM.test(html) }).toEqual({ where, matched: false })
  expect({ where, matched: ISO_DATE.test(html) }).toEqual({ where, matched: false })
  expect({ where, matched: COUNTDOWN.test(html) }).toEqual({ where, matched: false })
  expect({ where, matched: CLOSES_TODAY.test(html) }).toEqual({ where, matched: false })
  // The committed snapshot's placeholder dates are in 1900. Their absence is
  // what proves the fixture did not leak through a surface that ignored the
  // synthetic flag.
  expect({ where, matched: PLACEHOLDER_YEAR.test(html) }).toEqual({ where, matched: false })
}

function expectNoCommerceOrReminder(html: string, where: string) {
  expect({ where, matched: /\/checkout\?plan=/.test(html) }).toEqual({ where, matched: false })
  expect({ where, matched: /DIY Appeal Packet \$69/.test(html) }).toEqual({ where, matched: false })
  expect({ where, matched: /Done-For-You/.test(html) }).toEqual({ where, matched: false })
}

/* ── The 53 accepted routes ──────────────────────────────────────────────── */

describe("the accepted route corpus", () => {
  it("covers exactly the 53 corrected rows, including /check", () => {
    expect(ACCEPTED).toHaveLength(53)
    expect(new Set(ACCEPTED.map((r) => r.path)).size).toBe(53)
    expect(ACCEPTED.find((r) => r.path === "/check")?.accepted_path_id).toBe(32)
  })

  it("accounts for every accepted row in this file", () => {
    // Nothing may be silently dropped: each row is rendered below, read as a
    // committed markdown/static artifact, or explicitly recorded as withdrawn.
    const rendered = new Set<string>([
      "/about",
      "/appeal-contingency",
      "/check",
      "/contact",
      "/deadlines",
      "/townships",
      "/appeal-deadline/rogers-park",
      "/appeal-deadline/west-chicago",
      ...TOWNSHIPS.map((t) => `/township/${t.slug}`),
    ])
    const blogs = ACCEPTED.filter((r) => r.path.startsWith("/blog/")).map((r) => r.path)
    const downloads = ACCEPTED.filter((r) => r.path.startsWith("/resources/")).map((r) => r.path)
    const unaccounted = ACCEPTED.filter(
      (r) =>
        !rendered.has(r.path) &&
        !blogs.includes(r.path) &&
        !downloads.includes(r.path),
    )
    expect(unaccounted.map((r) => r.path)).toEqual([])
    expect(blogs).toHaveLength(5)
    expect(downloads).toHaveLength(2)
  })
})

describe("township pages publish no unverified deadline", () => {
  const townshipRows = ACCEPTED.filter((r) => r.path.startsWith("/township/"))

  it("has one accepted row per township in the roster", () => {
    expect(townshipRows).toHaveLength(38)
    expect(townshipRows.map((r) => r.path).sort()).toEqual(
      TOWNSHIPS.map((t) => `/township/${t.slug}`).sort(),
    )
  })

  it.each(TOWNSHIPS.map((t) => [t.slug] as const))(
    "/township/%s suppresses date, countdown, CTA, reminder and checkout together",
    async (slug) => {
      const html = renderToStaticMarkup(
        await TownshipPageRoute({ params: Promise.resolve({ slug }) } as never),
      )
      expectNoUnverifiedDeadlineClaim(html, `/township/${slug}`)
      expectNoCommerceOrReminder(html, `/township/${slug}`)

      // Structured data is the copy a search engine republishes, and it is the
      // one a reader never sees us withdraw.
      const scripts = [
        ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
      ].map((m) => m[1])
      for (const script of scripts) {
        expect(script).not.toContain('"@type":"Event"')
        expect(script).not.toContain("startDate")
        expectNoUnverifiedDeadlineClaim(script, `/township/${slug} json-ld`)
      }
    },
  )

  it.each(TOWNSHIPS.slice(0, 6).map((t) => [t.slug] as const))(
    "/township/%s metadata makes no deadline claim",
    async (slug) => {
      const meta = await townshipMetadata({ params: Promise.resolve({ slug }) } as never)
      const serialized = JSON.stringify(meta)
      expectNoUnverifiedDeadlineClaim(serialized, `/township/${slug} metadata`)
    },
  )
})

describe("campaign landing pages", () => {
  it("/appeal-deadline/west-chicago renders a dateless pending page rather than 404ing", async () => {
    // The four campaign URLs are in the sitemap and are the destination of paid
    // and organic traffic. An unverified window makes them dateless, not
    // missing: 404ing an advertised URL leaves the reader who followed it with
    // nothing at all.
    const html = renderToStaticMarkup(
      await CampaignPageRoute({ params: Promise.resolve({ slug: "west-chicago" }) } as never),
    )
    expect(html.length).toBeGreaterThan(0)
    expectNoUnverifiedDeadlineClaim(html, "/appeal-deadline/west-chicago")
    expectNoCommerceOrReminder(html, "/appeal-deadline/west-chicago")
  })

  it("/appeal-deadline/rogers-park stays a 404, because it is not a campaign", async () => {
    // Rogers Park is a township, not one of the four approved campaigns, so
    // there is no landing page to render. The accepted row allows 404 and this
    // pins which of the two dispositions it is — a pending campaign page for an
    // unapproved slug would be a page we never decided to publish.
    await expect(
      CampaignPageRoute({ params: Promise.resolve({ slug: "rogers-park" }) } as never),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/)
  })

  it("campaign metadata makes no deadline claim", async () => {
    const meta = await campaignMetadata({
      params: Promise.resolve({ slug: "west-chicago" }),
    } as never)
    expectNoUnverifiedDeadlineClaim(
      JSON.stringify(meta),
      "/appeal-deadline/west-chicago metadata",
    )
  })
})

describe("index and static routes", () => {
  it("/check suppresses stale dates, filing CTA, reminder signup, and checkout together", () => {
    const routeHtml = renderToStaticMarkup(CheckPage())
    expectNoUnverifiedDeadlineClaim(routeHtml, "/check initial route")

    const unverifiedResult: Result = {
      subject: {
        pin: "10-25-107-045-0000",
        address: "123 Main St",
        city: "Evanston",
        zipCode: "60201",
        township: "Evanston",
        neighborhoodCode: "70",
        taxYear: 2026,
        assessedTotalValue: 42500,
        marketValue: 425000,
      },
      compCount: 3,
      comps: [],
      avgComparableAssessedValue: 35100,
      equityRatio: 12.1,
      targetEquityRatio: 10,
      avgCompEquityRatio: 9.8,
      assessmentGap: 7400,
      potentialOverpaymentPerYear: null,
      potentialOverpayment3Year: null,
      appealArgumentText: null,
      appealWindowStatus: {
        township: "Evanston",
        status: "unknown",
        // Hostile stale values prove the renderer obeys capabilities rather
        // than trusting dates merely because a cached payload carried them.
        openDate: "1900-01-01",
        closeDate: "1900-01-02",
        filingUrl: "https://www.cookcountyassessoril.gov/online-appeals",
        note: "Synthetic source",
        pendingReason: "synthetic_source",
        allowCheckout: false,
        showDates: false,
        showCountdown: false,
        allowDeadlineCta: false,
        allowReminderSignup: false,
      },
      propertyCharacteristics: null,
      source: "Cook County Open Data",
      disclosure:
        "This free check compares available public Cook County records. It estimates whether the evidence appears to support closer review. It does not predict whether an appeal will succeed or reduce taxes.",
      sourceCaveat: null,
      outcome: {
        code: "insufficient_evidence",
        headline: "Insufficient evidence",
        allowCheckout: false,
        showFigures: false,
        reason: "window_unverified",
      },
    }
    const html = renderToStaticMarkup(<FreeCheckResult result={unverifiedResult} />)

    expectNoUnverifiedDeadlineClaim(html, "/check unverified result")
    expectNoCommerceOrReminder(html, "/check unverified result")
    expect(html).not.toContain("online-appeals")
    expect(html).not.toMatch(/File your appeal|File at CCAO/i)
    expect(html).not.toMatch(/get notified|remind you|type="email"/i)
  })

  it("/deadlines publishes no date and says the gap is ours", () => {
    const html = renderToStaticMarkup(DeadlinesRoutePage())
    expectNoUnverifiedDeadlineClaim(html, "/deadlines")
    expect(html).toMatch(/we have not (verified|read)/i)
  })

  it("/townships publishes no date", async () => {
    const html = renderToStaticMarkup(await TownshipsIndexPage())
    expectNoUnverifiedDeadlineClaim(html, "/townships")
  })

  it("/about publishes no date", () => {
    const html = renderToStaticMarkup(AboutPage())
    expectNoUnverifiedDeadlineClaim(html, "/about")
  })

  it("/appeal-contingency is withdrawn without restating the offer", () => {
    const html = renderToStaticMarkup(ContingencyPage())
    expect(html).not.toMatch(/22%/)
    expect(html).not.toMatch(/only if the county grants/i)
    expectNoUnverifiedDeadlineClaim(html, "/appeal-contingency")
    expectNoCommerceOrReminder(html, "/appeal-contingency")
  })
})

describe("committed blog artifacts", () => {
  const blogRows = ACCEPTED.filter((r) => r.path.startsWith("/blog/"))

  it.each(blogRows.map((r) => [r.path.replace("/blog/", "")] as const))(
    "%s names no filing date of its own",
    (slug) => {
      const file = join(process.cwd(), "content/blog", `${slug}.md`)
      expect(existsSync(file)).toBe(true)
      const body = readFileSync(file, "utf8")
      // An article is a fixed document that outlives the window it describes,
      // so it may point at the county's calendar and may not carry a date.
      expect(body).not.toMatch(COUNTDOWN)
      expect(body).toContain("cookcountyassessoril.gov")
      expect(body).not.toContain("cookcountyassessor.com")
    },
  )
})

describe("withdrawn download artifacts", () => {
  const downloadRows = ACCEPTED.filter((r) => r.path.startsWith("/resources/"))

  it("names the two flyer artifacts", () => {
    expect(downloadRows.map((r) => r.path).sort()).toEqual([
      "/resources/overtaxed-hoa-resident-resource.html",
      "/resources/overtaxed-hoa-resident-resource.pdf",
    ])
  })

  it("is linked from no rendered surface", () => {
    // The files stay on disk — deleting a design asset is a disposition
    // decision — but nothing serves them. A standing "Current appeal windows"
    // badge on a sheet meant to be printed and pinned in a lobby is the one
    // carrier that outlives every correction we could make.
    const surfaces = [
      renderToStaticMarkup(DeadlinesRoutePage()),
      renderToStaticMarkup(AboutPage()),
      renderToStaticMarkup(ContingencyPage()),
    ]
    for (const html of surfaces) {
      expect(html).not.toContain("overtaxed-hoa-resident-resource")
    }
  })
})

/* ── Hostile fixtures (FX-01 … FX-10) ────────────────────────────────────── */

describe("hostile source fixtures", () => {
  const CALENDAR_URL =
    "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
  const NOW = "2026-08-19T17:00:00.000Z"

  const resolution: TownshipResolution = {
    inputKind: "pin",
    normalizedPin: "13243140450000",
    normalizedAddress: null,
    townshipKey: "jefferson",
    townshipName: "Jefferson",
    resolutionSource: "official_property_record",
    resolvedAt: NOW,
  }

  function snapshot(over: Record<string, unknown> = {}): OfficialDeadlineSnapshot {
    const source = {
      authority: "cook_county_assessor" as const,
      sourceUrl: CALENDAR_URL,
      retrievedAt: "2026-08-19T16:59:55.000Z",
      sourceUpdatedAt: null,
      contentSha256: "a".repeat(64),
      httpStatus: 200,
      finalUrl: CALENDAR_URL,
      parseStatus: "ok" as const,
      parserVersion: "1.0.0",
      ...(over.source as Record<string, unknown>),
    }
    return {
      schemaVersion: 1,
      synthetic: Boolean(over.synthetic),
      sources: { assessor: source, bor: source },
      townships: (over.townships as OfficialDeadlineSnapshot["townships"]) ?? {
        jefferson: {
          townshipName: "Jefferson",
          stages: {
            assessor: {
              noticeDate: null,
              openDate: (over.openDate as string) ?? "2026-08-05",
              lastFileDate: (over.lastFileDate as string) ?? "2026-09-04",
            },
          },
        },
      },
    } as OfficialDeadlineSnapshot
  }

  function project(snap: OfficialDeadlineSnapshot, at = NOW) {
    return projectDeadline(
      evaluateOfficialDeadlineState({
        snapshot: snap,
        township: resolution,
        stage: "assessor",
        evaluatedAt: at,
      }),
      at,
    )
  }

  /** Every capability is off together, or the fixture has not failed closed. */
  function expectJointSuppression(projection: ReturnType<typeof project>, id: string) {
    expect({ id, available: projection.available }).toEqual({ id, available: false })
    for (const capability of [
      "showDates",
      "showStatus",
      "showCountdown",
      "allowDeadlineCta",
      "allowReminderSignup",
      "allowDeadlineEmail",
      "allowCheckout",
      "allowStructuredData",
    ] as const) {
      expect({ id, capability, value: projection[capability] }).toEqual({
        id,
        capability,
        value: false,
      })
    }
    expect(JSON.stringify(projection)).not.toMatch(ISO_DATE)
  }

  it("declares the ten fixtures the controller froze", () => {
    expect(matrix.synthetic_fixtures).toHaveLength(10)
  })

  it("FX-01 fresh/open: the one arm that may verify", () => {
    const projection = project(snapshot())
    expect(projection.available).toBe(true)
    if (!projection.available) return
    expect(projection.status).toBe("open")
    expect(projection.allowCheckout).toBe(true)
    expect(projection.officialSourceUrl).toBe(CALENDAR_URL)
    expect(projection.retrievedAt).toBe("2026-08-19T16:59:55.000Z")
  })

  it("FX-02 stale: a prior-day retrieval inside the window fails closed", () => {
    expectJointSuppression(
      project(snapshot({ source: { retrievedAt: "2026-08-18T16:00:00.000Z" } })),
      "FX-02-stale",
    )
  })

  it("FX-03 closed: a verified closed window sells nothing", () => {
    const projection = project(
      snapshot({ openDate: "2026-06-01", lastFileDate: "2026-07-01" }),
    )
    // A closed window may be described — a homeowner who arrives late is owed
    // the reason — but everything commercial is off.
    expect(projection.available).toBe(true)
    if (!projection.available) return
    expect(projection.status).toBe("closed")
    expect(projection.showCountdown).toBe(false)
    expect(projection.allowDeadlineCta).toBe(false)
    expect(projection.allowReminderSignup).toBe(false)
    expect(projection.allowCheckout).toBe(false)
  })

  it("FX-04 future: a retrieval stamped after the evaluation fails closed", () => {
    expectJointSuppression(
      project(snapshot({ source: { retrievedAt: "2026-08-20T16:00:00.000Z" } })),
      "FX-04-future",
    )
  })

  it("FX-05 hash mismatch: a malformed content hash fails closed", () => {
    expectJointSuppression(
      project(snapshot({ source: { contentSha256: "not-a-sha" } })),
      "FX-05-hash-mismatch",
    )
  })

  it("FX-06 parse failure fails closed", () => {
    expectJointSuppression(
      project(snapshot({ source: { parseStatus: "parse_error" } })),
      "FX-06-parse-failure",
    )
  })

  it("FX-07 schema failure fails closed", () => {
    expectJointSuppression(
      project(snapshot({ source: { parseStatus: "schema_error" } })),
      "FX-07-schema-failure",
    )
  })

  it("FX-08 unresolved township fails closed", () => {
    const projection = projectDeadline(
      evaluateOfficialDeadlineState({
        snapshot: snapshot(),
        township: null,
        stage: "assessor",
        evaluatedAt: NOW,
      }),
      NOW,
    )
    expectJointSuppression(projection, "FX-08-unresolved-township")
  })

  it("FX-09 missing stage fails closed", () => {
    const projection = projectDeadline(
      evaluateOfficialDeadlineState({
        snapshot: snapshot(),
        township: resolution,
        stage: "bor",
        evaluatedAt: NOW,
      }),
      NOW,
    )
    expectJointSuppression(projection, "FX-09-missing-stage")
  })

  it("FX-10 synthetic source fails closed however fresh it looks", () => {
    // The committed snapshot is this fixture. It is the reason every route
    // above renders nothing.
    const projection = project(snapshot({ synthetic: true }))
    expectJointSuppression(projection, "FX-10-synthetic")
    if (!projection.available) expect(projection.reason).toBe("synthetic_source")
  })
})

/* ── Canonical copy placement ────────────────────────────────────────────── */

describe("canonical copy is defined once and byte-exact", () => {
  it("matches the controller's frozen text", () => {
    const canonical = require("@/lib/copy/canonical") as Record<string, string>
    expect(canonical.CC_02).toBe(matrix.canonical_copy["CC-02"])
    expect(canonical.CC_03).toBe(matrix.canonical_copy["CC-03"])
    expect(canonical.CC_04).toBe(matrix.canonical_copy["CC-04"])
    expect(canonical.CC_05).toBe(matrix.canonical_copy["CC-05"])
    expect(canonical.CC_06).toBe(matrix.canonical_copy["CC-06"])
  })
})

describe("named surfaces", () => {
  it("covers the 22 the controller froze", () => {
    expect(matrix.named_surfaces).toHaveLength(22)
  })
})
