import "server-only"

import { createHash } from "node:crypto"
import { isUtf8 } from "node:buffer"

import { evaluateCheckoutBusinessDayCutoff } from "@/lib/checkout/business-days"
import { ASSESSOR_PARSER_VERSION, parseInformationalAssessorHtml } from "@/lib/deadlines/assessor-calendar-parser"
import { evaluateOfficialDeadlineState, type OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state"
import { townshipKeyFromName, type TownshipResolution } from "@/lib/deadlines/township-resolution"
import type { NeutralDeadlineAuthoritySnapshot } from "@/lib/fulfillment/neutral-report-content"

export const NEUTRAL_CALENDAR_URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"

export type NeutralDeadlineRawEvidence = Readonly<{
  deadline: NeutralDeadlineAuthoritySnapshot
  sourceBytes: Buffer
  sourceBytesSha256: string
  deadlineEvidenceSha256: string
}>

/**
 * Parse a captured official calendar body. Runtime is default-off because no
 * ambient fetch or caller-shaped deadline can enter this boundary.
 */
function parseNeutralOfficialCalendar(input: {
  sourceBytes: Buffer
  retrievedAt: string
  evaluatedAt: string
  subjectPin: string
  subjectTownship: string
}): { ok: true; evidence: NeutralDeadlineRawEvidence } | { ok: false; blocker: "NEUTRAL_DEADLINE_UNAVAILABLE" } {
  try {
    if (!/^\d{14}$/.test(input.subjectPin) || input.sourceBytes.length === 0 || input.sourceBytes.length > 2_000_000) throw new Error()
    const retrieved = new Date(input.retrievedAt), evaluated = new Date(input.evaluatedAt)
    if (!Number.isFinite(retrieved.getTime()) || !Number.isFinite(evaluated.getTime()) || retrieved > evaluated) throw new Error()
    if (!isUtf8(input.sourceBytes)) throw new Error()
    const hash = createHash("sha256").update(input.sourceBytes).digest("hex")
    const rows = parseInformationalAssessorHtml(input.sourceBytes.toString("utf8"), 2026)
    const key = townshipKeyFromName(input.subjectTownship)
    const resolution: TownshipResolution = { inputKind: "pin", normalizedPin: input.subjectPin, normalizedAddress: null, townshipKey: key, townshipName: input.subjectTownship, resolutionSource: "official_property_record", resolvedAt: input.evaluatedAt }
    const snapshot: OfficialDeadlineSnapshot = { schemaVersion: 1, synthetic: false, sources: { assessor: { authority: "cook_county_assessor", sourceUrl: NEUTRAL_CALENDAR_URL, retrievedAt: input.retrievedAt, sourceUpdatedAt: null, contentSha256: hash, httpStatus: 200, finalUrl: NEUTRAL_CALENDAR_URL, parseStatus: "ok", parserVersion: ASSESSOR_PARSER_VERSION } }, townships: rows }
    const state = evaluateOfficialDeadlineState({ snapshot, township: resolution, stage: "assessor", evaluatedAt: input.evaluatedAt })
    if (state.kind !== "verified" || !state.eligible || state.status !== "open") throw new Error()
    const cutoff = evaluateCheckoutBusinessDayCutoff({ closeDate: state.lastFileDate, now: evaluated })
    if (!cutoff.allowed) throw new Error()
    const deadline: NeutralDeadlineAuthoritySnapshot = Object.freeze({ trusted: true, status: "open", closeDate: state.lastFileDate, sourceName: "Cook County Assessor", sourceUrl: NEUTRAL_CALENDAR_URL, retrievedAt: input.retrievedAt, businessDaysRemainingAtGeneration: cutoff.businessDaysRemaining, businessDayCutoffAllowed: true, townshipName: input.subjectTownship, townshipKey: key, taxYear: 2026, authorityId: "ccao-assessment-calendar", snapshotSha256: hash })
    const deadlineEvidenceSha256 = createHash("sha256").update(JSON.stringify({ deadline, sourceBytesSha256: hash })).digest("hex")
    return { ok: true, evidence: Object.freeze({ deadline, sourceBytes: Buffer.from(input.sourceBytes), sourceBytesSha256: hash, deadlineEvidenceSha256 }) }
  } catch { return { ok: false, blocker: "NEUTRAL_DEADLINE_UNAVAILABLE" } }
}

async function boundedCalendarBytes(response: Response, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) throw new Error("missing body")
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let total = 0
  const abort = new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
  try {
    for (;;) {
      if (signal.aborted) throw new Error("aborted")
      const next = await Promise.race([reader.read(), abort]); if (next.done) break; if (!next.value) continue
      total += next.value.length; if (total > 2_000_000) throw new Error("too large")
      chunks.push(Buffer.from(next.value))
    }
    return Buffer.concat(chunks)
  } catch (error) { await reader.cancel("calendar refused").catch(() => {}); throw error }
}

/** Production calendar transport: exact URL, global fetch/clock, bounded bytes. */
export async function loadNeutralOfficialCalendarRuntime(input: { subjectPin: string; subjectTownship: string }): Promise<{ ok: true; evidence: NeutralDeadlineRawEvidence; evaluatedAt: string } | { ok: false; blocker: "NEUTRAL_DEADLINE_UNAVAILABLE" }> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await globalThis.fetch(NEUTRAL_CALENDAR_URL, { method: "GET", headers: { Accept: "text/html" }, cache: "no-store", redirect: "error", credentials: "omit", signal: controller.signal })
    if (!response.ok || response.status !== 200 || response.redirected || response.url !== NEUTRAL_CALENDAR_URL || !/^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error()
    const bytes = await boundedCalendarBytes(response, controller.signal)
    const completedAt = new Date(); if (!Number.isFinite(completedAt.getTime())) throw new Error()
    const retrievedAt = completedAt.toISOString(); const evaluatedAt = retrievedAt
    const parsed = parseNeutralOfficialCalendar({ sourceBytes: bytes, retrievedAt, evaluatedAt, subjectPin: input.subjectPin, subjectTownship: input.subjectTownship })
    return parsed.ok ? { ...parsed, evaluatedAt } : parsed
  } catch { return { ok: false, blocker: "NEUTRAL_DEADLINE_UNAVAILABLE" } } finally { clearTimeout(timer) }
}

export function verifyAndCopyNeutralDeadlineEvidence(evidence: NeutralDeadlineRawEvidence): Buffer | null {
  const hash = createHash("sha256").update(evidence.sourceBytes).digest("hex")
  const digest = createHash("sha256").update(JSON.stringify({ deadline: evidence.deadline, sourceBytesSha256: hash })).digest("hex")
  return hash === evidence.sourceBytesSha256 && digest === evidence.deadlineEvidenceSha256 && evidence.deadline.snapshotSha256 === hash ? Buffer.from(evidence.sourceBytes) : null
}
