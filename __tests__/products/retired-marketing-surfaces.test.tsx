/** @jest-environment jsdom */

/**
 * Withdrawn *marketing* surfaces.
 *
 * The HTTP routes for held products fail closed in
 * `retired-surfaces.test.ts`. This file covers the pages a homeowner actually
 * reads, which is where the offer is really made: a 410 on
 * `/api/contingency-intake` is worth nothing if `/appeal-contingency` still
 * says "22% of first-year tax savings" above a working contact link.
 *
 * The pages are not deleted. Their URLs are in search results and in previous
 * emails, so they keep resolving — they just no longer offer anything.
 */
import React from "react"
import { render, screen } from "@testing-library/react"

import ContingencyPage from "@/app/appeal-contingency/page"
import ContingencySuccessPage from "@/app/appeal-contingency/success/page"
import { CC_11 } from "@/lib/copy/canonical"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

/** Every claim that made the contingency arrangement an offer. */
const OFFER_CLAIMS = [
  /22%/,
  /contingency (fee|pricing|authorization|arrangement)/i,
  /first-year (tax )?savings/i,
  /only if the county grants/i,
  /done-for-you/i,
  /\$97/,
]

describe("/appeal-contingency", () => {
  it("makes no contingency offer", () => {
    render(<ContingencyPage />)
    const text = document.body.textContent ?? ""

    for (const claim of OFFER_CLAIMS) {
      expect(text).not.toMatch(claim)
    }
  })

  it("says the product is withdrawn rather than leaving the page blank", () => {
    render(<ContingencyPage />)

    // A page that merely stops mentioning the product reads as an error. A
    // homeowner who followed a link from an old email needs to be told what
    // happened and where to go instead.
    expect(screen.getByText(/no longer offer/i)).toBeTruthy()
  })

  it("carries CC-11, because a contingency appeal is a Board of Review posture", () => {
    render(<ContingencyPage />)
    expect(document.body.textContent).toContain(CC_11)
  })

  it("offers no route back into a held intake", () => {
    render(<ContingencyPage />)

    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "")
    for (const href of hrefs) {
      expect(href).not.toMatch(/contingency-intake/)
      expect(href).not.toMatch(/plan=(contingency|dfy|done-for-you)/)
    }
  })
})

describe("/appeal-contingency/success", () => {
  it("confirms nothing, because no intake can be submitted", () => {
    render(<ContingencySuccessPage />)
    const text = document.body.textContent ?? ""

    // This page previously told a homeowner their contingency request was
    // received and that we would review it. With intake withdrawn, nothing
    // reaches it except a stale bookmark, and confirming a submission that
    // cannot have happened is worse than the offer itself.
    expect(text).not.toMatch(/we('ve| have) received/i)
    expect(text).not.toMatch(/we'll (review|be in touch)/i)
    expect(text).not.toMatch(/22%/)
    expect(text).toMatch(/no longer offer/i)
  })
})
