/**
 * @jest-environment node
 *
 * The assessment-increase notice reports a change in a published record. It
 * used to close with "You may be able to appeal", which implied current
 * eligibility with no window, deadline or source behind it. The replacement
 * must state the recorded change factually, say plainly what the notice does
 * not determine, and keep the link to the recorded property — with no appeal
 * invitation, deadline, or purchase call to action.
 */
import { assessmentIncreaseTemplate } from "@/lib/email/templates"

const base = {
  userEmail: "synthetic-owner@example.test",
  userName: "Pat",
  propertyAddress: "123 Synthetic St",
  pin: "14-20-100-001-0000",
  taxYear: 2026,
  previousValue: 30000,
  newValue: 36000,
  propertyLink: "https://example.test/properties/prop_synthetic_1",
}

describe("assessmentIncreaseTemplate", () => {
  const t = assessmentIncreaseTemplate(base)

  it("drops the appeal invitation from every part of the message", () => {
    for (const body of [t.subject, t.text, t.html]) {
      expect(body).not.toMatch(/may be able to appeal/i)
      expect(body).not.toMatch(/\bappeal/i)
    }
  })

  it("carries no deadline, countdown or purchase call to action", () => {
    for (const body of [t.subject, t.text, t.html]) {
      expect(body).not.toMatch(/deadline|days left|days remaining|file by/i)
      expect(body).not.toMatch(/checkout|pricing|purchase|buy now|\border now\b/i)
    }
  })

  it("states the recorded change factually", () => {
    expect(t.subject).toBe("Recorded assessment change for 123 Synthetic St (2026)")
    expect(t.text).toContain("Property: 123 Synthetic St (PIN 14-20-100-001-0000)")
    expect(t.text).toContain("Tax year: 2026")
    expect(t.text).toContain("Previously recorded: $30,000 → Newly recorded: $36,000 (20.0% increase)")
    expect(t.text).toMatch(/published Cook County assessment data/)
    expect(t.text).toMatch(/does not determine whether any review or filing option is open or available/)
    expect(t.html).toMatch(/does not determine whether any review or filing option is open or available/)
  })

  it("keeps the link to the recorded property", () => {
    expect(t.text).toContain(base.propertyLink)
    expect(t.html).toContain(`href="${base.propertyLink}"`)
  })

  it("escapes interpolated owner and address text in the HTML body", () => {
    const h = assessmentIncreaseTemplate({
      ...base,
      userName: "<b>Pat</b>",
      propertyAddress: `1 "Main" & <Oak>`,
    }).html
    expect(h).not.toContain("<b>Pat</b>")
    expect(h).not.toContain("<Oak>")
    expect(h).toContain("&lt;b&gt;Pat&lt;/b&gt;")
    expect(h).toContain("1 &quot;Main&quot; &amp; &lt;Oak&gt;")
  })
})
