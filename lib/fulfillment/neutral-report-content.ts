import "server-only"

import { createHash } from "node:crypto"

import {
  CANDIDATE_POOL_HASH_DOMAIN,
  NON_DIRECTIONAL_RULE_ID,
  SQFT_TOLERANCE,
  YEAR_BUILT_TOLERANCE,
  attachAssessedValues,
  candidatePoolSha256,
  rejectionCountsByReason,
  selectNonDirectionalComparables,
  type ComparableMatchAttributes,
  type ComparableRejectionReason,
} from "@/lib/fulfillment/t2-comparables"
import type { DeadlineAuthoritySnapshot, SourceRecord, SubjectRecord } from "@/lib/fulfillment/t2-artifact-content"
import type { NeutralReportCommercePolicy } from "@/lib/commerce/neutral-report-policy"
import { resolveNeutralReportCommercePolicy } from "@/lib/commerce/neutral-report-policy"
import { townshipKeyFromName } from "@/lib/deadlines/township-resolution"
import { canonicalNeutralSourceOrder } from "@/lib/fulfillment-runtime/neutral-evidence-envelope"
import { renderDeterministicTextPdf } from "@/lib/fulfillment/neutral-report-pdf"
import { loadNeutralOfficialCalendarRuntime, verifyAndCopyNeutralDeadlineEvidence } from "@/lib/fulfillment-runtime/neutral-deadline-gateway"
import { readNeutralOfficialBytesRuntime, verifyAndCopyNeutralEvidence } from "@/lib/fulfillment-runtime/neutral-raw-gateway"
import { NEUTRAL_REPORT_COMMERCE_POLICY, neutralOrderReservationKey } from "@/lib/commerce/neutral-report-policy"

export const NEUTRAL_REPORT_PRODUCER_VERSION = "ot-neutral-records-report/1.0.0"
export const NEUTRAL_REPORT_TEMPLATE_VERSION = "ot-neutral-records-report-pdf-csv/1.0.0"

export type PublishedProration = {
  pinNumCards: string | null
  tiebackKeyPin: string | null
  tiebackProrationRate: string | null
  cardProrationRate: string | null
  sourceDatasetId: string
  sourceRetrievedAt: string
  sourceContentSha256: string
  ambiguitySemantics: "PUBLISHED_ZERO_OR_NULL_NOT_INTERPRETED"
}

export type NeutralReportInputs = {
  orderId: string
  orderPropertyPin: string
  subject: SubjectRecord
  subjectProration: PublishedProration
  candidatePool: ReadonlyArray<ComparableMatchAttributes>
  assessedValues: ReadonlyMap<string, number>
  addresses: ReadonlyMap<string, string>
  deadline: NeutralDeadlineAuthoritySnapshot
  sources: ReadonlyArray<NeutralSourceReceipt>
  generatedAt: string
  dataEvidenceSha256: string
  deadlineEvidenceSha256: string
  dataEvidenceVersion: "ot-neutral-data-evidence/v1"
  deadlineEvidenceVersion: "ot-neutral-deadline-evidence/v1"
}

export type NeutralDeadlineAuthoritySnapshot = DeadlineAuthoritySnapshot & {
  townshipName: string
  townshipKey: string
  taxYear: 2026
  authorityId: "ccao-assessment-calendar"
  snapshotSha256: string
}

export const NEUTRAL_SOURCE_ROLES = ["subject", "candidates", "assessed_values", "addresses", "proration"] as const
export type NeutralSourceRole = typeof NEUTRAL_SOURCE_ROLES[number]
export type NeutralSourceReceipt = SourceRecord & {
  roles: ReadonlyArray<NeutralSourceRole>
  subjectPin: string
  taxYear: 2026
}

export type NeutralReportRefusal =
  | "NEUTRAL_REPORT_POLICY_INVALID"
  | "UNTRUSTED_DEADLINE_AUTHORITY"
  | "FILING_WINDOW_NOT_OPEN"
  | "INSUFFICIENT_BUSINESS_DAYS"
  | "ORDER_PROPERTY_MISMATCH"
  | "UNSUPPORTED_PROPERTY"
  | "INCOMPLETE_SOURCE_MANIFEST"
  | "INCOMPLETE_MATCHING_PROPERTY_RECORD"

export type NeutralReportManifest = {
  producerVersion: string
  templateVersion: string
  commercePolicyVersion: string
  strictQualificationAuthorized: false
  generatedAt: string
  orderId: string
  subjectPin: string
  selectionRuleId: string
  selectionIsDirectional: false
  candidateCount: number
  matchingPropertyCount: number
  rejectedByReason: Record<ComparableRejectionReason, number>
  candidatePoolSha256: string
  candidatePoolHashDomain: string
  subjectProration: PublishedProration
  sources: NeutralSourceReceipt[]
  dataEvidenceSha256: string
  deadlineEvidenceSha256: string
  dataEvidenceVersion: "ot-neutral-data-evidence/v1"
  deadlineEvidenceVersion: "ot-neutral-deadline-evidence/v1"
}

export type NeutralReportContentResult =
  | { ok: true; text: string; csv: string; manifest: NeutralReportManifest }
  | { ok: false; blocker: NeutralReportRefusal }

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const SHA256 = /^[0-9a-f]{64}$/

function safeText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)
}
function officialDeadlineUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "www.cookcountyassessoril.gov" && url.username === "" && url.password === ""
  } catch { return false }
}
function officialDatasetUrl(value: string, datasetId: string): boolean {
  try {
    const url = new URL(value)
    const keys = [...url.searchParams.keys()]
    const sorted = [...keys].sort()
    return url.protocol === "https:" && url.hostname === "datacatalog.cookcountyil.gov" &&
      url.pathname === `/resource/${datasetId}.json` && url.username === "" && url.password === "" && url.hash === "" &&
      keys.length > 0 && keys.join("\0") === sorted.join("\0") && new Set(keys).size === keys.length
  } catch { return false }
}
function clean(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim()
}
function csvCell(value: unknown): string {
  let text = String(value ?? "")
  if (/^[=+\-@\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
function csvPin(value: string): string { return csvCell(`'${value}`) }
function fixed(value: number, places = 2): string { return value.toFixed(places) }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
  return JSON.stringify(value)
}

/** Non-authoritative formatter/validator. It cannot create a fulfillable artifact. */
function formatNeutralReportContent(input: NeutralReportInputs): NeutralReportContentResult {
  const { subject, deadline } = input
  const policy: NeutralReportCommercePolicy = resolveNeutralReportCommercePolicy()
  if (policy.strictQualificationAuthorized !== false) return { ok: false, blocker: "NEUTRAL_REPORT_POLICY_INVALID" }
  const generatedMs = Date.parse(input.generatedAt)
  const deadlineRetrievedMs = Date.parse(deadline.retrievedAt ?? "")
  const closeMs = Date.parse(`${deadline.closeDate ?? ""}T23:59:59-05:00`)
  const subjectTownshipKey = townshipKeyFromName(subject.township)
  if (!SHA256.test(input.dataEvidenceSha256) || !SHA256.test(input.deadlineEvidenceSha256) || input.dataEvidenceVersion !== "ot-neutral-data-evidence/v1" || input.deadlineEvidenceVersion !== "ot-neutral-deadline-evidence/v1")
    return { ok: false, blocker: "INCOMPLETE_SOURCE_MANIFEST" }
  if (!RFC3339.test(input.generatedAt) || new Date(generatedMs).getUTCFullYear() !== 2026)
    return { ok: false, blocker: "INCOMPLETE_SOURCE_MANIFEST" }
  if (!deadline.trusted || deadline.authorityId !== "ccao-assessment-calendar" || deadline.taxYear !== 2026 ||
      !deadline.sourceUrl || !officialDeadlineUrl(deadline.sourceUrl) ||
      deadline.townshipKey !== subjectTownshipKey || deadline.townshipKey !== townshipKeyFromName(deadline.townshipName) ||
      !Number.isFinite(deadlineRetrievedMs) || !Number.isFinite(generatedMs) || deadlineRetrievedMs > generatedMs || generatedMs - deadlineRetrievedMs > 86_400_000)
    return { ok: false, blocker: "UNTRUSTED_DEADLINE_AUTHORITY" }
  if (deadline.status !== "open") return { ok: false, blocker: "FILING_WINDOW_NOT_OPEN" }
  if (deadline.businessDaysRemainingAtGeneration == null || deadline.businessDaysRemainingAtGeneration < 3 || deadline.businessDayCutoffAllowed !== true || !Number.isFinite(closeMs) || closeMs < generatedMs)
    return { ok: false, blocker: "INSUFFICIENT_BUSINESS_DAYS" }
  const subjectPin = subject.pin
  if (!/^\d{14}$/.test(subjectPin) || input.orderPropertyPin !== subjectPin) return { ok: false, blocker: "ORDER_PROPERTY_MISMATCH" }
  if (!/^\d{14}$/.test(subjectPin) || !subject.inCookCounty || subject.pinCount !== 1 || subject.taxYear !== 2026 || subject.assessmentStage !== "mailed" || !/^2\d{2}$/.test(subject.propertyClass) || subject.propertyClass === "299")
    return { ok: false, blocker: "UNSUPPORTED_PROPERTY" }
  if (!subject.address.trim() || !subject.residentialSubtype.trim() || subject.buildingSqft <= 0 || subject.yearBuilt <= 1700 || subject.assessedTotalValue <= 0)
    return { ok: false, blocker: "UNSUPPORTED_PROPERTY" }
  if (!safeText(subject.address, 256) || !safeText(subject.city, 128) || !safeText(subject.township, 128) ||
      !safeText(subject.neighborhoodCode, 32) || !safeText(subject.propertyClass, 16) || !safeText(subject.residentialSubtype, 128) ||
      !Number.isFinite(subject.buildingSqft) || subject.buildingSqft > 1_000_000 || !Number.isSafeInteger(subject.yearBuilt) || subject.yearBuilt > 2026 ||
      !Number.isFinite(subject.assessedTotalValue) || subject.assessedTotalValue > 1_000_000_000)
    return { ok: false, blocker: "UNSUPPORTED_PROPERTY" }
  const seenPins = new Set<string>()
  for (const row of input.candidatePool) {
    if (!/^\d{14}$/.test(row.pin) || seenPins.has(row.pin) || !safeText(row.neighborhoodCode, 32) || !safeText(row.propertyClass, 16) ||
        !safeText(row.residentialSubtype, 128) || !Number.isFinite(row.buildingSqft) || row.buildingSqft <= 0 || row.buildingSqft > 1_000_000 ||
        !Number.isSafeInteger(row.yearBuilt) || row.yearBuilt <= 1700 || row.yearBuilt > 2026)
      return { ok: false, blocker: "INCOMPLETE_MATCHING_PROPERTY_RECORD" }
    seenPins.add(row.pin)
  }
  for (const [key, value] of input.assessedValues) if (!seenPins.has(key) || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000)
    return { ok: false, blocker: "INCOMPLETE_MATCHING_PROPERTY_RECORD" }
  for (const [key, value] of input.addresses) if (!seenPins.has(key) || !safeText(value, 256))
    return { ok: false, blocker: "INCOMPLETE_MATCHING_PROPERTY_RECORD" }
  if (input.orderId.length === 0 || input.orderId.length > 128 || /[\p{Cc}\p{Cf}]/u.test(input.orderId) ||
      input.candidatePool.length > 5000 || input.assessedValues.size > 5000 || input.addresses.size > 5000 ||
      input.sources.length === 0 || input.sources.length > 200 || input.sources.some(s =>
        !s.datasetId.trim() || s.datasetId.length > 64 || !s.datasetTitle.trim() || s.datasetTitle.length > 256 ||
        !s.url.trim() || s.url.length > 2048 || !officialDatasetUrl(s.url, s.datasetId) || !RFC3339.test(s.retrievedAt) || !SHA256.test(s.contentSha256 ?? "") ||
        s.subjectPin !== subjectPin || s.taxYear !== 2026 || s.roles.length === 0 || s.roles.length > NEUTRAL_SOURCE_ROLES.length ||
        new Set(s.roles).size !== s.roles.length || s.roles.some(role => !NEUTRAL_SOURCE_ROLES.includes(role)) || Date.parse(s.retrievedAt) > generatedMs || generatedMs - Date.parse(s.retrievedAt) > 86_400_000
      ))
    return { ok: false, blocker: "INCOMPLETE_SOURCE_MANIFEST" }
  if (NEUTRAL_SOURCE_ROLES.some(role => !input.sources.some(source => source.roles.includes(role))))
    return { ok: false, blocker: "INCOMPLETE_SOURCE_MANIFEST" }
  const requiredDatasetRoles: ReadonlyArray<readonly [string, ReadonlyArray<NeutralSourceRole>]> = [
    ["pabr-t5kh", ["subject", "candidates"]],
    ["x54s-btds", ["subject", "candidates", "proration"]],
    ["uzyt-m557", ["subject", "assessed_values"]],
    ["3723-97qp", ["subject", "addresses"]],
  ]
  if (requiredDatasetRoles.some(([datasetId, roles]) => roles.some(role => !input.sources.some(source => source.datasetId === datasetId && source.roles.includes(role)))))
    return { ok: false, blocker: "INCOMPLETE_SOURCE_MANIFEST" }
  if (
    input.subjectProration.ambiguitySemantics !== "PUBLISHED_ZERO_OR_NULL_NOT_INTERPRETED" ||
    !input.subjectProration.sourceDatasetId.trim() ||
    !RFC3339.test(input.subjectProration.sourceRetrievedAt) ||
    !SHA256.test(input.subjectProration.sourceContentSha256) ||
    !input.sources.some(source =>
      source.datasetId === input.subjectProration.sourceDatasetId &&
      source.retrievedAt === input.subjectProration.sourceRetrievedAt &&
      source.contentSha256 === input.subjectProration.sourceContentSha256
    )
  ) return { ok: false, blocker: "INCOMPLETE_SOURCE_MANIFEST" }
  for (const value of [input.subjectProration.pinNumCards, input.subjectProration.tiebackKeyPin, input.subjectProration.tiebackProrationRate, input.subjectProration.cardProrationRate]) {
    if (value !== null && (value.length > 64 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value) || /^[=+\-@]/.test(value))) return { ok: false, blocker: "INCOMPLETE_SOURCE_MANIFEST" }
  }

  const selection = selectNonDirectionalComparables({
    pin: subjectPin,
    neighborhoodCode: subject.neighborhoodCode,
    propertyClass: subject.propertyClass,
    residentialSubtype: subject.residentialSubtype,
    buildingSqft: subject.buildingSqft,
    yearBuilt: subject.yearBuilt,
  }, input.candidatePool)
  if (!selection) return { ok: false, blocker: "UNSUPPORTED_PROPERTY" }
  const attached = attachAssessedValues(selection.accepted, input.assessedValues)
  if (attached.missingValue.length || attached.valued.some(row => !input.addresses.get(row.pin)?.trim()))
    return { ok: false, blocker: "INCOMPLETE_MATCHING_PROPERTY_RECORD" }

  const sources = canonicalNeutralSourceOrder(input.sources).map(s => ({ ...s }))
  const manifest: NeutralReportManifest = {
    producerVersion: NEUTRAL_REPORT_PRODUCER_VERSION,
    templateVersion: NEUTRAL_REPORT_TEMPLATE_VERSION,
    commercePolicyVersion: policy.version,
    strictQualificationAuthorized: false,
    generatedAt: input.generatedAt,
    orderId: input.orderId,
    subjectPin,
    selectionRuleId: NON_DIRECTIONAL_RULE_ID,
    selectionIsDirectional: false,
    candidateCount: input.candidatePool.length,
    matchingPropertyCount: attached.valued.length,
    rejectedByReason: rejectionCountsByReason(selection.rejected),
    candidatePoolSha256: candidatePoolSha256(input.candidatePool),
    candidatePoolHashDomain: CANDIDATE_POOL_HASH_DOMAIN,
    subjectProration: { ...input.subjectProration },
    sources,
    dataEvidenceSha256: input.dataEvidenceSha256,
    deadlineEvidenceSha256: input.deadlineEvidenceSha256,
    dataEvidenceVersion: input.dataEvidenceVersion,
    deadlineEvidenceVersion: input.deadlineEvidenceVersion,
  }

  const header = ["pin", "address", "neighborhood", "property_class", "residential_subtype", "building_sqft", "year_built", "assessed_total", "assessed_per_sqft"]
  const csvRows = attached.valued.map(row => [csvPin(row.pin), ...[input.addresses.get(row.pin), row.neighborhoodCode, row.propertyClass, row.residentialSubtype, row.buildingSqft, row.yearBuilt, row.assessedTotalValue, fixed(row.assessedPerSqft, 4)].map(csvCell)].join(","))
  const csv = [header.map(csvCell).join(","), ...csvRows].join("\r\n") + "\r\n"

  const lines: string[] = [
    "OVERTAXED IL - COOK COUNTY ASSESSMENT RECORDS & MATCHING PROPERTY REPORT",
    "=======================================================================",
    "",
    "This report compiles official records and applies a published, non-directional matching filter.",
    "It does not decide appeal eligibility, value property, estimate savings, recommend filing, or predict an outcome.",
    "",
    `Prepared: ${input.generatedAt}`,
    `Order reference: ${clean(input.orderId)}`,
    "",
    "1. SUBJECT PROPERTY - OFFICIAL RECORDS",
    `PIN: ${clean(subject.pin)}`,
    `Address: ${clean(subject.address)}, ${clean(subject.city)}`,
    `Township: ${clean(subject.township)}`,
    `Tax year / assessment stage: ${subject.taxYear} / ${clean(subject.assessmentStage)}`,
    `Neighborhood / class / type: ${clean(subject.neighborhoodCode)} / ${clean(subject.propertyClass)} / ${clean(subject.residentialSubtype)}`,
    `Building area / year built: ${subject.buildingSqft.toLocaleString("en-US")} sq ft / ${subject.yearBuilt}`,
    `Assessed total / arithmetic: $${subject.assessedTotalValue.toLocaleString("en-US")} / ${subject.buildingSqft.toLocaleString("en-US")} sq ft = $${fixed(subject.assessedTotalValue / subject.buildingSqft)} per sq ft`,
    `Published card count: ${input.subjectProration.pinNumCards ?? "not published"}`,
    `Published tieback key PIN: ${clean(input.subjectProration.tiebackKeyPin) || "not published"}`,
    `Published tieback proration rate: ${input.subjectProration.tiebackProrationRate ?? "not published"}`,
    `Published card proration rate: ${input.subjectProration.cardProrationRate ?? "not published"}`,
    "Proration disclosure: the public transformation uses COALESCE for card proration, so a published 0 cannot distinguish a recorded zero from a missing source value. This report does not infer which it is.",
    "",
    "2. MATCHING FILTER",
    `Rule: ${NON_DIRECTIONAL_RULE_ID}`,
    `Same neighborhood, exact class and residence type, building area within ${SQFT_TOLERANCE * 100}%, and year built within ${YEAR_BUILT_TOLERANCE} years.`,
    "Every candidate record satisfying the filter is included. Assessed value is attached only after selection and never ranks or removes a match.",
    `Candidate records evaluated: ${input.candidatePool.length}; matching properties listed: ${attached.valued.length}.`,
    "",
    "3. MATCHING PROPERTIES AND VISIBLE ARITHMETIC",
  ]
  for (const row of attached.valued) lines.push(`${row.pin} | ${clean(input.addresses.get(row.pin))} | ${row.buildingSqft} sq ft | ${row.yearBuilt} | $${row.assessedTotalValue} / ${row.buildingSqft} = $${fixed(row.assessedPerSqft)} per sq ft`)
  lines.push("", "No median, relative gap, merits threshold, or conclusion is applied.", "", "4. OFFICIAL FILING WINDOW", `Status: ${deadline.status}; closes: ${clean(deadline.closeDate) || "not published"}`, `Source: ${clean(deadline.sourceName)} - ${clean(deadline.sourceUrl)}`, `Retrieved: ${deadline.retrievedAt}`, "", "5. SOURCE RECEIPTS")
  for (const source of sources) lines.push(`${clean(source.datasetTitle)} (${clean(source.datasetId)})`, `  ${clean(source.url)}`, `  retrieved ${source.retrievedAt}`, `  content sha256 ${source.contentSha256 ?? "not available from source"}`)
  lines.push("", "6. PROVENANCE MANIFEST", canonicalJson(manifest), "")
  return { ok: true, text: lines.join("\n"), csv, manifest }
}

export function neutralReportDigest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

const MAX_BUNDLE_BYTES = 48_000_000
export type NeutralReportReceipt = Readonly<{ key: string; manifestSha256: string; pdfSha256: string; csvSha256: string; dataEvidenceSha256: string; deadlineEvidenceSha256: string }>
export type NeutralReportWrite = Readonly<{ key: string; pdf: Buffer; csv: Buffer; manifestJson: string; dataPages: ReadonlyArray<Readonly<{ receipt: unknown; bytes: Buffer }>>; calendarBytes: Buffer; deadline: unknown }>
export type NeutralRepositoryOutcome<T = never> = { outcome: "CONFIRMED"; value: T } | { outcome: "UNKNOWN" } | { outcome: "CONFLICT" }
export type NeutralReportRepository = { reserveOrder(orderId: string, key: string, propertyPin: string): Promise<NeutralRepositoryOutcome<string>>; readOrderBinding(key: string): Promise<string | null>; reserve(orderId: string, key: string): Promise<NeutralRepositoryOutcome<NeutralReportReceipt | null>>; stage(key: string, write: NeutralReportWrite): Promise<NeutralRepositoryOutcome>; readStaged(key: string): Promise<NeutralReportWrite | null>; promote(key: string, receipt: NeutralReportReceipt): Promise<NeutralRepositoryOutcome<NeutralReportReceipt>>; readConfirmed(key: string): Promise<{ write: NeutralReportWrite; receipt: NeutralReportReceipt } | null>; quarantine(key: string): Promise<void> }
type Receipt = NeutralReportReceipt
type Write = NeutralReportWrite
type Outcome<T = never> = NeutralRepositoryOutcome<T>
type Repository = NeutralReportRepository
type TestRuntime = { active: boolean; repository: Repository } | undefined
declare global { var __OT_NEUTRAL_REPORT_TEST_RUNTIME__: TestRuntime }

function runtime(): { active: boolean; repository: Repository | null } {
  if (process.env.NODE_ENV === "test") return globalThis.__OT_NEUTRAL_REPORT_TEST_RUNTIME__ ?? { active: false, repository: null }
  return { active: false, repository: null }
}
function bundleBytes(write: Write): number { return write.pdf.length + write.csv.length + Buffer.byteLength(write.manifestJson) + write.calendarBytes.length + write.dataPages.reduce((n, page) => n + page.bytes.length, 0) }
function verifyWrite(write: Write, expected: Receipt): boolean {
  if (write.key !== expected.key || bundleBytes(write) > MAX_BUNDLE_BYTES || neutralReportDigest(write.pdf) !== expected.pdfSha256 || neutralReportDigest(write.csv) !== expected.csvSha256 || neutralReportDigest(write.manifestJson) !== expected.manifestSha256) return false
  let manifest: NeutralReportManifest
  try { manifest = JSON.parse(write.manifestJson) } catch { return false }
  const expectedKey = `neutral-order/${neutralReportDigest(canonicalJson({ orderId: manifest.orderId, propertyPin: manifest.subjectPin, productPolicyVersion: manifest.commercePolicyVersion }))}`
  if (expectedKey !== expected.key || manifest.commercePolicyVersion !== NEUTRAL_REPORT_COMMERCE_POLICY.version || manifest.producerVersion !== NEUTRAL_REPORT_PRODUCER_VERSION || manifest.templateVersion !== NEUTRAL_REPORT_TEMPLATE_VERSION || manifest.strictQualificationAuthorized !== false) return false
  const calendarHash = neutralReportDigest(write.calendarBytes)
  const deadlineDigest = neutralReportDigest(JSON.stringify({ deadline: write.deadline, sourceBytesSha256: calendarHash }))
  const dataDigest = neutralReportDigest(canonicalJson(write.dataPages.map(page => ({ receipt: page.receipt, bytesSha256: neutralReportDigest(page.bytes) }))))
  return manifest.dataEvidenceSha256 === expected.dataEvidenceSha256 && manifest.deadlineEvidenceSha256 === expected.deadlineEvidenceSha256 && dataDigest === expected.dataEvidenceSha256 && deadlineDigest === expected.deadlineEvidenceSha256 && write.dataPages.every(page => (page.receipt as { contentSha256?: string }).contentSha256 === neutralReportDigest(page.bytes))
}
function receiptFor(key: string, manifest: NeutralReportManifest, pdf: Buffer, csv: Buffer): Receipt { return Object.freeze({ key, manifestSha256: neutralReportDigest(JSON.stringify(manifest)), pdfSha256: neutralReportDigest(pdf), csvSha256: neutralReportDigest(csv), dataEvidenceSha256: manifest.dataEvidenceSha256, deadlineEvidenceSha256: manifest.deadlineEvidenceSha256 }) }
async function reconcile(repo: Repository, key: string, receipt: Receipt, staged: boolean): Promise<Receipt | null> {
  try {
    if (staged) { const found = await repo.readStaged(key); if (found && verifyWrite(found, receipt)) return receipt }
    else { const found = await repo.readConfirmed(key); if (found && canonicalJson(found.receipt) === canonicalJson(receipt) && verifyWrite(found.write, found.receipt)) return Object.freeze({ ...found.receipt }) }
  } catch { /* bounded below */ }
  try { await repo.quarantine(key) } catch { /* best effort */ }
  return null
}

/** Only trusted neutral-report constructor. Returns a durable immutable receipt. */
export async function produceNeutralReport(input: { orderId: string; propertyPin: string }, trustedRuntime?: { active: boolean; repository: NeutralReportRepository }): Promise<{ ok: true; receipt: Receipt } | { ok: false; blocker: string }> {
  const resolveRuntime = () => trustedRuntime ?? runtime()
  const first = resolveRuntime()
  if (!first.active) return { ok: false, blocker: "NEUTRAL_REPORT_INACTIVE" }
  if (!first.repository) return { ok: false, blocker: "NEUTRAL_REPOSITORY_UNAVAILABLE" }
  if (!input.orderId || input.orderId.length > 128 || !/^\d{14}$/.test(input.propertyPin)) return { ok: false, blocker: "NEUTRAL_INPUT_INVALID" }
  // Checkout integration must supply the server-authoritative order PIN. This
  // durable order-level reservation prevents one order from ever changing PIN.
  const orderKey = neutralOrderReservationKey(input.orderId)
  let orderReservation: Outcome<string>
  try { orderReservation = await first.repository.reserveOrder(input.orderId, orderKey, input.propertyPin) } catch { orderReservation = { outcome: "UNKNOWN" } }
  if (orderReservation.outcome === "CONFLICT") return { ok: false, blocker: "NEUTRAL_REPLAY_CONFLICT" }
  if (orderReservation.outcome === "UNKNOWN") {
    try { const bound = await first.repository.readOrderBinding(orderKey); if (bound !== input.propertyPin) return { ok: false, blocker: bound ? "NEUTRAL_REPLAY_CONFLICT" : "NEUTRAL_RESERVATION_UNKNOWN" } }
    catch { return { ok: false, blocker: "NEUTRAL_RESERVATION_UNKNOWN" } }
  } else if (orderReservation.value !== input.propertyPin) return { ok: false, blocker: "NEUTRAL_REPLAY_CONFLICT" }
  const key = `neutral-order/${neutralReportDigest(canonicalJson({ orderId: input.orderId, propertyPin: input.propertyPin, productPolicyVersion: NEUTRAL_REPORT_COMMERCE_POLICY.version }))}`
  let reservation: Outcome<Receipt | null>
  try { reservation = await first.repository.reserve(input.orderId, key) } catch { return { ok: false, blocker: "NEUTRAL_RESERVATION_UNKNOWN" } }
  if (reservation.outcome !== "CONFIRMED") return { ok: false, blocker: reservation.outcome === "CONFLICT" ? "NEUTRAL_RESERVATION_CONFLICT" : "NEUTRAL_RESERVATION_UNKNOWN" }
  if (reservation.value) {
    try {
      const existing = await first.repository.readConfirmed(key)
      if (existing && canonicalJson(existing.receipt) === canonicalJson(reservation.value) && verifyWrite(existing.write, existing.receipt)) {
        const manifest = JSON.parse(existing.write.manifestJson) as NeutralReportManifest
        if (manifest.orderId === input.orderId && manifest.subjectPin === input.propertyPin && manifest.commercePolicyVersion === NEUTRAL_REPORT_COMMERCE_POLICY.version) return { ok: true, receipt: Object.freeze({ ...existing.receipt }) }
      }
    } catch { /* bounded below */ }
    await first.repository.quarantine(key).catch(() => {}); return { ok: false, blocker: "NEUTRAL_REPLAY_CONFLICT" }
  }
  const raw = await readNeutralOfficialBytesRuntime({ propertyPin: input.propertyPin }); if (!raw.ok) return raw
  const calendar = await loadNeutralOfficialCalendarRuntime({ subjectPin: raw.evidence.subject.pin, subjectTownship: raw.evidence.subject.township }); if (!calendar.ok) return calendar
  const pages = verifyAndCopyNeutralEvidence(raw.evidence), calendarBytes = verifyAndCopyNeutralDeadlineEvidence(calendar.evidence)
  if (!pages || !calendarBytes) return { ok: false, blocker: "NEUTRAL_EVIDENCE_MUTATED" }
  const formatted = formatNeutralReportContent({ orderId: input.orderId, orderPropertyPin: input.propertyPin, subject: raw.evidence.subject, subjectProration: raw.evidence.subjectProration, candidatePool: raw.evidence.candidatePool, assessedValues: raw.evidence.assessedValues, addresses: raw.evidence.addresses, deadline: calendar.evidence.deadline, sources: raw.evidence.sources, generatedAt: calendar.evaluatedAt, dataEvidenceSha256: raw.evidence.dataEvidenceSha256, deadlineEvidenceSha256: calendar.evidence.deadlineEvidenceSha256, dataEvidenceVersion: "ot-neutral-data-evidence/v1", deadlineEvidenceVersion: "ot-neutral-deadline-evidence/v1" })
  if (!formatted.ok) return formatted
  const pdf = await renderDeterministicTextPdf(formatted.text, formatted.manifest.generatedAt, { title: "OverTaxed IL - Assessment Records & Matching Property Report", heading: "OVERTAXED IL  |  ASSESSMENT RECORDS & MATCHING PROPERTIES", disclaimer: "Official-record compilation only. No eligibility, valuation, savings, or filing conclusion." })
  const csv = Buffer.from(formatted.csv), manifestJson = JSON.stringify(formatted.manifest), receipt = receiptFor(key, formatted.manifest, pdf, csv)
  const write: Write = Object.freeze({ key, pdf: Buffer.from(pdf), csv: Buffer.from(csv), manifestJson, dataPages: Object.freeze(pages.map(page => Object.freeze({ receipt: page.receipt, bytes: Buffer.from(page.bytes) }))), calendarBytes: Buffer.from(calendarBytes), deadline: calendar.evidence.deadline })
  if (!verifyWrite(write, receipt)) return { ok: false, blocker: "NEUTRAL_BUNDLE_INVALID" }
  const beforeStage = resolveRuntime(); if (!beforeStage.active || beforeStage.repository !== first.repository) return { ok: false, blocker: "NEUTRAL_REPORT_INACTIVE" }
  let staged: Outcome; try { staged = await first.repository.stage(key, write) } catch { staged = { outcome: "UNKNOWN" } }
  if (staged.outcome === "CONFLICT") { await first.repository.quarantine(key).catch(() => {}); return { ok: false, blocker: "NEUTRAL_STAGE_CONFLICT" } }
  if (staged.outcome === "UNKNOWN" && !(await reconcile(first.repository, key, receipt, true))) return { ok: false, blocker: "NEUTRAL_STAGE_UNKNOWN" }
  if (!(await reconcile(first.repository, key, receipt, true))) return { ok: false, blocker: "NEUTRAL_STAGE_VERIFY_FAILED" }
  const beforePromote = resolveRuntime(); if (!beforePromote.active || beforePromote.repository !== first.repository) { await first.repository.quarantine(key).catch(() => {}); return { ok: false, blocker: "NEUTRAL_REPORT_INACTIVE" } }
  let promoted: Outcome<Receipt>; try { promoted = await first.repository.promote(key, receipt) } catch { promoted = { outcome: "UNKNOWN" } }
  if (promoted.outcome === "CONFLICT") { await first.repository.quarantine(key).catch(() => {}); return { ok: false, blocker: "NEUTRAL_PROMOTE_CONFLICT" } }
  if (promoted.outcome === "CONFIRMED" && canonicalJson(promoted.value) === canonicalJson(receipt)) return { ok: true, receipt: promoted.value }
  const confirmed = await reconcile(first.repository, key, receipt, false)
  return confirmed ? { ok: true, receipt: confirmed } : { ok: false, blocker: "NEUTRAL_PROMOTE_UNKNOWN" }
}
