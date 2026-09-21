import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import CheckoutPage from "@/components/ot-design/CheckoutPage"
import PricingPageClient from "@/components/ot-design/PricingPageClient"
import HomePage from "@/components/ot-design/HomePage"
import TermsPage from "@/app/terms/page"
import {
  NEUTRAL_REPORT_LIMITS,
  NEUTRAL_REPORT_NAME,
  NEUTRAL_REPORT_REFUND,
  NEUTRAL_REPORT_REFUND_COMPLETE_REPORT,
  NEUTRAL_REPORT_REFUND_CURE,
  NEUTRAL_REPORT_REFUND_EXCLUSIONS,
  NEUTRAL_REPORT_REFUND_INTERRUPTION,
  NEUTRAL_REPORT_REFUND_NONWAIVER,
  NEUTRAL_REPORT_REFUND_REQUEST,
  NEUTRAL_REPORT_REFUND_VOLUNTARY,
  neutralReportCopyEnabled,
} from "@/lib/copy/neutral-report"

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock("@/lib/marketing/preview-gate-client", () => ({ isClientPreviewStubMode: () => false }))

describe("neutral report copy governance", () => {
  it("is default-off and requires the exact server commerce flag", () => {
    expect(neutralReportCopyEnabled({})).toBe(false)
    expect(neutralReportCopyEnabled({ OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "1" })).toBe(false)
    expect(neutralReportCopyEnabled({ OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "true" })).toBe(true)
  })

  it.each([
    ["checkout", <CheckoutPage neutralReport />],
    ["pricing", <PricingPageClient neutralReport />],
  ])("renders the approved contract on %s without appeal-argument claims", (_surface, node) => {
    const html = renderToStaticMarkup(node)
    expect(html).toContain(NEUTRAL_REPORT_NAME.replace("&", "&amp;"))
    expect(html).toContain("$69")
    expect(html).toContain("Matching Property")
    expect(html).toContain("human quality check")
    expect(html).toContain("within one business day")
    expect(html).toContain("refund")
    expect(html).not.toMatch(/appeal argument|you are eligible to appeal|estimated savings|we recommend (?:that )?you appeal/i)
  })

  it("states narrow limits and an objective refund trigger", () => {
    expect(NEUTRAL_REPORT_LIMITS).toMatch(/not an appraisal.*eligibility decision.*savings estimate.*outcome prediction.*recommendation to appeal/i)
    expect(NEUTRAL_REPORT_REFUND).toMatch(/cannot produce the complete report.*refund.*in full/i)
    expect(NEUTRAL_REPORT_REFUND).toMatch(/outcome does not create a refund right/i)
  })

  it("defines completeness by the checkout promise rather than customer satisfaction", () => {
    expect(NEUTRAL_REPORT_REFUND_COMPLETE_REPORT).toMatch(/sections.*source information.*downloadable files.*checkout/i)
    expect(NEUTRAL_REPORT_REFUND_COMPLETE_REPORT).toMatch(/official records reasonably available.*preparation/i)
    expect(NEUTRAL_REPORT_REFUND_COMPLETE_REPORT).toMatch(/may.*few or no matching properties.*complete/i)
    expect(NEUTRAL_REPORT_REFUND_COMPLETE_REPORT).not.toMatch(/satisfaction|sole discretion|any file/i)
  })

  it("provides a bounded correction-first process without weakening the full-refund floor", () => {
    expect(NEUTRAL_REPORT_REFUND_REQUEST).toMatch(/please contact.*within 30 days of delivery.*order reference.*missing/i)
    expect(NEUTRAL_REPORT_REFUND_REQUEST).toMatch(/later request.*review/i)
    expect(NEUTRAL_REPORT_REFUND_CURE).toMatch(/investigate.*correct.*re-deliver/i)
    expect(NEUTRAL_REPORT_REFUND_CURE).toMatch(/five business days after.*request.*refund the \$69 report fee in full/i)
    expect(NEUTRAL_REPORT_REFUND_CURE).toMatch(/extend.*only with your agreement/i)
    expect(NEUTRAL_REPORT_REFUND_CURE).toMatch(/does not replace.*full-refund promise/i)
  })

  it("separates delivery failure from outcome, data, and change-of-mind dissatisfaction", () => {
    expect(NEUTRAL_REPORT_REFUND_EXCLUSIONS).toMatch(/few or no matching properties/i)
    expect(NEUTRAL_REPORT_REFUND_EXCLUSIONS).toMatch(/change of mind/i)
    expect(NEUTRAL_REPORT_REFUND_EXCLUSIONS).toMatch(/official records.*disagree/i)
    expect(NEUTRAL_REPORT_REFUND_EXCLUSIONS).toMatch(/assessment.*appeal.*tax.*savings outcome/i)
    expect(NEUTRAL_REPORT_REFUND_EXCLUSIONS).toMatch(/records change after.*retrieval date/i)
  })

  it("allows a pause, revised date, or full cancellation when inputs or sources block completion", () => {
    expect(NEUTRAL_REPORT_REFUND_INTERRUPTION).toMatch(/request clarification.*revised delivery date/i)
    expect(NEUTRAL_REPORT_REFUND_INTERRUPTION).toMatch(/accept.*revised date.*cancel.*refund/i)
    expect(NEUTRAL_REPORT_REFUND_INTERRUPTION).toMatch(/materially different product.*agreement/i)
  })

  it("reserves voluntary remedies without replacing nonwaivable rights", () => {
    expect(NEUTRAL_REPORT_REFUND_VOLUNTARY).toMatch(/correction.*replacement.*partial refund.*credit.*full refund/i)
    expect(NEUTRAL_REPORT_REFUND_VOLUNTARY).toMatch(/does not modify this policy/i)
    expect(NEUTRAL_REPORT_REFUND_NONWAIVER).toMatch(/does not limit.*right.*cannot.*waived/i)
    const all = [NEUTRAL_REPORT_REFUND, NEUTRAL_REPORT_REFUND_COMPLETE_REPORT, NEUTRAL_REPORT_REFUND_REQUEST, NEUTRAL_REPORT_REFUND_CURE, NEUTRAL_REPORT_REFUND_EXCLUSIONS, NEUTRAL_REPORT_REFUND_INTERRUPTION, NEUTRAL_REPORT_REFUND_VOLUNTARY, NEUTRAL_REPORT_REFUND_NONWAIVER].join(" ")
    expect(all).not.toMatch(/all sales (?:are )?final|sole discretion|waive.*chargeback|retroactive/i)
  })

  it("renders the complete policy in Terms when the neutral gate is on", () => {
    const prior = process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED
    process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = "true"
    try {
      const html = renderToStaticMarkup(<TermsPage />)
      for (const paragraph of [NEUTRAL_REPORT_REFUND, NEUTRAL_REPORT_REFUND_COMPLETE_REPORT, NEUTRAL_REPORT_REFUND_REQUEST, NEUTRAL_REPORT_REFUND_CURE, NEUTRAL_REPORT_REFUND_EXCLUSIONS, NEUTRAL_REPORT_REFUND_INTERRUPTION, NEUTRAL_REPORT_REFUND_VOLUNTARY, NEUTRAL_REPORT_REFUND_NONWAIVER]) {
        expect(html).toContain(paragraph.replaceAll("'", "&#x27;"))
      }
    } finally {
      if (prior === undefined) delete process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED
      else process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = prior
    }
  })

  it("preserves the legacy product when the neutral gate is off", () => {
    const checkout = renderToStaticMarkup(<CheckoutPage />)
    const pricing = renderToStaticMarkup(<PricingPageClient />)
    expect(checkout).toContain("DIY Appeal Packet")
    expect(pricing).toContain("DIY Appeal Packet")
    expect(checkout).not.toContain(NEUTRAL_REPORT_NAME)
  })

  it("removes legacy appeal-product promises from the neutral homepage", () => {
    const html = renderToStaticMarkup(<HomePage neutralReport />)
    expect(html).toContain(NEUTRAL_REPORT_NAME.replace("&", "&amp;"))
    expect(html).not.toMatch(/DIY Appeal Packet|appeal argument|Cook County-ready appeal packet|we tell you whether your number is out of line|support closer review/i)
  })

  it("does not negate the objective neutral refund in Terms", () => {
    const prior = process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED
    process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = "true"
    try {
      const html = renderToStaticMarkup(<TermsPage />)
      expect(html).toContain(NEUTRAL_REPORT_REFUND)
      expect(html).not.toMatch(/DIY Appeal Packet|appeal argument|procedural error|property is not eligible|appeal window is closed|within 30 days of the county notice|include the notice or filing status/i)
    } finally {
      if (prior === undefined) delete process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED
      else process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = prior
    }
  })
})
