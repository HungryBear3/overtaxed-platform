/**
 * `/refunds` — the public refund-policy page, and the link that reaches it.
 *
 * The route 404s in production while the refund term itself is live in two
 * places (Terms of Service §7 and the purchase surfaces), so anyone following
 * a "refund policy" link lands on nothing. This suite pins the fix to the
 * narrow shape it is allowed to take: the page restates the *approved*
 * contract by importing it, it never widens it, and the neutral product is
 * only named when the neutral commerce gate is on — the same condition
 * `app/terms/page.tsx` already switches on.
 *
 * The page module is required lazily inside each test on purpose. A missing
 * route would otherwise take the footer-navigation test down with it, and the
 * two failures are independent findings.
 */
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { SiteFooter } from "@/components/ot-design/SiteChrome"
import {
  NEUTRAL_REPORT_NAME,
  NEUTRAL_REPORT_PRICE,
  NEUTRAL_REPORT_REFUND,
  NEUTRAL_REPORT_REFUND_COMPLETE_REPORT,
  NEUTRAL_REPORT_REFUND_CURE,
  NEUTRAL_REPORT_REFUND_EXCLUSIONS,
  NEUTRAL_REPORT_REFUND_INTERRUPTION,
  NEUTRAL_REPORT_REFUND_REQUEST,
  NEUTRAL_REPORT_REFUND_NONWAIVER,
  NEUTRAL_REPORT_REFUND_VOLUNTARY,
} from "@/lib/copy/neutral-report"

function renderRefundsPage(neutralReport: boolean): string {
  const prior = process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED
  if (neutralReport) process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = "true"
  else delete process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@/app/refunds/page") as { default: () => React.ReactElement }
    return renderToStaticMarkup(<mod.default />)
  } finally {
    if (prior === undefined) delete process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED
    else process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = prior
  }
}

describe("/refunds", () => {
  it("restates the approved neutral refund contract verbatim", () => {
    const html = renderRefundsPage(true)
    expect(html).toContain(NEUTRAL_REPORT_REFUND)
    expect(html).toContain(NEUTRAL_REPORT_NAME.replace("&", "&amp;"))
    expect(html).toContain(NEUTRAL_REPORT_PRICE)
  })

  it("keeps the county-decision carve-out that the contract states", () => {
    expect(renderRefundsPage(true)).toContain("does not create a refund right")
  })

  it("renders the complete correction-first refund policy", () => {
    const html = renderRefundsPage(true)
    expect(html).toContain("Last updated: September 2026")
    for (const paragraph of [
      NEUTRAL_REPORT_REFUND_COMPLETE_REPORT,
      NEUTRAL_REPORT_REFUND_INTERRUPTION,
      NEUTRAL_REPORT_REFUND_REQUEST,
      NEUTRAL_REPORT_REFUND_CURE,
      NEUTRAL_REPORT_REFUND_EXCLUSIONS,
      NEUTRAL_REPORT_REFUND_VOLUNTARY,
      NEUTRAL_REPORT_REFUND_NONWAIVER,
    ]) {
      expect(html).toContain(paragraph.replaceAll("'", "&#x27;"))
    }
  })

  it("promises no refund the contract does not", () => {
    const html = renderRefundsPage(true)
    expect(html).not.toMatch(
      /satisfaction|for any reason|no questions asked|money.?back|risk-free|unconditional/i,
    )
    expect(html).not.toMatch(
      /you (?:will|could) save|estimated savings|we recommend (?:that )?you appeal|you are eligible to appeal|if (?:your|the) appeal (?:is denied|fails)/i,
    )
  })

  it("names the neutral product only when the neutral gate is on", () => {
    const html = renderRefundsPage(false)
    expect(html).not.toContain(NEUTRAL_REPORT_NAME.replace("&", "&amp;"))
    // With the gate off the governing term is Terms of Service §7, which this
    // page points at rather than re-typing: two copies of one refund rule is
    // how the two drift apart.
    expect(html).toContain('href="/terms"')
    expect(html).not.toContain("plain-language copy of the refund term")
    expect(html).toContain("directs you to the governing refund terms")
    expect(html).toMatch(/within 30 days of the county notice/i)
    expect(html).toMatch(/include the notice or filing status/i)
    expect(html).toMatch(/procedural error/i)
  })

  it("keeps indexed metadata accurate in both commerce postures", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { metadata } = require("@/app/refunds/page") as { metadata: { description: string } }
    expect(metadata.description).toBe(
      "OverTaxed IL refund policy, governing terms, and instructions for requesting review of an order.",
    )
    expect(metadata.description).not.toMatch(/what we refund|does not create a refund right/i)
  })

  it("only names a refund-request category that the contact form actually provides", () => {
    const source = readFileSync(join(process.cwd(), "components/contact/ContactForm.tsx"), "utf8")
    expect(source).toContain('<option value="refund">Refund Request</option>')
  })

  it("does not couple the legacy packet price to the neutral-report price or promise manual review", () => {
    const source = readFileSync(join(process.cwd(), "app/refunds/page.tsx"), "utf8")
    expect(source).not.toContain('DIY Appeal Packet — ${NEUTRAL_REPORT_PRICE}')
    expect(renderRefundsPage(true)).not.toContain("A person reads it.")
  })

  it("is reachable from the shared footer on both postures", () => {
    expect(renderToStaticMarkup(<SiteFooter />)).toContain('href="/refunds"')
    expect(renderToStaticMarkup(<SiteFooter neutralReport />)).toContain('href="/refunds"')
  })
})
