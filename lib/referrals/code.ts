/**
 * The one referral-code boundary.
 *
 * A referral code reaches the server from a `?ref=` query, the `ot_ref` cookie,
 * the visit beacon, the `/partner/[code]` path and Stripe checkout metadata —
 * all of them visitor-controlled. Admin-issued codes have always been stored
 * lowercase (the admin route lowercases, and the one seeded code is `john`), so
 * the canonical form is a short lowercase ASCII slug: letters and digits, with
 * single hyphens between them.
 *
 * The character check runs on the raw value BEFORE case folding, so folding is
 * ASCII-only and locale-independent: `İ`, the Kelvin sign and fullwidth or
 * Cyrillic look-alikes are rejected, never folded into an ASCII code. Nothing
 * is trimmed or stripped — whitespace, controls, and anything shaped like an
 * email, name or URL are rejected rather than repaired.
 */

export const REFERRAL_CODE_MIN_LENGTH = 2
export const REFERRAL_CODE_MAX_LENGTH = 32

const ASCII_SLUG = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/

/** The canonical lowercase code, or null for anything that is not one. */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== "string") return null
  if (input.length < REFERRAL_CODE_MIN_LENGTH || input.length > REFERRAL_CODE_MAX_LENGTH) return null
  if (!ASCII_SLUG.test(input)) return null
  return input.toLowerCase()
}
