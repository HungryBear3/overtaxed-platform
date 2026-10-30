/**
 * Closed public FACTUAL_ONLY contract. JSON text in, typed value out.
 *
 * Domain is JSON transport text only: the bounded parser below rejects
 * duplicate keys, oversize and deep input before the strict schema runs. It
 * makes no claim about arbitrary hostile JS objects. No hashes or signatures:
 * a coherent, schema-valid rewrite of raw numbers cannot be authenticated
 * offline; only reloading the server record by ID defends that.
 */
import { z } from "zod"

export const FACTUAL_SCHEMA_VERSION = "factual-only/v2" as const
export const MAX_FACTUAL_JSON_BYTES = 3_000_000
export const MAX_FACTUAL_RECORDS = 5000
export const MAX_FACTUAL_JSON_DEPTH = 8

/** Code-owned source catalog. Engineering lookup (COUNTY_DATASETS ids), not approved authority. */
export const SOURCE_CATALOG = {
  ccao_assessed_values: { label: "Cook County Assessor — Assessed Values (uzyt-m557)", url: "https://datacatalog.cookcountyil.gov/d/uzyt-m557" },
  ccao_parcel_universe: { label: "Cook County Assessor — Parcel Universe (pabr-t5kh)", url: "https://datacatalog.cookcountyil.gov/d/pabr-t5kh" },
} as const
export type SourceKey = keyof typeof SOURCE_CATALOG

export const LIMITATION_TEMPLATES = {
  unvalidated: "These figures are unvalidated raw records. No conclusion about your assessment is drawn.",
  window_unknown: "The appeal filing window is UNKNOWN here. Check the Assessor's calendar directly.",
  date_unknown: "Some records carry no date in the source; the date is not stated in source.",
  cohort_not_comparables: "Cohort parcels share a neighborhood code and class; they are not selected comparables.",
  synthetic_preview: "SYNTHETIC PREVIEW — invented local data, not a Cook County record and not current.",
  upstream_not_atomic: "Cross-request and cross-dataset atomicity is NOT ESTABLISHED. Stable counts and source epochs are consistency checks only.",
  provisional_current_year: "Current-year mailed assessed values are provisional and may change. This is a collector-attested complete application capture, not an upstream atomic snapshot.",
  area_unknown: "Area and improvement characteristics are not established by this raw-record source chain and are not reported or used.",
  area_snapshot_metric_only: "Building area, year built and residence type from the Assessor characteristics records in the saved acquisition snapshot are used only to select the comparable cohort and compute the per-building-square-foot metric; they are not reported per parcel here and are unvalidated.",
} as const
export type LimitationKey = keyof typeof LIMITATION_TEMPLATES
export const REQUIRED_LIMITATIONS: readonly LimitationKey[] = ["unvalidated", "window_unknown", "cohort_not_comparables"]

const Pin = z.string().regex(/^\d{2}-\d{2}-\d{3}-\d{3}-\d{4}$/)
const Cents = z.number().int().min(0).max(100_000_000_000)
const Year = z.number().int().min(1990).max(2100)
const SourceId = z.enum(Object.keys(SOURCE_CATALOG) as [SourceKey, ...SourceKey[]])
const Township = z.string().regex(/^[A-Z][A-Za-z ]{1,30}$/)
const Neighborhood = z.string().regex(/^\d{2,3}-\d{2,3}$/)
/** A real calendar date, not merely date-shaped (2025-99-99 and 2025-02-30 fail). */
const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, "calendar date")

/**
 * Source roles every result must carry: assessed values supply the amounts on
 * each record; the parcel universe supplies the township/neighborhood binding.
 */
export const ASSESSMENT_SOURCE: SourceKey = "ccao_assessed_values"
export const REQUIRED_SOURCES: readonly SourceKey[] = ["ccao_assessed_values", "ccao_parcel_universe"]

/** UTF-8 encoded length without TextEncoder; lone surrogates count as U+FFFD (3 bytes). */
export function utf8ByteLength(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

const RecordSchema = z.strictObject({
  pin: Pin,
  role: z.enum(["subject", "cohort"]),
  taxYear: Year,
  assessedTotalCents: Cents,
  landCents: Cents.nullable(),
  buildingCents: Cents.nullable(),
  propertyClass: z.string().regex(/^\d-\d{2}$/),
  township: Township,
  neighborhoodCode: Neighborhood,
  sourceId: SourceId,
  parcelSourceId: z.literal("ccao_parcel_universe"),
  recordDate: CalendarDate.nullable(),
})

export const CountyCaptureSchema = z.strictObject({
  sha256:z.string().regex(/^[a-f0-9]{64}$/), responseCount:z.number().int().min(1).max(200),
  poolCount:z.number().int().min(1).max(MAX_FACTUAL_RECORDS),includedCount:z.number().int().min(1).max(MAX_FACTUAL_RECORDS),excludedClassCount:z.number().int().min(0).max(MAX_FACTUAL_RECORDS),
  retrievedAt:z.string().datetime(), upstreamAtomicGuarantee:z.literal('NOT_ESTABLISHED'),completeness:z.literal('COLLECTOR_ATTESTED'),stage:z.literal('mailed'),provisional:z.literal(true),
})
const Hex64 = z.string().regex(/^[a-f0-9]{64}$/)
/** Canonical persisted acquisition reference + owner-selected shared metric.
 * The metric is only over the qualified paid cohort (subject excluded); legacy
 * `records`/`finding` remain HISTORICAL exact-class data, never a median. */
export const FactualAcquisitionSnapshotSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_:.-]{1,100}$/),
  sha256: Hex64,
  schema: z.string().regex(/^[A-Za-z0-9_:\/.-]{1,80}$/),
  dataEvidenceSha256: Hex64,
  sharedMetric: z.strictObject({
    version: z.literal('ot-shared-metric/v1'),
    metric: z.literal('MEDIAN_ASSESSED_PER_BUILDING_SQFT'),
    unit: z.literal('ASSESSED_USD_CENTS_PER_BUILDING_SQFT'),
    cohortRule: z.literal('PAID_NEUTRAL_MATCH_V1'),
    stage: z.literal('mailed'),
    taxYear: z.number().int().min(1900).max(2100),
    subjectExcluded: z.literal(true),
    subjectAssessedCentsPerBuildingSqft: z.number().finite().positive(),
    subjectAssessedTotalCents: z.number().int().min(0).max(100_000_000_000),
    comparableMedian: z.discriminatedUnion('status', [
      z.strictObject({ unit: z.literal('ASSESSED_USD_CENTS_PER_BUILDING_SQFT'), status: z.literal('COMPUTED'), value: z.number().finite().min(0), count: z.number().int().min(1), minimumCount: z.number().int().min(1) }),
      z.strictObject({ unit: z.literal('ASSESSED_USD_CENTS_PER_BUILDING_SQFT'), status: z.literal('NOT_COMPUTABLE'), reason: z.enum(['EMPTY', 'INSUFFICIENT', 'INVALID_INPUT']), count: z.number().int().min(0), minimumCount: z.number().int().min(1) }),
    ]),
    /** No owner-approved minimum sample exists; never implies sufficiency. */
    sampleAdequacy: z.literal('NOT_QUALIFIED'),
    claims: z.literal('ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS'),
  }),
})
export type FactualAcquisitionSnapshot = z.infer<typeof FactualAcquisitionSnapshotSchema>
export const FactualResultSchema = z
  .strictObject({
    schema: z.literal(FACTUAL_SCHEMA_VERSION),
    kind: z.literal("FACTUAL_ONLY"),
    validation: z.literal("UNVALIDATED"),
    dataOrigin: z.enum(["SYNTHETIC_PREVIEW", "COUNTY_RECORD"]),
    countyCapture: CountyCaptureSchema.optional(),
    acquisitionSnapshot: FactualAcquisitionSnapshotSchema.optional(),
    resultId: z.string().regex(/^res_[a-z0-9]{24}$/),
    snapshotId: z.string().regex(/^snap_[a-z0-9]{24}$/),
    snapshotVersion: z.number().int().min(1).max(1_000_000),
    subject: z.strictObject({ pin: Pin, township: z.string().regex(/^[A-Z][A-Za-z ]{1,30}$/), taxYear: Year }),
    cohort: z.strictObject({ neighborhoodCode: z.string().regex(/^\d{2,3}-\d{2,3}$/), propertyClass: z.string().regex(/^\d-\d{2}$/), count: z.number().int().min(0).max(MAX_FACTUAL_RECORDS-1) }),
    records: z.array(RecordSchema).min(1).max(MAX_FACTUAL_RECORDS),
    finding: z.strictObject({
      template: z.literal("raw_assessment_record_v1"),
      subjectAssessedTotalCents: Cents,
      cohortAssessedTotalCents: z.number().int().min(0).max(500_000_000_000_000),
      cohortCount: z.number().int().min(0).max(MAX_FACTUAL_RECORDS-1),
    }),
    window: z.strictObject({ state: z.literal("UNKNOWN"), actionable: z.literal(false) }),
    limitations: z.array(z.enum(Object.keys(LIMITATION_TEMPLATES) as [LimitationKey, ...LimitationKey[]])).min(1).max(10),
    sources: z.array(z.enum(Object.keys(SOURCE_CATALOG) as [SourceKey, ...SourceKey[]])).min(1).max(5),
  })
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message })
    if(r.dataOrigin==='COUNTY_RECORD') {
      if(!r.countyCapture || r.countyCapture.includedCount!==r.records.length || r.countyCapture.poolCount!==r.countyCapture.includedCount+r.countyCapture.excludedClassCount)fail('county capture')
      for(const k of ['upstream_not_atomic','provisional_current_year'] as const)if(!r.limitations.includes(k))fail('county limitation')
      // The saved metric is derived from building area: disclose that exactly, never "not used".
      const [needed, forbidden] = r.acquisitionSnapshot ? ['area_snapshot_metric_only','area_unknown'] as const : ['area_unknown','area_snapshot_metric_only'] as const
      if(!r.limitations.includes(needed) || r.limitations.includes(forbidden))fail('county area limitation')
      if(r.records.some(x=>x.landCents===null||x.buildingCents===null))fail('required assessed fields')
    } else {
      if(r.countyCapture)fail('unexpected county capture')
      if(r.limitations.includes('area_snapshot_metric_only'))fail('area limitation without metric')
    }
    if(r.acquisitionSnapshot && (r.dataOrigin!=='COUNTY_RECORD' || r.acquisitionSnapshot.sharedMetric.taxYear!==r.subject.taxYear))fail('acquisition snapshot')
    if (!/^2-(?!99$)\d{2}$/.test(r.cohort.propertyClass)) fail("unsupported class")
    const subjects = r.records.filter((x) => x.role === "subject")
    const cohort = r.records.filter((x) => x.role === "cohort")
    if (subjects.length !== 1 || subjects[0].pin !== r.subject.pin) fail("subject identity")
    if (new Set(r.records.map((x) => x.pin)).size !== r.records.length) fail("duplicate pin")
    if (r.records.some((x) => x.taxYear !== r.subject.taxYear)) fail("tax year")
    if (cohort.length !== r.cohort.count || r.finding.cohortCount !== cohort.length) fail("cohort count")
    if (subjects[0] && r.finding.subjectAssessedTotalCents !== subjects[0].assessedTotalCents) fail("finding subject")
    if (r.finding.cohortAssessedTotalCents !== cohort.reduce((a, x) => a + x.assessedTotalCents, 0)) fail("finding cohort")
    for (const x of r.records)
      if (x.landCents !== null && x.buildingCents !== null && x.landCents + x.buildingCents !== x.assessedTotalCents) fail("record arithmetic")
    for (const x of r.records) {
      if (x.township !== r.subject.township) fail("record township")
      if (x.neighborhoodCode !== r.cohort.neighborhoodCode || x.propertyClass !== r.cohort.propertyClass) fail("record cohort")
      if (x.sourceId !== ASSESSMENT_SOURCE || !r.sources.includes(x.sourceId)) fail("record source")
    }
    for (const s of REQUIRED_SOURCES) if (!r.sources.includes(s)) fail(`source ${s}`)
    for (const k of REQUIRED_LIMITATIONS) if (!r.limitations.includes(k)) fail(`limitation ${k}`)
    if (r.dataOrigin === "SYNTHETIC_PREVIEW" && !r.limitations.includes("synthetic_preview")) fail("synthetic label")
    if (r.records.some((x) => x.recordDate === null) && !r.limitations.includes("date_unknown")) fail("date limitation")
    if (new Set(r.limitations).size !== r.limitations.length || new Set(r.sources).size !== r.sources.length) fail("duplicates")
  })
export type FactualResult = z.infer<typeof FactualResultSchema>

export const LookupReceiptSchema = z.strictObject({
  schema: z.literal(FACTUAL_SCHEMA_VERSION),
  resultId: z.string().regex(/^res_[a-z0-9]{24}$/),
  snapshotId: z.string().regex(/^snap_[a-z0-9]{24}$/),
  subject: z.strictObject({ pin: Pin, township: z.string().regex(/^[A-Z][A-Za-z ]{1,30}$/), taxYear: Year }),
})
export type LookupReceipt = z.infer<typeof LookupReceiptSchema>

export type Decoded<T> = { ok: true; value: T } | { ok: false; code: "TOO_LARGE" | "TOO_DEEP" | "MALFORMED" | "DUPLICATE_KEY" | "SCHEMA" }

class JsonError extends Error {
  constructor(readonly code: "TOO_DEEP" | "MALFORMED" | "DUPLICATE_KEY") { super(code) }
}

/** Bounded recursive JSON parser; rejects duplicate keys and nesting deeper than the limit. */
export function parseBoundedJson(text: string, maxDepth = MAX_FACTUAL_JSON_DEPTH): unknown {
  let i = 0
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++ }
  const value = (depth: number): unknown => {
    if (depth > maxDepth) throw new JsonError("TOO_DEEP")
    ws()
    const c = text[i]
    if (c === "{") {
      i++
      const out: Record<string, unknown> = Object.create(null)
      ws()
      if (text[i] === "}") { i++; return out }
      for (;;) {
        ws()
        if (text[i] !== '"') throw new JsonError("MALFORMED")
        const key = str()
        if (Object.prototype.hasOwnProperty.call(out, key)) throw new JsonError("DUPLICATE_KEY")
        ws()
        if (text[i++] !== ":") throw new JsonError("MALFORMED")
        out[key] = value(depth + 1)
        ws()
        if (text[i] === ",") { i++; continue }
        if (text[i] === "}") { i++; return { ...out } }
        throw new JsonError("MALFORMED")
      }
    }
    if (c === "[") {
      i++
      const out: unknown[] = []
      ws()
      if (text[i] === "]") { i++; return out }
      for (;;) {
        out.push(value(depth + 1))
        ws()
        if (text[i] === ",") { i++; continue }
        if (text[i] === "]") { i++; return out }
        throw new JsonError("MALFORMED")
      }
    }
    if (c === '"') return str()
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 40))
    if (!m) throw new JsonError("MALFORMED")
    i += m[0].length
    return JSON.parse(m[0])
  }
  const str = (): string => {
    const m = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(text.slice(i))
    if (!m) throw new JsonError("MALFORMED")
    i += m[0].length
    return JSON.parse(m[0])
  }
  const v = value(0)
  ws()
  if (i !== text.length) throw new JsonError("MALFORMED")
  return v
}

function decodeWith<T>(schema: z.ZodType<T>, text: string): Decoded<T> {
  // Code units never exceed UTF-8 bytes, so the cheap check runs first.
  if (typeof text !== "string" || text.length > MAX_FACTUAL_JSON_BYTES || utf8ByteLength(text) > MAX_FACTUAL_JSON_BYTES)
    return { ok: false, code: "TOO_LARGE" }
  let raw: unknown
  try {
    raw = parseBoundedJson(text)
  } catch (e) {
    return { ok: false, code: e instanceof JsonError ? e.code : "MALFORMED" }
  }
  const parsed = schema.safeParse(raw)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "SCHEMA" }
}

export const decodeFactualResultJson = (text: string) => decodeWith(FactualResultSchema, text)
export const decodeLookupReceiptJson = (text: string) => decodeWith(LookupReceiptSchema, text)
