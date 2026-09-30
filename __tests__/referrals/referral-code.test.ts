/** @jest-environment node */

/**
 * The one referral-code boundary every ingress shares.
 *
 * Admin-issued codes are lowercase (the admin route has always lowercased, and
 * the only seeded code is `john`). Anything a visitor, cookie, or Stripe
 * metadata field carries is untrusted, so the normalizer accepts only a short
 * ASCII slug and returns its single canonical lowercase form — or null.
 */
import { REFERRAL_CODE_MAX_LENGTH, normalizeReferralCode } from "@/lib/referrals/code"

describe("normalizeReferralCode", () => {
  it.each([
    ["john", "john"],
    ["jane-doe", "jane-doe"],
    ["partner2026", "partner2026"],
    ["ab", "ab"],
    ["JOHN", "john"],
    ["John", "john"],
    ["a".repeat(REFERRAL_CODE_MAX_LENGTH), "a".repeat(REFERRAL_CODE_MAX_LENGTH)],
  ])("accepts %j as %j", (input, canonical) => {
    expect(normalizeReferralCode(input)).toBe(canonical)
  })

  it.each([
    ["empty", ""],
    ["one character", "a"],
    ["oversized", "a".repeat(REFERRAL_CODE_MAX_LENGTH + 1)],
    ["very oversized", "a".repeat(10_000)],
    ["leading whitespace", " john"],
    ["trailing whitespace", "john "],
    ["inner space (a name)", "john smith"],
    ["tab", "john\tsmith"],
    ["newline", "john\n"],
    ["NUL control", "john\u0000"],
    ["DEL control", "john\u007f"],
    ["an email", "owner@example.com"],
    ["a URL", "https://evil.example/x"],
    ["a host", "evil.example"],
    ["a path", "../admin"],
    ["percent-encoding", "john%20smith"],
    ["a query fragment", "john&utm_source=x"],
    ["cookie injection", "john; Path=/; Domain=evil"],
    ["underscore", "jane_doe"],
    ["leading hyphen", "-john"],
    ["trailing hyphen", "john-"],
    ["double hyphen", "jo--hn"],
    ["Cyrillic confusable", "jоhn"], // U+043E
    ["fullwidth confusable", "ｊｏｈｎ"],
    ["dotted capital I (locale case folding)", "İnfo"],
    ["Kelvin sign (folds to k)", "Ken"],
    ["zero-width joiner", "jo‍hn"],
    ["soft hyphen", "jo­hn"],
    ["combining mark", "jóhn"],
  ])("rejects %s", (_label, input) => {
    expect(normalizeReferralCode(input)).toBeNull()
  })

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an array", ["john"]],
    ["an object", { code: "john" }],
    ["a boxed string", new String("john")],
  ])("rejects a non-string (%s)", (_label, input) => {
    expect(normalizeReferralCode(input)).toBeNull()
  })

  it("is idempotent on its own output", () => {
    const once = normalizeReferralCode("Jane-Doe")
    expect(once).toBe("jane-doe")
    expect(normalizeReferralCode(once)).toBe(once)
  })
})
