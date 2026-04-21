import { freeCheckFollowupTemplate, shouldSendFreeCheckFollowup } from "@/lib/email/templates"

// ── shouldSendFreeCheckFollowup ───────────────────────────────────────────────

describe("shouldSendFreeCheckFollowup", () => {
  it("returns true when savings >= 100 and followupStep is 0", () => {
    expect(shouldSendFreeCheckFollowup(1200, 0)).toBe(true)
  })

  it("returns true at exactly the 100 threshold", () => {
    expect(shouldSendFreeCheckFollowup(100, 0)).toBe(true)
  })

  it("returns false when savings below threshold", () => {
    expect(shouldSendFreeCheckFollowup(99, 0)).toBe(false)
    expect(shouldSendFreeCheckFollowup(0, 0)).toBe(false)
  })

  it("returns false when followupStep > 0 (already sent)", () => {
    expect(shouldSendFreeCheckFollowup(1200, 1)).toBe(false)
    expect(shouldSendFreeCheckFollowup(1200, 2)).toBe(false)
  })

  it("returns false when savings is null", () => {
    expect(shouldSendFreeCheckFollowup(null, 0)).toBe(false)
    expect(shouldSendFreeCheckFollowup(undefined, 0)).toBe(false)
  })

  it("returns false when both savings below threshold AND already sent", () => {
    expect(shouldSendFreeCheckFollowup(50, 1)).toBe(false)
  })
})

// ── freeCheckFollowupTemplate ─────────────────────────────────────────────────

describe("freeCheckFollowupTemplate", () => {
  const baseArgs = { address: "123 Main St, Evanston", potentialSavings: 1200 }

  it("includes the savings amount in the subject", () => {
    const { subject } = freeCheckFollowupTemplate(baseArgs)
    expect(subject).toMatch(/\$1,200/)
    expect(subject).toMatch(/year/)
  })

  it("includes the address in the subject or body", () => {
    const { text } = freeCheckFollowupTemplate(baseArgs)
    expect(text).toMatch(/123 Main St, Evanston/)
  })

  it("CTA points to /auth/signup", () => {
    const { html, text } = freeCheckFollowupTemplate(baseArgs)
    expect(html).toMatch(/overtaxed-il\.com\/auth\/signup/)
    expect(text).toMatch(/overtaxed-il\.com\/auth\/signup/)
  })

  it("includes 3-year savings in the body", () => {
    const { html, text } = freeCheckFollowupTemplate({ address: "456 Oak Ave", potentialSavings: 1200 })
    expect(html).toMatch(/\$3,600/)
    expect(text).toMatch(/\$3,600/)
  })

  it("has only one CTA link in html", () => {
    const { html } = freeCheckFollowupTemplate(baseArgs)
    const ctaLinks = (html.match(/auth\/signup/g) ?? []).length
    expect(ctaLinks).toBe(1)
  })

  it("does not contain fake discount language", () => {
    const { html, text } = freeCheckFollowupTemplate(baseArgs)
    expect(html + text).not.toMatch(/\d+%\s*off/i)
    expect(html + text).not.toMatch(/coupon|promo code|discount/i)
  })

  it("returns subject, html, and text", () => {
    const result = freeCheckFollowupTemplate(baseArgs)
    expect(typeof result.subject).toBe("string")
    expect(typeof result.html).toBe("string")
    expect(typeof result.text).toBe("string")
    expect(result.subject.length).toBeGreaterThan(10)
    expect(result.html.length).toBeGreaterThan(100)
    expect(result.text.length).toBeGreaterThan(100)
  })

  it("formats high savings amounts correctly", () => {
    const { subject } = freeCheckFollowupTemplate({ address: "789 Elm", potentialSavings: 2500 })
    expect(subject).toMatch(/\$2,500/)
  })
})
