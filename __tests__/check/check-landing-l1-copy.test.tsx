/**
 * @jest-environment node
 *
 * L-1: the `/check` landing copy for the Jefferson free-check pilot.
 *
 * Owner rulings recorded with this change:
 *   - `/check` is an exception to CC-18 and carries CC-12 only. CC-01 names the
 *     paid Assessor-stage packet, which a free-only landing must not describe.
 *     The canonical definitions and the frozen governance fixture are untouched.
 *   - The footer's township count and cycle-year labels are omitted on `/check`
 *     only. "2028 cycle" filed Jefferson under a year the official sources
 *     contradict; the sitewide correction belongs to a separate change.
 *
 * Every other surface keeps the default footer, and `neutralReport` keeps its
 * own. Items 5 and 6 below are what bound the blast radius to `/check`.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"

import CheckPage, { metadata } from "@/app/check/page"
import { SiteFooter } from "@/components/ot-design/SiteChrome"
import { CC_01, CC_12, CC_18 } from "@/lib/copy/canonical"
import { NEUTRAL_REPORT_LIMITS, NEUTRAL_REPORT_NAME } from "@/lib/copy/neutral-report"

const H1 = "Free Cook County Property Check"
const SUBLINE =
  "Enter your PIN or address. We'll compare your assessed value with comparable properties on the public record, and show your township's appeal-window status where we have verified it. No account, no card."

const FORBIDDEN_ON_CHECK = [
  "over-assessing",
  "assessment-level gap",
  "10% target",
  "prepares a defined Assessor-stage appeal packet",
  "$69",
  "DIY Appeal Packet",
  "2026 cycle",
  "2027 cycle",
  "2028 cycle",
]

const MUST_REMAIN_ON_CHECK = [
  "Free · No signup required",
  "Check my assessment",
  "I have my PIN",
  "Look up by address",
  "Free · No account required · Uses public Cook County Assessor records",
  "OverTaxed IL is not a law firm and does not provide legal or tax advice. We do not guarantee a reduction — county decisions are final.",
  "Don't know your PIN?",
  "© 2026 OverTaxed IL · Chicago, IL",
]

/** Decode the entities `renderToStaticMarkup` emits and collapse whitespace. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

const checkHtml = renderToStaticMarkup(CheckPage())
const checkText = text(checkHtml)
const checkSource = readFileSync(join(process.cwd(), "app/check/page.tsx"), "utf8")

describe("/check L-1 landing copy", () => {
  it("renders exactly one H1, equal to the approved headline", () => {
    const h1s = [...checkHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => text(m[1]))
    expect(h1s).toEqual([H1])
  })

  it("renders the approved subline", () => {
    expect(checkText).toContain(SUBLINE)
  })

  it.each(FORBIDDEN_ON_CHECK)("does not render %p", (phrase) => {
    expect(checkText).not.toContain(phrase)
  })

  it("carries CC-12 and not CC-01 (CC-18 exception for /check)", () => {
    expect(checkText).toContain(CC_12)
    expect(checkText).not.toContain(CC_01)
    expect(checkText).not.toContain(CC_18)
  })

  it.each(MUST_REMAIN_ON_CHECK)("still renders %p", (phrase) => {
    expect(checkText).toContain(phrase)
  })

  it("still renders 'not a law firm' and mounts a self-closing SiteFooter", () => {
    expect(checkText).toMatch(/not a law firm/i)
    expect(checkSource).toMatch(/<SiteFooter\b[^>]*\/>/)
  })

  it("keeps the footer township group labels and links, without count or cycle text", () => {
    for (const label of ["South &amp; West", "North Suburbs", "City of Chicago"]) {
      expect(checkHtml).toContain(label)
    }
    expect(checkHtml).toContain('href="/township/jefferson"')
    expect(checkHtml).toContain('href="/townships"')
    expect(checkText).not.toMatch(/\d+ · \d{4} cycle/)
  })

  it("keeps metadata title, description and canonical", () => {
    expect(metadata.title).toBe("Free Cook County Property Check")
    expect(metadata.description).toBe(
      "See how your Cook County assessed value compares with comparable properties on the public record. Free check — no signup. Built around Cook County Assessor public records.",
    )
    expect(metadata.alternates.canonical).toBe("https://www.overtaxed-il.com/check")
  })
})

describe("SiteFooter blast radius", () => {
  it("default footer still carries CC-18 and the cycle labels", () => {
    const html = renderToStaticMarkup(<SiteFooter />)
    const footerText = text(html)
    expect(footerText).toContain(CC_18)
    expect(footerText).toContain("2026 cycle")
    expect(footerText).toContain("2027 cycle")
    expect(footerText).toContain("2028 cycle")
  })

  it("neutralReport footer is unchanged and still links /refunds", () => {
    const html = renderToStaticMarkup(<SiteFooter neutralReport />)
    const footerText = text(html)
    expect(footerText).toContain(`${NEUTRAL_REPORT_NAME}. ${NEUTRAL_REPORT_LIMITS}`)
    expect(footerText).not.toContain(CC_18)
    expect(footerText).toContain("Cook County assessment records, organized for homeowners.")
    expect(footerText).toContain("Official-record compilation, not advice")
    expect(footerText).toContain("2028 cycle")
    expect(html).toContain('href="/refunds"')
  })
})
