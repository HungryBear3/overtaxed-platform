/** @jest-environment jsdom */

import React from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"

import PricingPageClient from "@/components/ot-design/PricingPageClient"
import { CC_11, CC_12 } from "@/lib/copy/canonical"
import {
  NEUTRAL_REPORT_LIMITS,
  NEUTRAL_REPORT_NAME,
  NEUTRAL_REPORT_QA,
  NEUTRAL_REPORT_REFUND,
  NEUTRAL_REPORT_SUMMARY,
  NEUTRAL_REPORT_TURNAROUND,
} from "@/lib/copy/neutral-report"

const mockPush = jest.fn()
let mockPreviewMode = false

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))
jest.mock("@/lib/marketing/preview-gate-client", () => ({
  isClientPreviewStubMode: () => mockPreviewMode,
}))

function normalized(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim()
}

function renderMain(neutralReport?: boolean) {
  render(<PricingPageClient {...(neutralReport === undefined ? {} : { neutralReport })} />)
  return screen.getByRole("main")
}

beforeEach(() => {
  mockPush.mockReset()
  mockPreviewMode = false
})

describe("/pricing default — DIY versus paid preparation", () => {
  it("renders the approved heading and the Assessor's free-filing statement with its official link", () => {
    const main = renderMain()
    expect(
      within(main).getByRole("heading", {
        level: 1,
        name: "You can appeal for free. Paid preparation is optional.",
      }),
    ).toBeTruthy()

    const text = normalized(main)
    expect(text).toContain(
      "The Cook County Assessor's Office says filing an appeal is free and can be done online.",
    )
    expect(text).toContain('In its words: "You do not need to hire anyone to file an appeal for you."')

    const assessor = within(main).getByRole("link", { name: "How appeals work" })
    expect(assessor.getAttribute("href")).toBe("https://www.cookcountyassessoril.gov/appeals")
  })

  it("describes the free DIY path and the $69 one-time Assessor-stage preparation the customer files", () => {
    const text = normalized(renderMain())
    expect(text).toContain(
      "You file directly with the Assessor's Office, following its instructions. You do not need OverTaxed IL, or anyone else, to do that.",
    )
    expect(text).toContain(
      "OverTaxed IL's published price is $69, one-time, for Assessor-stage comparable-property preparation built from public Cook County records.",
    )
    expect(text).toContain("We prepare it. You review it, sign it and file it with the county yourself.")
  })

  it("states the representation, advice, outcome and availability limits", () => {
    const text = normalized(renderMain())
    expect(text).toContain(
      "We are not a law firm. We do not represent you and do not give legal or tax advice.",
    )
    expect(text).toContain(
      "We do not guarantee a reduction. A change in assessed value does not produce an equal change in a tax bill.",
    )
    expect(text).toContain(
      "A published price does not mean a packet is available for every property.",
    )
  })

  it("sends the card call to action to /check with the check's limits directly beside it", () => {
    const main = renderMain()
    const cta = within(main).getByRole("link", { name: "Run the free check" })
    expect(cta.getAttribute("href")).toBe("/check")

    const limits = cta.nextElementSibling
    expect(limits).not.toBeNull()
    expect(normalized(limits as Element)).toBe(
      "Results are not available for every property, and a result does not mean a paid packet is available for yours.",
    )
    expect(normalized(cta.previousElementSibling as Element)).toBe("Not sure where you stand?")
  })

  it("offers no purchase control and no checkout link on the default page", () => {
    const main = renderMain()
    expect(within(main).queryAllByRole("button")).toHaveLength(0)
    expect(within(main).queryByText(/buy now/i)).toBeNull()
    for (const link of within(main).getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/checkout/)
    }
  })

  it("drops the unverified packet-contents, support and Board-rule claims", () => {
    const text = normalized(renderMain())
    for (const banned of [
      /appeal argument draft/i,
      /filing guide/i,
      /priority (email )?support/i,
      /ready-to-use comp report/i,
      /comparable property analysis/i,
      /board of review/i,
      /licensed attorney/i,
      /practi[sc]e before/i,
      /\$97\b/,
      /\$149\b/,
      /most popular/i,
      /money-back|full refund|refund guarantee/i,
    ]) {
      expect(text).not.toMatch(banned)
    }
    expect(text).not.toContain(CC_11)
  })

  it("has exactly three FAQ questions", () => {
    renderMain()
    const faq = screen.getByRole("region", { name: "Questions" })
    const questions = within(faq)
      .getAllByRole("heading", { level: 3 })
      .map((h) => normalized(h))
    expect(questions).toEqual([
      "Do I have to pay anyone to appeal?",
      "Does OverTaxed IL file for me or represent me?",
      "Can I get a refund?",
    ])
  })

  it("answers the FAQs with the approved free-filing and no-representation wording", () => {
    renderMain()
    const faq = normalized(screen.getByRole("region", { name: "Questions" }))
    expect(faq).toContain(
      "No. The Assessor's Office says filing is free and that you do not need to hire anyone. Paid preparation is a convenience, not a requirement.",
    )
    expect(faq).toContain(
      "No. We prepare materials for the Assessor stage. You review, sign and file them yourself, and you remain responsible for filing.",
    )
  })

  it("states the refund as a discretionary procedural-error review with its conditions and a Terms link", () => {
    renderMain()
    const faq = screen.getByRole("region", { name: "Questions" })
    const answer = within(faq).getByRole("heading", { name: "Can I get a refund?" })
      .nextElementSibling as Element
    const text = normalized(answer)
    expect(text).toBe(
      "Refunds are not automatic. If your filing is rejected or denied solely because of an OverTaxed IL procedural error in the materials we prepared, contact us within 30 days of the county notice and we will review whether a refund of our fee is appropriate. That review does not apply when the county denies an appeal on the merits, and other exclusions apply. The full conditions are in our Terms.",
    )
    const terms = within(answer as HTMLElement).getByRole("link", { name: "Terms" })
    expect(terms.getAttribute("href")).toBe("https://www.overtaxed-il.com/terms")
  })

  it("keeps the customer-facing copy near the approved ~345 words", () => {
    const words = normalized(renderMain()).split(" ").filter(Boolean)
    // textContent joins adjacent block elements without a space, so the
    // measured count runs slightly below the copy's own word count.
    expect(words.length).toBeGreaterThanOrEqual(280)
    expect(words.length).toBeLessThanOrEqual(400)
  })

  it("keeps the /check call to action and no checkout control in preview mode", () => {
    mockPreviewMode = true
    const main = renderMain()
    expect(within(main).getByRole("link", { name: "Run the free check" }).getAttribute("href")).toBe("/check")
    expect(within(main).queryByText(/preview checkout disabled/i)).toBeNull()
  })
})

describe("/pricing neutralReport branch — unchanged", () => {
  it("renders the neutral report hero, card, limits and contact sections", () => {
    const main = renderMain(true)
    expect(
      within(main).getByRole("heading", {
        level: 1,
        name: "See the official records behind your assessment",
      }),
    ).toBeTruthy()
    expect(within(main).getByRole("heading", { level: 3, name: NEUTRAL_REPORT_NAME })).toBeTruthy()
    expect(
      within(main).getByRole("heading", { level: 2, name: "What the report is, and what it is not" }),
    ).toBeTruthy()

    const text = normalized(main)
    for (const s of [
      NEUTRAL_REPORT_LIMITS,
      NEUTRAL_REPORT_SUMMARY,
      "$69",
      "one-time",
      "Official assessment records with source details",
      "Properties matching the published filters",
      NEUTRAL_REPORT_QA,
      NEUTRAL_REPORT_TURNAROUND,
      NEUTRAL_REPORT_REFUND,
      CC_12,
      CC_11,
    ]) {
      expect(text).toContain(s)
    }

    expect(within(main).getByRole("link", { name: "Email us" }).getAttribute("href")).toBe(
      "mailto:support@overtaxed-il.com",
    )
    expect(within(main).getByRole("link", { name: "run a free check first" }).getAttribute("href")).toBe(
      "/check",
    )
    expect(text).not.toContain("You can appeal for free")
    expect(screen.queryByRole("region", { name: "Questions" })).toBeNull()
  })

  it("routes the report button to the existing diy checkout", () => {
    const main = renderMain(true)
    fireEvent.click(within(main).getByRole("button", { name: "Get My Records Report" }))
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith("/checkout?plan=diy")
  })

  it("disables the report button in preview mode without routing", () => {
    mockPreviewMode = true
    const main = renderMain(true)
    const button = within(main).getByRole("button", { name: "Preview checkout disabled" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(mockPush).not.toHaveBeenCalled()
  })
})
