/**
 * Canonical consumer copy — one string, one ID, one meaning, every surface.
 *
 * Frozen source: `04-CANONICAL-COPY-AND-BANNED-CLAIMS.md`
 * (sha256 a7577e68...c499). The copy review that produced that document found a
 * single contingency term rendered four different ways across four surfaces.
 * This module exists so that cannot recur: surfaces import an ID, they do not
 * retype the sentence and they do not reassemble it out of JSX fragments.
 *
 * Strings that carry runtime facts (`CC-08`, `CC-16`) are exposed as builders
 * rather than templates with holes, so a caller cannot render the sentence
 * while leaving `{source}` or `{timestamp}` unresolved.
 *
 * British spellings ("practise", "neighbourhood") and the em dash in `CC-11`
 * are reproduced deliberately — these strings are compared byte-for-byte
 * against the frozen source, so a "correction" here is a test failure.
 */

export const CC_01 =
  "OverTaxed IL analyzes public Cook County records and prepares a defined Assessor-stage appeal packet. You review it, sign it, and file it yourself."

/** MANDATED VERBATIM. Do not edit, wrap, truncate, or split across elements. */
export const CC_02 =
  "This free check compares available public Cook County records. It estimates whether the evidence appears to support closer review. It does not predict whether an appeal will succeed or reduce taxes."

export const CC_03 = "Appears supportive of closer review"
export const CC_04 = "Does not presently appear supportive"
export const CC_05 = "Insufficient evidence"
export const CC_06 = "Unsupported property/stage"

export const CC_07 =
  "Public records may be incomplete, out of date, or inconsistent. This analysis uses only what was retrievable at the time shown, and cannot account for condition, interior finish, or other facts the public record does not carry."

export const CC_09 =
  "Your township is resolved from your address and PIN in the county's own records, not from your neighbourhood name. Chicago neighbourhoods can span more than one assessment township, and townships have different deadlines."

export const CC_10 =
  "The $69 packet is a preparation service. We prepare it; you review it, sign it, and file it with the county yourself."

export const CC_11 =
  "OverTaxed IL does not file, sign, prepare, handle, or represent anyone at the Cook County Board of Review. Under the Board's own rules, only a licensed attorney or the taxpayer personally may practise before it. If we ever offer anything at that stage, it would be attorney-led. Do not wait for us — confirm your own deadline with the county."

export const CC_12 =
  "OverTaxed IL is not a law firm and does not provide legal or tax advice. We do not guarantee a reduction. County decisions are final, and a change in assessed value does not produce an equal change in a tax bill."

export const CC_13 =
  "We refund in full if we do not deliver, or if the packet has a material defect we cannot correct. We do not charge at all if we cannot produce what we promised. No county outcome — granted, denied, or partial — creates a refund right."

export const CC_14 =
  "Support covers how the packet works, where each figure came from, and corrections. It does not cover advice on whether to file or on the merits of your property. Up to two email exchanges within 14 days of delivery."

export const CC_15 =
  "We can't advise you on that. Whether to appeal is your decision, and we're not able to weigh in on the merits of a specific property. The county publishes the records and the filing route free, and both are linked here."

export const CC_17 =
  "We only sell a packet when the Assessor window is open for your resolved township, your property is class 2 residential in Cook County with a single PIN, and our sources were complete and current at the time of the check. If any of those is not true, checkout is closed and you are not charged."

/**
 * CC-08 — freshness line. Required by BL-F4 wherever any date appears.
 *
 * There is no default source or timestamp. A surface that cannot name both has
 * no provenance, and a deadline without provenance must be suppressed rather
 * than rendered with a placeholder.
 */
export function cc08(args: { source: string; timestamp: string }): string {
  return `Deadline shown as published by ${args.source} and retrieved ${args.timestamp}. Confirm your filing deadline with the county before you file.`
}

/** CC-16 — closed/unavailable deadline. */
export function cc16(args: {
  stage: string
  township: string
  source: string
  timestamp: string
}): string {
  return `The ${args.stage} window for ${args.township} is not open according to ${args.source}, retrieved ${args.timestamp}. We are not selling a packet for a closed window. Confirm the current status with the county — your rights are not affected by anything on this page.`
}

/**
 * CC-18 — standing footer: CC-01 + CC-12, on every consumer surface without
 * exception. Exposed as the joined pair so a surface cannot render half of it.
 */
export const CC_18 = `${CC_01} ${CC_12}`

/** The four free-check result states, in the order the contract defines them. */
export const FREE_CHECK_STATES = {
  A: CC_03,
  B: CC_04,
  C: CC_05,
  D: CC_06,
} as const

export type FreeCheckStateKey = keyof typeof FREE_CHECK_STATES
