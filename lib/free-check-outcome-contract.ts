import { CC_03, CC_04, CC_05, CC_06 } from "@/lib/copy/canonical"

export type FreeCheckOutcomeCode =
  | "supportive"
  | "not_supportive"
  | "insufficient_evidence"
  | "unsupported_property"

export type FreeCheckOutcomeReason =
  | "property_class_unsupported"
  | "multiple_pins"
  | "outside_cook_county"
  | "no_assessed_value"
  | "no_comparables"
  | "no_comparable_level"
  | "window_unverified"
  | "window_not_open"
  | "eligibility_policy_unsigned"
  | "below_min_comparable_count"
  | "below_evidence_threshold"

export interface FreeCheckOutcome {
  code: FreeCheckOutcomeCode
  headline: string
  allowCheckout: boolean
  reason: FreeCheckOutcomeReason | null
  showFigures: boolean
  showRecordComparison: boolean
}

export const FREE_CHECK_OUTCOME_MATRIX: readonly FreeCheckOutcome[] = [
  {
    code: "supportive",
    headline: CC_03,
    allowCheckout: true,
    reason: null,
    showFigures: true,
    showRecordComparison: true,
  },
  {
    code: "supportive",
    headline: CC_03,
    allowCheckout: false,
    reason: "window_not_open",
    showFigures: true,
    showRecordComparison: true,
  },
  {
    code: "supportive",
    headline: CC_03,
    allowCheckout: false,
    reason: "window_unverified",
    showFigures: true,
    showRecordComparison: true,
  },
  {
    code: "not_supportive",
    headline: CC_04,
    allowCheckout: false,
    reason: "below_evidence_threshold",
    showFigures: true,
    showRecordComparison: true,
  },
  {
    code: "insufficient_evidence",
    headline: CC_05,
    allowCheckout: false,
    reason: "no_assessed_value",
    showFigures: false,
    showRecordComparison: false,
  },
  {
    code: "insufficient_evidence",
    headline: CC_05,
    allowCheckout: false,
    reason: "no_comparables",
    showFigures: false,
    showRecordComparison: false,
  },
  {
    code: "insufficient_evidence",
    headline: CC_05,
    allowCheckout: false,
    reason: "no_comparable_level",
    showFigures: false,
    showRecordComparison: true,
  },
  {
    code: "insufficient_evidence",
    headline: CC_05,
    allowCheckout: false,
    reason: "eligibility_policy_unsigned",
    showFigures: true,
    showRecordComparison: true,
  },
  {
    code: "insufficient_evidence",
    headline: CC_05,
    allowCheckout: false,
    reason: "below_min_comparable_count",
    showFigures: true,
    showRecordComparison: true,
  },
  {
    code: "unsupported_property",
    headline: CC_06,
    allowCheckout: false,
    reason: "outside_cook_county",
    showFigures: false,
    showRecordComparison: false,
  },
  {
    code: "unsupported_property",
    headline: CC_06,
    allowCheckout: false,
    reason: "multiple_pins",
    showFigures: false,
    showRecordComparison: false,
  },
  {
    code: "unsupported_property",
    headline: CC_06,
    allowCheckout: false,
    reason: "property_class_unsupported",
    showFigures: false,
    showRecordComparison: false,
  },
] as const

function matrixKey(code: string, reason: string | null): string {
  return `${code}:${reason ?? "__null__"}`
}

const OUTCOME_MATRIX_BY_KEY = new Map(
  FREE_CHECK_OUTCOME_MATRIX.map((outcome) => [matrixKey(outcome.code, outcome.reason), outcome] as const),
)

export function canonicalFreeCheckOutcome(
  code: FreeCheckOutcomeCode,
  reason: FreeCheckOutcomeReason | null,
): FreeCheckOutcome {
  const outcome = OUTCOME_MATRIX_BY_KEY.get(matrixKey(code, reason))
  if (!outcome) {
    throw new Error(`Unknown free-check outcome tuple: ${code}:${reason ?? "null"}`)
  }
  return outcome
}

export function isCanonicalFreeCheckOutcome(value: unknown): value is FreeCheckOutcome {
  if (!value || typeof value !== "object") return false
  const outcome = value as Record<string, unknown>
  if (
    typeof outcome.code !== "string" ||
    typeof outcome.headline !== "string" ||
    typeof outcome.allowCheckout !== "boolean" ||
    typeof outcome.showFigures !== "boolean" ||
    typeof outcome.showRecordComparison !== "boolean" ||
    !("reason" in outcome) ||
    (outcome.reason !== null && typeof outcome.reason !== "string")
  ) {
    return false
  }

  const expected = OUTCOME_MATRIX_BY_KEY.get(
    matrixKey(outcome.code, outcome.reason as string | null),
  )
  if (!expected) return false

  return (
    outcome.headline === expected.headline &&
    outcome.allowCheckout === expected.allowCheckout &&
    outcome.showFigures === expected.showFigures &&
    outcome.showRecordComparison === expected.showRecordComparison
  )
}
