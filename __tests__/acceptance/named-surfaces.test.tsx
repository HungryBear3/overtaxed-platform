/**
 * @jest-environment node
 *
 * The 22 named surfaces, rendered.
 *
 * The rendered corpus proved 53 freshness routes and then said this about the
 * other half of the controller's matrix:
 *
 *     expect(matrix.named_surfaces).toHaveLength(22)
 *
 * That asserts the manifest has 22 rows. It does not open one of them. The
 * consequence is on record: the `/check` savings hero — "Estimated savings
 * $X/year", an "Est. overpayment" card, a red/amber/green merits grade — was
 * live on a canonical indexable route while the corpus reported 74/74, because
 * no test rendered the surface. Section E of the contract requires these
 * surfaces and the banned-claims lexicon, and neither was covered.
 *
 * Every one of the 22 is accounted for here, in one of three ways, and which
 * one is stated per row rather than left to inference — 12, 7 and 3:
 *
 *   RENDERED  (12) — invoked and swept: no unverified date, no countdown, no
 *                    reminder capture, no held offer, no banned claim.
 *   EXERCISED  (7) — an HTTP API with no rendered output. The matrix marks
 *                    these `online_probe: false`. They are proven by named
 *                    suites that drive the real handler with provider mocks.
 *                    This file asserts three things about that claim, because
 *                    asserting the first alone is how SURF-22 came to be
 *                    "merely counted": the suite exists, the suite actually
 *                    *references* the route, and the fail-closed guard is
 *                    specific enough to be falsifiable — exactly one match, so
 *                    a common word appearing 48 times cannot stand in for one.
 *   ABSENT     (3) — the app claims no such route, which is the disposition the
 *                    matrix accepts for them. Proven by the absence of any file
 *                    that could serve the path.
 *
 * There is no fourth category, and the split is asserted rather than described.
 * A row that cannot be placed fails the accounting test at the top.
 */
/* Client hooks and auth are mocked at the module boundary so a page can be
   rendered outside a request. Nothing about the copy under test depends on
   them: a router that navigates nowhere and a session that is absent are the
   least privileged inputs these surfaces can receive. */
jest.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404")
  },
}))

const getSession = jest.fn(async () => null)
jest.mock("@/lib/auth", () => ({ __esModule: true, getSession, authOptions: {} }))
jest.mock("@/lib/auth/session", () => ({ __esModule: true, getSession }))
jest.mock("next-auth/react", () => ({
  __esModule: true,
  useSession: () => ({ data: null, status: "unauthenticated" }),
  signIn: jest.fn(),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: unknown }) => children,
}))

jest.mock("next-auth", () => ({
  __esModule: true,
  default: jest.fn(),
  AuthError: class AuthError extends Error {},
}))
jest.mock("@/app/auth/signin/actions", () => ({
  __esModule: true,
  signInWithCredentials: jest.fn(async () => ({})),
}))

const prismaMock = {
  oTOrder: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  invoice: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
  user: { findUnique: jest.fn(async () => null) },
  property: { findMany: jest.fn(async () => []) },
  appeal: { findMany: jest.fn(async () => []) },
}
jest.mock("@/lib/db", () => ({ __esModule: true, prisma: prismaMock }))

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement, type ReactElement } from "react"

const ROOT = resolve(__dirname, "../..")

const matrix = readAcceptanceMatrix() as {
  accepted_routes: Array<{ accepted_path_id: number; path: string }>
  named_surfaces: Array<{ surface_id: string; path: string; category: string; expectation: string }>
}

/* ── The lexicon ──────────────────────────────────────────────────────────── */

import {
  BANNED_LEXICON,
  expectNoBannedClaim,
  readable,
} from "../lexicon/banned-claims.test"
import { readAcceptanceMatrix } from "../helpers/governance-fixtures.test"

const DATE_CLAIM =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(19|20)\d{2}\b/
const ISO_DATE = /\b(19|20)\d{2}-\d{2}-\d{2}\b/
const COUNTDOWN = /\b\d+\s*(days?|business days?)\s*(left|remaining|until|to file)/i
const PLACEHOLDER_YEAR = /1900/

void BANNED_LEXICON

function sweep(html: string, where: string) {
  const text = readable(html)
  expectNoBannedClaim(html, where)
  expect({ where, claim: "date", matched: DATE_CLAIM.test(text) }).toEqual({ where, claim: "date", matched: false })
  expect({ where, claim: "iso", matched: ISO_DATE.test(html) }).toEqual({ where, claim: "iso", matched: false })
  expect({ where, claim: "countdown", matched: COUNTDOWN.test(text) }).toEqual({ where, claim: "countdown", matched: false })
  expect({ where, claim: "placeholder", matched: PLACEHOLDER_YEAR.test(html) }).toEqual({ where, claim: "placeholder", matched: false })
}

/**
 * Reminder capture and held commerce, as controls rather than as vocabulary.
 *
 * An earlier draft of this banned the *words* "$97" and "22% contingency". That
 * is exactly backwards on `/admin/performance`, whose entire content is the
 * sentence "The 22% contingency service and its performance-fee invoicing are
 * held" — naming a withdrawn product in a refusal is required, not forbidden.
 * What must be absent is a way to buy it, enrol in it, or be scheduled by it.
 */
function expectNoCaptureOrHeldOffer(html: string, where: string) {
  const text = readable(html)

  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
  for (const href of hrefs) {
    expect({ where, href, heldEntry: /\/checkout\?plan=/.test(href) }).toEqual({ where, href, heldEntry: false })
    expect({ where, href, heldSignup: /\/auth\/signup\?plan=(dfy|done-for-you|contingency|bor)/i.test(href) }).toEqual({
      where, href, heldSignup: false,
    })
  }

  for (const [label, pattern] of [
    ["pay-now", /\bpay now\b/i],
    ["buy-held", /\b(buy|purchase|order) (the )?(done-for-you|contingency|board of review)/i],
    ["enrol-held", /\b(join the waitlist|enroll in the contingency|start (my|your) contingency)\b/i],
    ["staff-filing", /\bwe(\'ll| will)? file (it |your )?(for you|on your behalf)\b/i],
  ] as const) {
    expect({ where, label, found: pattern.test(text) }).toEqual({ where, label, found: false })
  }

  // Reminder capture: an input whose purpose is to be told when a window opens.
  // A sign-in field or a contact form is not that, so the control is identified
  // by its intent rather than by its type.
  const reminderControl =
    /<input[^>]*(name|id|placeholder)="[^"]*(remind|notify|alert|watch)[^"]*"/i.test(html)
  const reminderCopy =
    /\b(notify|remind|alert|tell) me when [^.]{0,40}\b(opens|window|deadline)\b/i.test(text)
  expect({ where, reminderControl, reminderCopy }).toEqual({ where, reminderControl: false, reminderCopy: false })
}

/* ── Surface registry ─────────────────────────────────────────────────────── */

type Rendered = { kind: "rendered"; render: () => Promise<string> | string }
type Exercised = { kind: "exercised"; routeFile: string; suites: string[]; guard: RegExp }
type Absent = { kind: "absent"; appPath: string }

/**
 * Render a page component to markup.
 *
 * A protected page that redirects an anonymous visitor is rendering correctly —
 * that is the auth check working — so the redirect is caught and reported as
 * the surface's output. `expect` it below: a redirect target is swept like any
 * other string, so a protected page cannot smuggle a claim into one.
 */
type PageModule = { default: (props: never) => ReactElement | Promise<ReactElement> }

async function markup(mod: Promise<unknown>, props?: unknown): Promise<string> {
  const Page = ((await mod) as PageModule).default
  try {
    // A client component's hooks only work when the renderer calls it, so the
    // element is handed to `renderToStaticMarkup` rather than invoked here. An
    // async server component cannot be an element, so it is awaited first.
    const isAsync = Page.constructor.name === "AsyncFunction"
    const el = isAsync
      ? await (Page as (p?: unknown) => Promise<ReactElement>)(props)
      : createElement(Page as never, props as never)
    return renderToStaticMarkup(el)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith("REDIRECT:")) return `<!-- redirected to ${message.slice(9)} -->`
    throw err
  }
}

const SURFACES: Record<string, Rendered | Exercised | Absent> = {
  // Neither route exists in the app. The matrix accepts 404 for both, and their
  // absence is the disposition: `/free-check` has no signed ruling (OD-7) and
  // `/results` was never built.
  "SURF-01": { kind: "absent", appPath: "app/free-check" },
  "SURF-02": { kind: "absent", appPath: "app/results" },
  "SURF-03": { kind: "rendered", render: () => markup(import("@/app/pricing/page")) },
  "SURF-04": { kind: "rendered", render: () => markup(import("@/app/faq/page")) },
  "SURF-05": { kind: "rendered", render: () => markup(import("@/app/terms/page")) },
  "SURF-06": { kind: "rendered", render: () => markup(import("@/app/disclaimer/page")) },
  // The QA probe path. No route claims it, so it is a 404 by construction.
  "SURF-07": { kind: "absent", appPath: "app/404-probe-ot-qa" },
  "SURF-08": { kind: "rendered", render: () => markup(import("@/app/auth/signin/page")) },
  "SURF-09": { kind: "rendered", render: () => markup(import("@/app/checkout/page"), { searchParams: Promise.resolve({}) }) },
  "SURF-10": { kind: "rendered", render: () => markup(import("@/app/checkout/success/page"), { searchParams: Promise.resolve({}) }) },
  "SURF-11": { kind: "rendered", render: () => markup(import("@/app/appeal-packet/success/page"), { searchParams: Promise.resolve({}) }) },
  "SURF-12": { kind: "rendered", render: () => markup(import("@/app/appeal-contingency/success/page"), { searchParams: Promise.resolve({}) }) },
  "SURF-13": { kind: "rendered", render: () => markup(import("@/app/account/page")) },
  "SURF-14": { kind: "rendered", render: () => markup(import("@/app/appeals/new/page")) },
  "SURF-15": { kind: "rendered", render: () => markup(import("@/app/admin/performance/page")) },

  "SURF-16": {
    kind: "exercised",
    routeFile: "app/api/checkout/session/route.ts",
    suites: ["__tests__/checkout/session-window-gates.test.ts", "__tests__/checkout/session-contract-reuse.test.ts"],
    guard: /isHeldProduct\(/,
  },
  "SURF-17": {
    kind: "exercised",
    routeFile: "app/api/contingency-intake/route.ts",
    suites: ["__tests__/products/retired-surfaces.test.ts"],
    guard: /heldProductResponse\(|isHeldProduct\(/,
  },
  "SURF-18": {
    kind: "exercised",
    routeFile: "app/api/billing/pay-invoice/route.ts",
    suites: ["__tests__/products/retired-surfaces.test.ts"],
    guard: /heldProductResponse\(|isHeldProduct\(/,
  },
  "SURF-19": {
    kind: "exercised",
    routeFile: "app/api/admin/create-performance-invoice/route.ts",
    suites: ["__tests__/products/retired-surfaces.test.ts"],
    guard: /heldProductResponse\(|isHeldProduct\(/,
  },
  "SURF-20": {
    kind: "exercised",
    routeFile: "app/api/cron/performance-invoices/route.ts",
    suites: [
      "__tests__/products/retired-surfaces.test.ts",
      // The held response was proven; the authorization in front of it was not.
      // This route carried the last `if (expectedKey && ...)` guard in the tree.
      "__tests__/cron/performance-invoices-auth.test.ts",
    ],
    guard: /heldProductResponse\(|isHeldProduct\(/,
  },
  "SURF-21": {
    kind: "exercised",
    routeFile: "app/api/drip/send/route.ts",
    suites: ["__tests__/products/retired-surfaces.test.ts"],
    guard: /heldProductResponse\(|isHeldProduct\(/,
  },
  "SURF-22": {
    kind: "exercised",
    routeFile: "app/api/township-alert/route.ts",
    // `retired-surfaces.test.ts` was named here and contains no reference to
    // this route; the row was counted, not proven. These two drive it: the
    // first asserts the held-BOR refusal, the roster key and the no-schedule
    // confirmation; the second imports the real `POST` for side-effect gating.
    suites: [
      "__tests__/products/township-alert-fail-closed.test.ts",
      "__tests__/v2/preview-side-effects.test.ts",
    ],
    // `/township/i` matched 48 times in this file and could not fail. The
    // roster check is the invariant that keeps a subscription keyed to a name
    // the county actually uses; delete it and this guard stops matching.
    guard: /ROSTER_TOWNSHIP_NAMES\.has\(township\)/,
  },
}

/* ── Accounting ───────────────────────────────────────────────────────────── */

describe("named-surface accounting", () => {
  it("places all 22 rows, and places nothing that is not a row", () => {
    expect(matrix.named_surfaces).toHaveLength(22)
    const ids = matrix.named_surfaces.map((s) => s.surface_id).sort()
    expect(Object.keys(SURFACES).sort()).toEqual(ids)
  })

  it("states the coverage kind for every row", () => {
    // The failure this replaces was a count standing in for coverage, so the
    // split is asserted rather than described: 15 opened, 7 driven, 0 assumed.
    const kinds = Object.values(SURFACES).reduce<Record<string, number>>((acc, s) => {
      acc[s.kind] = (acc[s.kind] ?? 0) + 1
      return acc
    }, {})
    expect(kinds).toEqual({ rendered: 12, exercised: 7, absent: 3 })
  })
})

/* ── Absent surfaces ──────────────────────────────────────────────────────── */

describe("surfaces the app does not claim", () => {
  const absent = Object.entries(SURFACES).filter(([, s]) => s.kind === "absent") as Array<[string, Absent]>

  it.each(absent)("%s has no route, so it 404s", (_id, surface) => {
    for (const ext of ["", "/page.tsx", "/route.ts"]) {
      expect(existsSync(join(ROOT, surface.appPath + ext))).toBe(false)
    }
  })
})

/* ── Rendered surfaces ────────────────────────────────────────────────────── */

describe("rendered named surfaces publish no unverified claim", () => {
  const rendered = Object.entries(SURFACES).filter(([, s]) => s.kind === "rendered") as Array<[string, Rendered]>

  it.each(rendered)("%s renders and sweeps clean", async (id, surface) => {
    const path = matrix.named_surfaces.find((s) => s.surface_id === id)!.path
    const html = await surface.render()
    expect(html.length).toBeGreaterThan(0)
    sweep(html, `${id} ${path}`)
    expectNoCaptureOrHeldOffer(html, `${id} ${path}`)
  })
})

/* ── Exercised surfaces ───────────────────────────────────────────────────── */

describe("exercised named surfaces keep their fail-closed guard and their proof", () => {
  const exercised = Object.entries(SURFACES).filter(([, s]) => s.kind === "exercised") as Array<[string, Exercised]>

  it.each(exercised)("%s still guards, and is still proven", (_id, surface) => {
    const src = readFileSync(join(ROOT, surface.routeFile), "utf8")
    expect(surface.guard.test(src)).toBe(true)
    for (const suite of surface.suites) {
      expect({ suite, exists: existsSync(join(ROOT, suite)) }).toEqual({ suite, exists: true })
    }
  })

  it.each(exercised)("%s names suites that actually reference the route", (_id, surface) => {
    // SURF-22 named a suite containing zero references to its route. A file
    // that does not mention the route cannot be driving it, and the row is
    // then an assertion that a filename exists.
    const routeModule = surface.routeFile.replace(/\/route\.ts$/, "")
    for (const suite of surface.suites) {
      const src = readFileSync(join(ROOT, suite), "utf8")
      expect({ suite, mustReference: routeModule, found: src.includes(routeModule) }).toEqual({
        suite,
        mustReference: routeModule,
        found: true,
      })
    }
  })

  it.each(exercised)("%s uses a guard that can fail", (_id, surface) => {
    // A guard is evidence only if the route could stop satisfying it. The
    // rejected `/township/i` matched 48 times: no edit short of deleting the
    // file would have moved it. Every real guard here names one construct and
    // matches it once, so removing that construct fails this row.
    const src = readFileSync(join(ROOT, surface.routeFile), "utf8")
    const global = new RegExp(surface.guard.source, `${surface.guard.flags.replace("g", "")}g`)
    const matches = src.match(global) ?? []
    expect({ route: surface.routeFile, matches: matches.length }).toEqual({
      route: surface.routeFile,
      matches: 1,
    })

    // And prove it directly: excise the matched construct, and the guard dies.
    const mutated = src.replace(global, "")
    expect({ route: surface.routeFile, survivesMutation: surface.guard.test(mutated) }).toEqual({
      route: surface.routeFile,
      survivesMutation: false,
    })
  })
})

/* ── /contact, the accepted row that was counted but never opened ─────────── */

describe("/contact", () => {
  it("is accepted row 35 and is actually rendered here", async () => {
    const row = matrix.accepted_routes.find((r) => r.path === "/contact")
    expect(row?.accepted_path_id).toBe(35)

    const html = await markup(import("@/app/contact/page"))
    expect(html.length).toBeGreaterThan(0)
    sweep(html, "/contact")
  })

  it("implies no missed-deadline rescue", () => {
    // Map row 44: "Remove missed-deadline handling implication; official-source
    // referral only." A contact form that hints we can do something about a
    // deadline already passed is the one promise nobody can keep.
    const text = readable(renderToStaticMarkup(require("@/app/contact/page").default()))
    expect(text).not.toMatch(/missed (your |the )?deadline/i)
    expect(text).not.toMatch(/we can still/i)
    expect(text).not.toMatch(/too late/i)
  })
})
