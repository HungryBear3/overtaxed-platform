/**
 * @jest-environment node
 *
 * Additive governed public surfaces — implementer-owned, pending controller
 * ratification.
 *
 * The controller's frozen packet declares 53 accepted routes and 22 named
 * surfaces. That declaration is byte-frozen and is **not** modified by this
 * file: `qa/acceptance-matrix.json`, `qa/SHA256SUMS.txt` and `qa/qa_runner.py`
 * are untouched, and their counts remain 53 and 22.
 *
 * This registry is the **ratified additive governance layer** for individually
 * swept public surfaces. It governs reachable surfaces the frozen declaration
 * does not cover, so that "not in the matrix" stops meaning "never opened by
 * anything". It is a standing extension point, not frozen-controller membership
 * and not an exemption mechanism: an entry here faces the same sweeps a
 * controller-declared surface faces and gains no allowance.
 *
 * `/homestead-exemption` is also a member of the crawlable page-route layer in
 * `__tests__/acceptance/page-route-governance.test.tsx`, which reconciles the
 * whole route surface; this file is the deep per-surface sweep for it. The two
 * are asserted consistent there, and neither double-counts the other.
 *
 * The first entry is `/homestead-exemption`, and it is here because of what it
 * cost. It is a live, indexable page in neither the 53-route corpus nor the 22
 * named surfaces, so no sweep had ever rendered it. It linked to
 * `cookcountyassessor.com` — the host the controller ruled against and that M8
 * corrected everywhere the map reached — and it served the download button for
 * `homestead-exemption-guide.md`, the worst document in the served tree: a
 * per-county savings table, "saved an average of $1,200+ per year", and a live
 * $37 Etsy offer. Both were reachable the whole time, from a surface nothing
 * governed.
 *
 * Counts reported by this file are **additive coverage**. They are not a change
 * to the controller corpus and must never be added to the 53/22 figures when
 * reporting controller status.
 */
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

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement, type ReactElement } from "react"

import { BANNED_LEXICON, readable } from "../lexicon/banned-claims.test"

const ROOT = resolve(__dirname, "../..")

/** The canonical Cook County Assessor host. Anything else is a finding. */
const CANONICAL_HOST = "cookcountyassessoril.gov"
const NON_CANONICAL_HOSTS = [/cookcountyassessor\.com/i, /cookcountyboardofreview\.com/i]

/** The five documents withdrawn from the served tree by `a55ab7c`. */
const RETIRED_DOWNLOAD_PATHS = [
  "/downloads/county-deadline-calendar.md",
  "/downloads/filing-instructions.md",
  "/downloads/faq.md",
  "/downloads/cover-letter-template.md",
  "/downloads/homestead-exemption/homestead-exemption-guide.md",
]

/* ── Actionability rules ──────────────────────────────────────────────────── */

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December"

type Rule = { id: string; hit: (text: string, html: string) => boolean }

/**
 * What a governed informational surface may not do.
 *
 * Not "may not mention a deadline" — may not put the reader in a position to
 * act on one this page cannot verify.
 */
const ACTIONABILITY_RULES: Rule[] = [
  {
    id: "GS-1 states an appeal deadline of its own",
    hit: (t) =>
      new RegExp(`\\b(${MONTH})\\s+\\d{1,2},?\\s+(19|20)\\d{2}\\b`).test(t) ||
      /\b(19|20)\d{2}-\d{2}-\d{2}\b/.test(t) ||
      /\b\d{1,2}\/\d{1,2}\/(19|20)\d{2}\b/.test(t),
  },
  {
    id: "GS-2 runs a countdown",
    hit: (t) => /\b\d+\s*(days?|business days?|weeks?)\s*(left|remaining|until|before|to file|to appeal)/i.test(t),
  },
  {
    id: "GS-3 asserts an open or closing window",
    hit: (t) =>
      /\b(window is (now )?open|currently open|open now|closes? (today|tomorrow|soon)|deadline is approaching|filing is open)\b/i.test(t),
  },
  {
    id: "GS-4 recommends filing or asserts merits",
    hit: (t) =>
      /\b(you should (file|appeal)|we recommend (filing|appealing)|worth appealing|file your appeal now|start your appeal)\b/i.test(t),
  },
  {
    id: "GS-5 offers reminder capture",
    hit: (t, html) =>
      /\b(remind me|get a reminder|deadline reminder|notify me when|email me when)\b/i.test(t) ||
      /name=["']email["']/i.test(html),
  },
  {
    id: "GS-6 offers a paid capability",
    hit: (t, html) =>
      /\/auth\/signup\?plan=/.test(html) ||
      /\bcheckout\b/i.test(html) ||
      /\$\s?\d[\d,]*/.test(t),
  },
  {
    id: "GS-7 states a savings or overpayment figure",
    hit: (t) =>
      /\$\s?\d[\d,]*(\s*[–—-]\s*\$?\s?\d[\d,]*)?\s*(\/|\bper\b)?\s*(year|yr|annually)/i.test(t) ||
      /\bestimated\s+(annual\s+)?(tax\s+)?savings\b/i.test(t) ||
      /\bhow\s+much\s+can\s+you\s+save\b/i.test(t),
  },
]

/* ── Registry ─────────────────────────────────────────────────────────────── */

type GovernedSurface = {
  path: string
  file: string
  /** Modules whose text the page renders, swept together with the page. */
  render: () => Promise<string>
  /** True when the surface reads request/session/snapshot state. */
  consumesDynamicState: boolean
}

type PageModule = { default: (props: never) => ReactElement | Promise<ReactElement> }

async function markup(mod: Promise<unknown>, props?: unknown): Promise<string> {
  const Page = ((await mod) as PageModule).default
  const isAsync = Page.constructor.name === "AsyncFunction"
  const el = isAsync
    ? await (Page as (p?: unknown) => Promise<ReactElement>)(props)
    : createElement(Page as never, props as never)
  return renderToStaticMarkup(el)
}

const GOVERNED: Record<string, GovernedSurface> = {
  "GS-HOMESTEAD": {
    path: "/homestead-exemption",
    file: "app/homestead-exemption/page.tsx",
    render: () => markup(import("@/app/homestead-exemption/page")),
    consumesDynamicState: false,
  },
}

/* ── Accounting ───────────────────────────────────────────────────────────── */

describe("additive governed-surface accounting", () => {
  it("is additive, and says so — the controller declaration is untouched", () => {
    const matrix = JSON.parse(
      readFileSync(
        "/Users/abigailclaw/.openclaw/workspace/rex/handoffs/ot-minimum-postable-rebuild-20260819/qa/acceptance-matrix.json",
        "utf8",
      ),
    ) as { accepted_routes: unknown[]; named_surfaces: unknown[] }

    // Controller-ratified, frozen, and not changed by this file.
    expect(matrix.accepted_routes).toHaveLength(53)
    expect(matrix.named_surfaces).toHaveLength(22)

    // Additive, implementer-owned, pending ratification.
    expect(Object.keys(GOVERNED)).toEqual(["GS-HOMESTEAD"])
  })

  it("governs only surfaces the frozen declaration does not already cover", () => {
    const matrix = JSON.parse(
      readFileSync(
        "/Users/abigailclaw/.openclaw/workspace/rex/handoffs/ot-minimum-postable-rebuild-20260819/qa/acceptance-matrix.json",
        "utf8",
      ),
    ) as { accepted_routes: Array<{ path: string }>; named_surfaces: Array<{ path: string }> }

    const declared = new Set([
      ...matrix.accepted_routes.map((r) => r.path),
      ...matrix.named_surfaces.map((s) => s.path),
    ])
    for (const surface of Object.values(GOVERNED)) {
      expect({ path: surface.path, alreadyDeclared: declared.has(surface.path) }).toEqual({
        path: surface.path,
        alreadyDeclared: false,
      })
    }
  })

  it("names a real route file for every governed surface", () => {
    for (const surface of Object.values(GOVERNED)) {
      expect({ file: surface.file, exists: existsSync(join(ROOT, surface.file)) }).toEqual({
        file: surface.file,
        exists: true,
      })
    }
  })
})

/* ── The governed sweep ───────────────────────────────────────────────────── */

const entries = Object.entries(GOVERNED)

describe("governed public surfaces render safely", () => {
  it.each(entries)("%s renders non-empty markup", async (_id, surface) => {
    const html = await surface.render()
    expect(html.length).toBeGreaterThan(0)
  })

  it.each(entries)("%s uses only the canonical Assessor host", async (_id, surface) => {
    const html = await surface.render()
    for (const host of NON_CANONICAL_HOSTS) {
      expect({ path: surface.path, host: String(host), rendered: host.test(html) }).toEqual({
        path: surface.path,
        host: String(host),
        rendered: false,
      })
    }
    // And it does cite the canonical one, so "clean" cannot mean "cites nothing".
    expect(html).toContain(CANONICAL_HOST)
  })

  it.each(entries)("%s links to no retired public download", async (_id, surface) => {
    const html = await surface.render()
    for (const path of RETIRED_DOWNLOAD_PATHS) {
      expect({ path: surface.path, retired: path, linked: html.includes(path) }).toEqual({
        path: surface.path,
        retired: path,
        linked: false,
      })
    }
    // Not just the exact paths — no download affordance into the retired tree.
    expect(/href=["'][^"']*\/downloads\/(county-deadline|filing-instructions|faq\.md|cover-letter|homestead-exemption)/i.test(html)).toBe(false)
  })

  it.each(entries)("%s makes no banned claim, frozen or newly added", async (_id, surface) => {
    const html = await surface.render()
    const text = readable(html)
    for (const [id, pattern] of BANNED_LEXICON) {
      expect({ path: surface.path, id, matched: pattern.test(text) }).toEqual({
        path: surface.path,
        id,
        matched: false,
      })
    }
  })

  it.each(entries)("%s emits no actionable deadline, capture, or paid state", async (_id, surface) => {
    const html = await surface.render()
    const text = readable(html)
    const tripped = ACTIONABILITY_RULES.filter((r) => r.hit(text, html)).map((r) => r.id)
    expect({ path: surface.path, tripped }).toEqual({ path: surface.path, tripped: [] })
  })

  it.each(entries)("%s reads no dynamic state, so there is no malformed input to survive", (_id, surface) => {
    // The brief requires malformed/missing/stale/synthetic-input proof *if* the
    // surface consumes dynamic state. Rather than assert that claim in prose,
    // this proves it from the source: no request, session, snapshot, database,
    // provider or search-param read. If that ever changes, this fails and the
    // input cases become required.
    if (surface.consumesDynamicState) return
    const src = readFileSync(join(ROOT, surface.file), "utf8")
    const forbidden: Array<[string, RegExp]> = [
      ["searchParams", /searchParams/],
      ["cookies/headers", /\b(cookies|headers)\s*\(/],
      ["session", /getSession|useSession/],
      ["database", /\bprisma\b/],
      ["snapshot/projection", /projectDeadline|describeTownshipCalendar|OFFICIAL_DEADLINE_SNAPSHOT|deadlines-2026/],
      ["fetch", /\bfetch\s*\(/],
      ["free-check state", /sessionStorage|freeCheckResult/],
    ]
    const reads = forbidden.filter(([, p]) => p.test(src)).map(([name]) => name)
    expect({ file: surface.file, reads }).toEqual({ file: surface.file, reads: [] })
  })
})

/* ── The non-canonical host outside this task's scope ─────────────────────── */

/**
 * The non-canonical Assessor host is gone from every served source.
 *
 * Two authenticated surfaces outlived M8's sweep — neither `/properties/add`
 * nor `/appeals/[id]` appears in the frozen 53/22 declaration, and `robots.ts`
 * disallows both prefixes, so neither was crawlable. They have now been
 * normalized, and the backlog below is empty.
 *
 * It stays as an empty pin rather than being deleted, because an empty expected
 * object is the assertion that matters: a new `cookcountyassessor.com` anywhere
 * under `app/`, `components/`, `lib/`, `content/` or `public/` fails this, and
 * there is no per-file allowance left to grow.
 */
const NON_CANONICAL_HOST_BACKLOG: Record<string, number> = {
  // Closed. `app/properties/add/page.tsx` (3) and
  // `components/appeals/add-comps-dialog.tsx` (4) were the last seven; both
  // pointed at paths already proven on the canonical host — the bare host and
  // `/address-search` — so the correction was a host swap with the path
  // preserved, and no official URL had to be invented.
}

describe("the non-canonical Assessor host is contained and pinned", () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${entry}`
      if (statSync(join(ROOT, rel)).isDirectory()) sourceFiles(rel, out)
      else if (/\.(ts|tsx|md|json)$/.test(entry)) out.push(rel)
    }
    return out
  }

  it("appears in exactly the pinned files, at the pinned counts", () => {
    const files = [
      ...sourceFiles("app"),
      ...sourceFiles("components"),
      ...sourceFiles("lib"),
      ...sourceFiles("content"),
      ...sourceFiles("public"),
    ]
    const found: Record<string, number> = {}
    for (const rel of files) {
      const matches = readFileSync(join(ROOT, rel), "utf8").match(/cookcountyassessor\.com/gi)
      if (matches) found[rel] = matches.length
    }
    expect(found).toEqual(NON_CANONICAL_HOST_BACKLOG)
  })

  it("does not appear on any governed public surface", async () => {
    for (const surface of Object.values(GOVERNED)) {
      const html = await surface.render()
      expect({ path: surface.path, found: /cookcountyassessor\.com/i.test(html) }).toEqual({
        path: surface.path,
        found: false,
      })
    }
  })

  it("keeps the authenticated prefixes out of the index regardless", () => {
    // Belt and braces: those two surfaces are corrected, and they were also
    // never crawlable. Both facts should stay true.
    const robots = readFileSync(join(ROOT, "app/robots.ts"), "utf8")
    for (const prefix of ["/properties", "/appeals"]) {
      expect(robots).toContain(`"${prefix}"`)
    }
  })
})

/* ── Falsifiability ───────────────────────────────────────────────────────── */

describe("the governed sweep can actually fail", () => {
  /**
   * Each mutant is the exact regression it guards against, applied to the
   * rendered markup rather than to the file, so the check under test is the one
   * the sweep runs.
   */
  async function rendered(): Promise<string> {
    return GOVERNED["GS-HOMESTEAD"].render()
  }

  it("catches the non-canonical host being reintroduced", async () => {
    const mutant = (await rendered()).replace(
      /cookcountyassessoril\.gov\/address-search/,
      "cookcountyassessor.com/exemptions",
    )
    expect(NON_CANONICAL_HOSTS.some((h) => h.test(mutant))).toBe(true)
  })

  it("catches a retired download being linked again", async () => {
    const mutant =
      (await rendered()) +
      '<a href="/downloads/homestead-exemption/homestead-exemption-guide.md" download>Download free guide</a>'
    const linked = RETIRED_DOWNLOAD_PATHS.filter((p) => mutant.includes(p))
    expect(linked).toEqual(["/downloads/homestead-exemption/homestead-exemption-guide.md"])
  })

  it("catches each newly added lexicon variant on this previously clean surface", async () => {
    const base = await rendered()
    const cases: Array<[string, string]> = [
      ["BL-B1 averaged savings, inflected", "<p>Homeowners who've saved an average of $1,200+ per year.</p>"],
      ["BL-B5 guarantee, nothing to lose", "<p>You have nothing to lose by filing.</p>"],
    ]
    for (const [id, injected] of cases) {
      const text = readable(base + injected)
      const rule = BANNED_LEXICON.find(([label]) => label === id)
      expect({ id, present: Boolean(rule) }).toEqual({ id, present: true })
      expect({ id, caught: rule![1].test(text) }).toEqual({ id, caught: true })
    }
    // And the clean page trips neither.
    const cleanText = readable(base)
    for (const [id] of cases) {
      const rule = BANNED_LEXICON.find(([label]) => label === id)!
      expect({ id, cleanMatched: rule[1].test(cleanText) }).toEqual({ id, cleanMatched: false })
    }
  })

  it.each(ACTIONABILITY_RULES.map((r) => r.id))("catches %s", async (id) => {
    const INJECTIONS: Record<string, string> = {
      "GS-1 states an appeal deadline of its own": "<p>File by March 14, 2026.</p>",
      "GS-2 runs a countdown": "<p>Only 12 days left to file.</p>",
      "GS-3 asserts an open or closing window": "<p>Your appeal window is now open.</p>",
      "GS-4 recommends filing or asserts merits": "<p>You should appeal this year.</p>",
      "GS-5 offers reminder capture": '<form><input name="email" /></form>',
      "GS-6 offers a paid capability": '<a href="/auth/signup?plan=diy">Start</a>',
      "GS-7 states a savings or overpayment figure": "<p>Estimated Annual Tax Savings of $600–$1,500/year.</p>",
    }
    const mutant = (await rendered()) + INJECTIONS[id]
    const rule = ACTIONABILITY_RULES.find((r) => r.id === id)!
    expect({ id, caught: rule.hit(readable(mutant), mutant) }).toEqual({ id, caught: true })
  })
})
