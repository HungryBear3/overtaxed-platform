/**
 * Strict official Cook County evidence retrieval for the T2 evidence packet.
 *
 * This module reads published Cook County Assessor datasets and assembles the
 * subject record, the complete candidate pool, the assessed values and the
 * published addresses that `lib/fulfillment/t2-artifact-content.ts` composes
 * into a packet. It is the "correct non-directional county reader" the
 * producer's HOLD comment described, and it is deliberately the strictest
 * component in the chain: every ambiguity, every gap and every sign of an
 * unstable read refuses by name rather than producing a partial answer.
 *
 * Four properties matter more than the happy path.
 *
 * **It cannot cherry-pick.** The only `$where` predicates it ever emits are
 * parcel identity, tax year, assessor neighbourhood, township and property
 * class. It never filters or orders by an assessed value, and `$order` is always
 * `pin`. The comparable pool is therefore the WHOLE class-2 non-condominium
 * population of the subject's assessor neighbourhood, handed to a value-blind
 * selector that performs its own exact-class rejection and records it.
 *
 * **It cannot quietly shrink the pool.** A candidate whose characteristics,
 * assessed value or address are missing, incomplete or ambiguous is not dropped
 * and is not given a synthesised feature. The whole retrieval refuses. A median
 * over a neighbourhood that silently lost its unavailable members is not the
 * median of the neighbourhood the packet describes, and a pool digest over a
 * quietly pruned pool binds the wrong universe.
 *
 * **It does not trust its own query.** A `$where` clause is a request, not a
 * guarantee. Every row that comes back is re-checked against the tax year, the
 * parcel identity, the neighbourhood, the township and the class that were
 * asked for, on every dataset. A source that ignores, mis-parses or
 * mis-routes a filter fails closed instead of contributing a row nobody
 * verified.
 *
 * **It has no ambient dependencies.** `fetch` and the clock are injected, so
 * tests drive it with a mock and no test in this repository opens a socket.
 *
 * Tax year 2026, mailed stage, explicitly
 * ---------------------------------------
 * [[OFFICIAL_TAX_YEAR]] is pinned to 2026 and cross-checked against the injected
 * clock's America/Chicago calendar year, so a year rollover refuses instead of
 * silently reading a year nobody validated. Every response row is then checked
 * to carry that same year. The only assessed figure read is `mailed_tot` for
 * that exact year; `certified_tot` and `board_tot` are never selected and never
 * substituted.
 *
 * That is a real coverage limit, not a conservative flourish. The 2026-09-09
 * official revalidation observed current-year mailed totals in 23 of 38
 * townships, certified in 13, and board in 0, and observed the Assessor's
 * calendar showing a township open while the open-data mailed totals for it were
 * still empty. A subject in one of the 15 townships without mailed values
 * refuses here. Falling back to 2025, to a certified value or to a board value
 * would answer a different question than the one the packet asks.
 *
 * What "fresh" does and does not claim
 * ------------------------------------
 * Each source receipt records the instant THIS process received THAT page's
 * bytes, and the whole retrieval must complete inside
 * [[MAX_RETRIEVAL_WINDOW_MS]]. That is a statement about the read, not about the
 * data: nothing here establishes when the Assessor last refreshed a dataset, and
 * the datasets' own metadata warns that current-year content is final only after
 * every township roll is certified.
 *
 * Likewise the pool stability checks — count before and after the page walk,
 * strictly ascending parcel order across pages, per-page bounds, and identity
 * re-verification on every joined row — detect a great many mid-read changes but
 * do NOT amount to a transactional snapshot. Socrata offers no read isolation
 * across requests, and this module deliberately does not issue the large
 * metadata reads that would be needed to compare dataset update epochs. A
 * concurrent update that preserves the row count and the parcel ordering would
 * not be caught. The refusals below should be read as "this read was not
 * demonstrably stable", never as "this read was provably atomic".
 */

import { createHash } from "node:crypto"
import { isUtf8 } from "node:buffer"

import type { SourceRecord, SubjectRecord } from "@/lib/fulfillment/t2-artifact-content"
import type { ComparableMatchAttributes } from "@/lib/fulfillment/t2-comparables"
import { townshipKeyFromName } from "@/lib/deadlines/township-resolution"

/**
 * The tax year this module is authorised to read, cross-checked against the
 * injected clock AND against every row returned. See the module note: never
 * 2025, never a certified or board figure, never a fallback.
 */
export const OFFICIAL_TAX_YEAR = 2026

/** The only assessed stage read. Recorded into the packet's subject record. */
export const OFFICIAL_ASSESSMENT_STAGE = "mailed"

/** The only state an address may carry. Cook County is in Illinois. */
export const OFFICIAL_ADDRESS_STATE = "IL"

const SOCRATA_HOST = "datacatalog.cookcountyil.gov"
const SOCRATA_ORIGIN = `https://${SOCRATA_HOST}`

/**
 * Dataset identities, with the titles that reach the packet's source manifest.
 *
 * Field mappings are the ones the 1,200-PIN public-data study exercised against
 * the live API, the published column inventory for the parcel universe, and the
 * 2026-09-12 address-source evidence for `3723-97qp`.
 *
 * Every select list is the minimum the packet needs. The address dataset also
 * publishes owner and mailing fields; none is selected here.
 */
export const COUNTY_DATASETS = {
  parcelUniverse: {
    id: "pabr-t5kh",
    title: "Assessor - Parcel Universe (Current Year Only)",
    select: "pin,year,class,township_code,township_name,nbhd_code",
  },
  characteristics: {
    id: "x54s-btds",
    title: "Assessor - Single and Multi-Family Improvement Characteristics",
    select:
      "pin,year,class,township_code,pin_num_cards,pin_is_multiland,pin_num_landlines," +
      "tieback_key_pin,tieback_proration_rate,card_proration_rate," +
      "char_bldg_sf,char_yrblt,char_type_resd",
  },
  assessedValues: {
    id: "uzyt-m557",
    title: "Assessor - Assessed Values",
    /** `mailed_tot` only. `certified_tot` and `board_tot` are never selected. */
    select: "pin,year,class,township_code,nbhd,mailed_tot",
  },
  addresses: {
    id: "3723-97qp",
    title: "Assessor - Parcel Addresses",
    /**
     * This dataset carries no township or neighbourhood column, so it is joined
     * on parcel identity and tax year alone and contributes no locality claim.
     * Locality is never inferred from it.
     */
    select: "pin,year,prop_address_full,prop_address_city_name,prop_address_state",
  },
} as const

/**
 * Retrieval bounds. Small pages and a small total, so a neighbourhood that does
 * not fit is REJECTED rather than truncated to whatever the first page held.
 */
export const POOL_PAGE_SIZE = 500
export const POOL_MAX_ROWS = 5000
export const JOIN_CHUNK_SIZE = 100
export const MAX_REQUESTS = 200
export const REQUEST_TIMEOUT_MS = 15_000
export const MAX_RESPONSE_BYTES = 2_000_000

/**
 * The whole retrieval's wall-clock budget.
 *
 * A per-request timeout alone is not a freshness bound: 200 requests at a 15
 * second ceiling each could span the better part of an hour and still satisfy
 * every individual limit, leaving the first page and the last page describing
 * the county at materially different times. The receipts must describe one
 * bounded read.
 */
export const MAX_RETRIEVAL_WINDOW_MS = 120_000

/**
 * Bounded, stable, non-PII refusal vocabulary. Every one of these is a statement
 * about the official record or about the read of it — never about a value.
 */
export type CountyGatewayBlocker =
  | "COUNTY_TAX_YEAR_UNVERIFIED"
  | "COUNTY_RESPONSE_YEAR_MISMATCH"
  | "COUNTY_SOURCE_UNAVAILABLE"
  | "COUNTY_REQUEST_BUDGET_EXCEEDED"
  | "COUNTY_RETRIEVAL_WINDOW_EXCEEDED"
  | "COUNTY_CLOCK_UNRELIABLE"
  | "SUBJECT_PIN_INVALID"
  | "SUBJECT_PARCEL_NOT_FOUND"
  | "SUBJECT_PARCEL_AMBIGUOUS"
  | "SUBJECT_TOWNSHIP_MISMATCH"
  | "SUBJECT_CLASS_OUT_OF_SCOPE"
  | "SUBJECT_NEIGHBORHOOD_UNAVAILABLE"
  | "SUBJECT_LOCALITY_UNRECOGNIZED"
  | "SUBJECT_RECORD_INCONSISTENT"
  | "CANDIDATE_POOL_EMPTY"
  | "CANDIDATE_POOL_TOO_LARGE"
  | "CANDIDATE_POOL_UNSTABLE"
  | "CANDIDATE_LOCALITY_MISMATCH"
  | "CANDIDATE_CHARACTERISTICS_INCOMPLETE"
  | "CANDIDATE_CHARACTERISTICS_AMBIGUOUS"
  | "CANDIDATE_ASSESSED_VALUE_INCOMPLETE"
  | "CANDIDATE_ASSESSED_VALUE_AMBIGUOUS"
  | "CANDIDATE_ADDRESS_INCOMPLETE"
  | "CANDIDATE_ADDRESS_AMBIGUOUS"
  | "CANDIDATE_CLASS_AMBIGUOUS"

/** The producer-facing refusal shape. See [[loadOfficialCountyData]]. */
export type CountyDataRefusal = { blocker: CountyGatewayBlocker }

/**
 * INTERNAL-ONLY refusal diagnostics vocabulary.
 *
 * A characteristics refusal is whole-neighbourhood by design, and the public
 * blocker deliberately says only THAT the improvement record was unusable. That
 * is the right answer for a customer and a useless one for an operator: it does
 * not distinguish "the Assessor has published no improvement rows for this
 * township yet" from "one parcel in four hundred carries a half-share
 * proration", and those two want completely different responses from us.
 *
 * These subreasons close that gap without widening what leaves the process.
 * Each one names a condition [[readCharacteristics]] already tests, and the
 * observer receives COUNTS ONLY — never a row, a PIN, an address or a URL — so a
 * diagnostic can say "391 parcels, all missing rows" and can never say which
 * parcels. The list is closed and stable: a new refusal condition must be given
 * a name here rather than smuggled through as free text.
 */
export type CountyCharacteristicsSubreason =
  /** The PIN resolved to no improvement row at all. */
  | "MISSING_ROWS"
  /** The PIN resolved to more than one improvement row. */
  | "DUPLICATE_ROW_ARITY"
  /** `pin_num_cards` unparseable, or not exactly 1. */
  | "CARDS_MISSING" // absent/null/blank marker
  | "CARDS_NOT_SINGLE"
  /** `pin_num_landlines` unparseable, or not exactly 1. */
  | "LANDLINES_MISSING" // absent/null/blank marker
  | "LANDLINES_NOT_SINGLE"
  /** `pin_is_multiland` unparseable, or not explicitly false. */
  | "MULTILAND_MISSING" // absent/null/blank marker
  | "MULTILAND_NOT_FALSE"
  /** `tieback_key_pin` present and naming a different parcel. */
  | "FOREIGN_TIEBACK"
  /** A proration rate present and not exactly 1 — a share, not a whole improvement. */
  | "NON_UNIT_PRORATION"
  /** Building area, year built, residential subtype or class missing or unusable. */
  | "INVALID_REQUIRED_FEATURES"

/** Every subreason, in [[readCharacteristics]]'s own precedence order. */
const CHARACTERISTICS_SUBREASONS: ReadonlyArray<CountyCharacteristicsSubreason> = [
  "MISSING_ROWS",
  "DUPLICATE_ROW_ARITY",
  "CARDS_MISSING",
  "CARDS_NOT_SINGLE",
  "LANDLINES_MISSING",
  "LANDLINES_NOT_SINGLE",
  "MULTILAND_MISSING",
  "MULTILAND_NOT_FALSE",
  "FOREIGN_TIEBACK",
  "NON_UNIT_PRORATION",
  "INVALID_REQUIRED_FEATURES",
]

/**
 * The whole payload an observer ever receives. Two fixed enums and a set of
 * integers; no free-form field exists on this type to carry anything else.
 *
 * `blocker` is the same value the call returns publicly a moment later, so it
 * discloses nothing new, and without it an observer could not tell an INCOMPLETE
 * refusal from an AMBIGUOUS one when both kinds of subreason are present.
 *
 * Every subreason key is always present, zero included, so a consumer can total,
 * diff or chart the counts without probing for optional keys.
 */
export type CountyRefusalDiagnostics = {
  blocker: CountyGatewayBlocker
  subreasonCounts: Record<CountyCharacteristicsSubreason, number>
}

/** The optional internal observer. Its return value and its failures are ignored. */
export type CountyRefusalObserver = (diagnostics: CountyRefusalDiagnostics) => void

/**
 * Exactly the shape `T2ProducerCountyData` requires, structurally rather than by
 * import, so this module and the producer do not depend on each other's types.
 */
export type CountyEvidence = {
  subject: SubjectRecord
  /** The WHOLE class-2 non-condominium pool of the subject's neighbourhood. */
  comparableCandidates: ComparableMatchAttributes[]
  comparableAssessedValues: Map<string, number>
  comparableAddresses: Map<string, string>
  /** One record per request actually issued, each with its own page URL and body hash. */
  sources: SourceRecord[]
}

export type CountyEvidenceResult =
  | { ok: true; evidence: CountyEvidence; sources: SourceRecord[] }
  | { ok: false; blocker: CountyGatewayBlocker; sources: SourceRecord[] }

/** The parcel identity this module reads. Structural, so it imports no producer type. */
export type CountyOrderIdentity = {
  propertyPin: string
  township: string
}

type CountyRequestInit = {
  method: "GET"
  headers: Record<string, string>
  cache: "no-store"
  redirect: "error"
  credentials: "omit"
  signal: AbortSignal
}

/** The slice of a streaming body this module uses. */
export type CountyBody = {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>
    cancel(reason?: unknown): Promise<void>
  }
}

export type CountyResponse = {
  ok: boolean
  status: number
  redirected?: boolean
  body?: CountyBody | null
  text(): Promise<string>
}

export type CountyFetch = (url: string, init: CountyRequestInit) => Promise<CountyResponse>

export type CountyGatewayDeps = {
  fetch: CountyFetch
  now: () => Date
  /**
   * Optional internal diagnostics sink. Unset by default and unset in
   * [[defaultDeps]], so every existing caller is unaffected.
   *
   * It is called at most once per retrieval, only when the retrieval refuses
   * with a characteristics blocker, and only with [[CountyRefusalDiagnostics]].
   * It cannot change the outcome: the refusal is already decided when it runs,
   * it is handed no way to request anything, and both a synchronous throw and a
   * rejected promise are swallowed. See [[reportCharacteristicsDiagnostics]].
   */
  observeRefusalDiagnostics?: CountyRefusalObserver
}

function defaultDeps(): CountyGatewayDeps {
  return {
    fetch: async (url, init) => {
      const response = await globalThis.fetch(url, init as RequestInit)
      return {
        ok: response.ok,
        status: response.status,
        redirected: response.redirected,
        body: response.body as CountyBody | null,
        text: () => response.text(),
      }
    },
    now: () => new Date(),
  }
}

/* ------------------------------------------------------------------ helpers */

/** RFC3339 UTC at second precision, matching the instant format the packet embeds. */
function rfc3339Utc(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`
}

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex")
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}

/**
 * Exact integer, or nothing.
 *
 * Socrata renders a number column's whole values with a trailing `.0` — the
 * current address dataset reports tax year 2026 as the string `"2026.0"` — so an
 * integral trailing zero is accepted and anything else is not. There is no
 * partial parse: `"2026abc"`, `"2026.5"`, `"2e3"` and `""` all read as absent,
 * so a malformed figure becomes a refusal rather than a coerced number.
 */
function asExactInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!/^-?\d+(?:\.0+)?$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Strict decimal, or nothing. Same no-partial-parse rule as [[asExactInteger]]. */
function asExactDecimal(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Explicit boolean false, or nothing.
 *
 * An absent or unparseable flag must NOT read as "false". These flags are the
 * county's own markers for the multi-parcel cases whose building area is not a
 * single number, so treating silence as a clean single parcel is the one reading
 * that turns missing evidence into a qualifying comparable.
 */
function isExplicitlyFalse(value: unknown): boolean {
  if (typeof value === "boolean") return value === false
  if (typeof value !== "string") return false
  return ["false", "f", "0", "no"].includes(value.trim().toLowerCase())
}

/**
 * A 14-digit PIN as the ORDER supplies it: bare digits, or the county's
 * canonical hyphenation. Nothing else.
 *
 * Stripping every non-digit would accept `"pin 14-05-4xx"` shaped junk and any
 * string that merely happens to contain fourteen digits, which is how a typo or
 * a mis-mapped column becomes a confident lookup of somebody else's parcel.
 */
export function parseOrderPin(value: string): string | null {
  const trimmed = (value ?? "").trim()
  if (/^\d{14}$/.test(trimmed)) return trimmed
  if (/^\d{2}-\d{2}-\d{3}-\d{3}-\d{4}$/.test(trimmed)) return trimmed.replace(/-/g, "")
  return null
}

/** A PIN as a DATASET supplies it: exactly fourteen digits, never hyphenated. */
function parseSourcePin(value: unknown): string | null {
  const text = asText(value)
  return /^\d{14}$/.test(text) ? text : null
}

/**
 * Locality codes are interpolated into a SoQL string literal, so they are
 * constrained to digits before they are ever concatenated. The current parcel
 * universe publishes both the assessor neighbourhood code and the township code
 * as numeric strings; anything else is an unrecognised locality and refuses,
 * rather than being escaped and sent.
 */
function parseLocalityCode(value: unknown): string | null {
  const text = asText(value)
  return /^\d{1,10}$/.test(text) ? text : null
}

/**
 * Class 2 residential, excluding class 299 condominiums.
 *
 * 299 is excluded at the source because Cook County publishes no improvement
 * characteristics for condominiums at all — there is no building area to divide
 * by — so including them would guarantee an incomplete pool for every subject.
 * This is the same operational non-condominium filter the official revalidation
 * used. It is a coverage fact about the published data, not a narrowing of the
 * pool toward the subject.
 */
function isClass2NonCondo(propertyClass: string): boolean {
  return /^2\d{2}$/.test(propertyClass) && propertyClass !== "299"
}

/** The injected clock's calendar year in America/Chicago, where the roll happens. */
function chicagoCalendarYear(at: Date): number | null {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) return null
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
  }).format(at)
  const year = Number(formatted)
  return Number.isFinite(year) ? year : null
}

/**
 * The internal refusal signal.
 *
 * `subreason` is carried alongside the blocker but never travels with it: the
 * blocker is returned to callers, the subreason is only ever read back by
 * [[classifyCharacteristics]] to build a count. Tagging the throw at the site
 * that decides it is what keeps the diagnostics from drifting away from the
 * rules they describe — there is no second copy of the predicates to fall out of
 * step, because the classifier runs the validator itself.
 */
class CountyRefusal extends Error {
  constructor(
    readonly blocker: CountyGatewayBlocker,
    readonly subreason?: CountyCharacteristicsSubreason,
  ) {
    super(blocker)
    this.name = "CountyRefusal"
  }
}

/* ------------------------------------------------------------- the requester */

/**
 * Build a SoQL URL with a fixed parameter order, so the URL recorded in the
 * source manifest is reproducible from the same inputs.
 */
function socrataUrl(
  datasetId: string,
  params: { select: string; where: string; order?: string; limit?: number; offset?: number },
): string {
  const search = new URLSearchParams()
  search.set("$select", params.select)
  search.set("$where", params.where)
  // Ordering is always by parcel identity. There is no configuration point here
  // through which a value-ordered read could be introduced.
  if (params.order) search.set("$order", params.order)
  if (params.limit != null) search.set("$limit", String(params.limit))
  if (params.offset != null) search.set("$offset", String(params.offset))
  return `${SOCRATA_ORIGIN}/resource/${datasetId}.json?${search.toString()}`
}

type DatasetRef = { id: string; title: string }

/**
 * The public-data request helper.
 *
 * GET only, HTTPS only, one pinned host, no credentials and no cookies, no
 * cache, redirects rejected rather than followed, a bounded per-request timeout,
 * a bounded body enforced WHILE the body is read, and a bounded window for the
 * retrieval as a whole. Every response is hashed and recorded as its own source
 * receipt keyed to the exact page URL that produced it — a single dataset URL
 * standing in for a set of paged responses would claim provenance the bytes do
 * not have.
 */
class CountyReader {
  private requests = 0
  private readonly startedAtMs: number
  private lastClockMs: number
  readonly receipts: SourceRecord[] = []

  constructor(private readonly deps: CountyGatewayDeps) {
    const started = this.readClock()
    this.startedAtMs = started
    this.lastClockMs = started
  }

  private readClock(): number {
    const now = this.deps.now()
    const ms = now instanceof Date ? now.getTime() : Number.NaN
    if (!Number.isFinite(ms)) throw new CountyRefusal("COUNTY_CLOCK_UNRELIABLE")
    return ms
  }

  /**
   * One clock reading, checked for monotonicity and against the retrieval
   * window. A clock that steps backwards mid-retrieval makes every "retrieved
   * at" ordering claim in the receipts meaningless, so it refuses rather than
   * recording timestamps it cannot justify.
   */
  private tick(): Date {
    const ms = this.readClock()
    if (ms < this.lastClockMs) throw new CountyRefusal("COUNTY_CLOCK_UNRELIABLE")
    this.lastClockMs = ms
    if (ms - this.startedAtMs > MAX_RETRIEVAL_WINDOW_MS) {
      throw new CountyRefusal("COUNTY_RETRIEVAL_WINDOW_EXCEEDED")
    }
    return new Date(ms)
  }

  /** Called once the assembly is complete, so a slow tail cannot escape the window. */
  finish(): void {
    this.tick()
  }

  private async readBounded(response: CountyResponse): Promise<string> {
    const body = response.body
    if (!body || typeof body.getReader !== "function") {
      // A response modelled as a whole string — injected test doubles, and any
      // runtime that does not expose a stream. Still bounded, just after the
      // fact rather than during.
      const text = await response.text()
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new CountyRefusal("COUNTY_SOURCE_UNAVAILABLE")
      }
      return text
    }

    // The production path. The bound is enforced as bytes arrive and the
    // transfer is cancelled on overrun, so an unbounded or hostile response
    // cannot be buffered into this process first and measured afterwards.
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel("response exceeds the bounded size")
        throw new CountyRefusal("COUNTY_SOURCE_UNAVAILABLE")
      }
      chunks.push(value)
    }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    // Reject malformed encoding rather than hashing replacement characters as source bytes.
    if (!isUtf8(bytes)) throw new CountyRefusal("COUNTY_SOURCE_UNAVAILABLE")
    return bytes.toString("utf8")
  }

  async rows(
    dataset: DatasetRef,
    url: string,
    maxRows: number,
  ): Promise<Array<Record<string, unknown>>> {
    if (this.requests >= MAX_REQUESTS) throw new CountyRefusal("COUNTY_REQUEST_BUDGET_EXCEEDED")
    this.requests += 1
    // Checked BEFORE the request, so a retrieval that has already run long does
    // not start yet another call whose result it could not honestly date.
    const requestAt = this.tick()

    if (!url.startsWith(`${SOCRATA_ORIGIN}/`)) throw new CountyRefusal("COUNTY_SOURCE_UNAVAILABLE")

    const controller = new AbortController()
    const remainingMs = MAX_RETRIEVAL_WINDOW_MS - (requestAt.getTime() - this.startedAtMs)
    if (remainingMs <= 0) throw new CountyRefusal("COUNTY_RETRIEVAL_WINDOW_EXCEEDED")
    // This signal remains active through streamed body reads, not just headers.
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remainingMs))
    let body: string
    try {
      const response = await this.deps.fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
      })
      // `redirect: "error"` should already have rejected, but a fetch
      // implementation that merely reports the hop must not slip past.
      if (!response.ok || response.status !== 200 || response.redirected === true) {
        throw new CountyRefusal("COUNTY_SOURCE_UNAVAILABLE")
      }
      body = await this.readBounded(response)
    } catch (error) {
      throw error instanceof CountyRefusal ? error : new CountyRefusal("COUNTY_SOURCE_UNAVAILABLE")
    } finally {
      clearTimeout(timer)
    }

    // The receipt is dated when the bytes were actually in hand, and is recorded
    // before the body is interpreted: a response that fails to parse still
    // happened, and the manifest should say so.
    this.receipts.push({
      datasetId: dataset.id,
      datasetTitle: dataset.title,
      url,
      retrievedAt: rfc3339Utc(this.tick()),
      contentSha256: sha256Hex(body),
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new CountyRefusal("COUNTY_SOURCE_UNAVAILABLE")
    }
    if (!Array.isArray(parsed)) throw new CountyRefusal("COUNTY_SOURCE_UNAVAILABLE")
    // More rows than were asked for means the read is not the read that was
    // requested, so nothing downstream can rely on its bounds.
    if (parsed.length > maxRows) throw new CountyRefusal("CANDIDATE_POOL_UNSTABLE")
    return parsed as Array<Record<string, unknown>>
  }

  async count(dataset: DatasetRef, where: string): Promise<number> {
    const rows = await this.rows(
      dataset,
      socrataUrl(dataset.id, { select: "count(1) as n", where }),
      1,
    )
    const value = rows.length === 1 ? asExactInteger(rows[0].n) : null
    if (value === null || value < 0) throw new CountyRefusal("CANDIDATE_POOL_UNSTABLE")
    return value
  }

  /**
   * Complete, stably ordered pagination.
   *
   * The row count is taken before and after the page walk and both must agree
   * with the number of rows actually collected. A pool larger than the bound is
   * rejected, never truncated. See the module note on what these checks do and
   * do not establish — they are stability evidence, not a snapshot guarantee.
   */
  async allPages(
    dataset: DatasetRef,
    select: string,
    where: string,
  ): Promise<Array<Record<string, unknown>>> {
    const expected = await this.count(dataset, where)
    if (expected > POOL_MAX_ROWS) throw new CountyRefusal("CANDIDATE_POOL_TOO_LARGE")

    const collected: Array<Record<string, unknown>> = []
    for (let offset = 0; ; offset += POOL_PAGE_SIZE) {
      if (offset > POOL_MAX_ROWS) throw new CountyRefusal("CANDIDATE_POOL_TOO_LARGE")
      const page = await this.rows(
        dataset,
        socrataUrl(dataset.id, { select, where, order: "pin", limit: POOL_PAGE_SIZE, offset }),
        POOL_PAGE_SIZE,
      )
      collected.push(...page)
      // A count that under-reported the result set is caught here rather than by
      // silently keeping the first `POOL_MAX_ROWS` rows.
      if (collected.length > POOL_MAX_ROWS) throw new CountyRefusal("CANDIDATE_POOL_TOO_LARGE")
      // A short page is the end of the result set. A full page is not, so the
      // walk continues rather than stopping at whatever the bound happened to be.
      if (page.length < POOL_PAGE_SIZE) break
    }

    const after = await this.count(dataset, where)
    if (after !== expected || collected.length !== expected) {
      throw new CountyRefusal("CANDIDATE_POOL_UNSTABLE")
    }
    return collected
  }

  /**
   * Join a known PIN set against a dataset in bounded chunks.
   *
   * The predicate is parcel identity and tax year only. Each chunk's rows are
   * validated against THAT CHUNK's requested PIN set rather than against the
   * global set, so a source that answers one chunk with another chunk's rows
   * cannot be reassembled into a plausible-looking whole.
   */
  async byPins(
    dataset: DatasetRef,
    select: string,
    pins: ReadonlyArray<string>,
    ambiguous: CountyGatewayBlocker,
  ): Promise<Map<string, Array<Record<string, unknown>>>> {
    const grouped = new Map<string, Array<Record<string, unknown>>>()
    for (let i = 0; i < pins.length; i += JOIN_CHUNK_SIZE) {
      const chunk = pins.slice(i, i + JOIN_CHUNK_SIZE)
      const chunkSet = new Set(chunk)
      const list = chunk.map((pin) => `'${pin}'`).join(",")
      const where = `year=${OFFICIAL_TAX_YEAR} AND pin in (${list})`
      // A PIN may legitimately carry several improvement rows, so the per-chunk
      // bound allows for that and the per-PIN arity is judged by the caller. A
      // response at the bound is rejected rather than accepted as complete.
      const maxRows = JOIN_CHUNK_SIZE * 8
      const page = await this.rows(
        dataset,
        socrataUrl(dataset.id, { select, where, order: "pin", limit: maxRows }),
        maxRows,
      )
      if (page.length >= maxRows) throw new CountyRefusal(ambiguous)
      for (const row of page) {
        const pin = parseSourcePin(row.pin)
        if (!pin || !chunkSet.has(pin)) throw new CountyRefusal(ambiguous)
        const existing = grouped.get(pin)
        if (existing) existing.push(row)
        else grouped.set(pin, [row])
      }
    }
    return grouped
  }
}

/* ------------------------------------------------------ row-level validation */

/** Every row on every dataset must carry the tax year that was asked for. */
function requireTaxYear(row: Record<string, unknown>): void {
  if (asExactInteger(row.year) !== OFFICIAL_TAX_YEAR) {
    throw new CountyRefusal("COUNTY_RESPONSE_YEAR_MISMATCH")
  }
}

type LocalityKeys = { neighborhoodCode: string; townshipCode: string }

type CharacteristicsRow = {
  propertyClass: string
  buildingSqft: number
  yearBuilt: number
  residentialSubtype: string
}

/**
 * Reduce a PIN's improvement rows to the one complete, unambiguous record the
 * packet can use, or refuse.
 *
 * The single-improvement conditions are the county's own multi-card and
 * multi-land markers, applied as the 1,200-PIN study applied them and then
 * tightened: each marker must be explicitly present and explicitly singular. A
 * PIN with more than one improvement row, an absent marker, or a tieback to
 * another parcel has no single building area to divide by. That is an ambiguity
 * in the official record, and the packet's arithmetic is not defined over it.
 *
 * `tieback_key_pin` and the two proration rates are read conservatively: a
 * tieback naming a DIFFERENT parcel, or any proration rate that is present and
 * not exactly 1, means this row describes a share of a larger improvement rather
 * than a whole one. Their ABSENCE is permitted — the county leaves them empty
 * for ordinary single-parcel improvements, which are the overwhelming majority —
 * and that permission is deliberate and recorded here rather than silent.
 */
function readCharacteristics(
  rows: ReadonlyArray<Record<string, unknown>>,
  pin: string,
  locality: LocalityKeys,
): CharacteristicsRow {
  // Both arities refuse identically, as they always have; they are separated
  // here only so the internal diagnostics can tell "the county published nothing
  // for this parcel" from "the county published two things for it".
  if (rows.length === 0) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "MISSING_ROWS")
  }
  if (rows.length > 1) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "DUPLICATE_ROW_ARITY")
  }
  const row = rows[0]
  requireTaxYear(row)

  // The join carries a township; it must be the subject's. The same assessor
  // neighbourhood code can appear under more than one township.
  if (asText(row.township_code) !== locality.townshipCode) {
    throw new CountyRefusal("CANDIDATE_LOCALITY_MISMATCH")
  }

  // One combined condition, evaluated one marker at a time so each carries its
  // own name. The blocker, and the order in which a parcel is rejected, are
  // exactly what they were when this was a single expression.
  if (row.pin_num_cards == null || (typeof row.pin_num_cards === "string" && row.pin_num_cards.trim() === "")) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "CARDS_MISSING")
  }
  if (asExactInteger(row.pin_num_cards) !== 1) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "CARDS_NOT_SINGLE")
  }
  if (row.pin_num_landlines == null || (typeof row.pin_num_landlines === "string" && row.pin_num_landlines.trim() === "")) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "LANDLINES_MISSING")
  }
  if (asExactInteger(row.pin_num_landlines) !== 1) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "LANDLINES_NOT_SINGLE")
  }
  if (row.pin_is_multiland == null || (typeof row.pin_is_multiland === "string" && row.pin_is_multiland.trim() === "")) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "MULTILAND_MISSING")
  }
  if (!isExplicitlyFalse(row.pin_is_multiland)) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "MULTILAND_NOT_FALSE")
  }

  const tieback = asText(row.tieback_key_pin)
  if (tieback !== "" && tieback.replace(/-/g, "") !== pin) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "FOREIGN_TIEBACK")
  }
  for (const rate of [row.tieback_proration_rate, row.card_proration_rate]) {
    if (asText(rate) === "") continue
    if (asExactDecimal(rate) !== 1) {
      throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_AMBIGUOUS", "NON_UNIT_PRORATION")
    }
  }

  // No imputation: every feature the selector reads must be published, and
  // published as something the arithmetic is defined over.
  const buildingSqft = asExactDecimal(row.char_bldg_sf)
  const yearBuilt = asExactInteger(row.char_yrblt)
  const residentialSubtype = asText(row.char_type_resd)
  const propertyClass = asText(row.class)
  if (
    buildingSqft === null ||
    buildingSqft <= 0 ||
    yearBuilt === null ||
    yearBuilt <= 1700 ||
    // A building cannot have been built after the year being assessed, and a
    // fractional year is not a year. Either means the column is not what it says.
    yearBuilt > OFFICIAL_TAX_YEAR ||
    typeof row.char_type_resd !== "string" ||
    residentialSubtype === "" ||
    propertyClass === ""
  ) {
    throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_INCOMPLETE", "INVALID_REQUIRED_FEATURES")
  }

  return { propertyClass, buildingSqft, yearBuilt, residentialSubtype }
}

/** The two blockers [[readCharacteristics]] and its arity guard can produce. */
const CHARACTERISTICS_BLOCKERS: ReadonlySet<CountyGatewayBlocker> = new Set([
  "CANDIDATE_CHARACTERISTICS_INCOMPLETE",
  "CANDIDATE_CHARACTERISTICS_AMBIGUOUS",
])

/**
 * Why ONE parcel's improvement rows are unusable, or `null` if they are fine.
 *
 * The classifier is the validator: it runs [[readCharacteristics]] unchanged and
 * reads back the subreason the refusal carried. Nothing is re-implemented, so no
 * criterion can be relaxed here without relaxing the retrieval itself, and no
 * count can describe a rule the retrieval does not actually apply.
 *
 * A parcel that refuses for a reason outside this vocabulary — a mismatched tax
 * year, another township's row — carries no subreason and is not counted. Those
 * are different blockers with their own refusals; folding them into a
 * characteristics tally would misattribute them.
 */
function classifyCharacteristics(
  rows: ReadonlyArray<Record<string, unknown>>,
  pin: string,
  locality: LocalityKeys,
): CountyCharacteristicsSubreason | null {
  try {
    readCharacteristics(rows, pin, locality)
    return null
  } catch (error) {
    return error instanceof CountyRefusal ? (error.subreason ?? null) : null
  }
}

/**
 * Count why a neighbourhood's improvement records refused, over the rows ALREADY
 * IN HAND.
 *
 * This issues no request and reads no dataset the retrieval had not already
 * fetched and paid for: `charsByPin` is the completed characteristics join, and
 * `pins` is the pool it was joined against. A parcel absent from the map is
 * counted as [[MISSING_ROWS]] via the same empty-rows path the validator takes.
 *
 * Each parcel contributes exactly one subreason — the first one that refuses it,
 * in the validator's own order — so the counts total the number of parcels the
 * improvement record cannot describe, and never double-count one parcel that is
 * wrong in several ways at once.
 */
function countCharacteristicsSubreasons(
  pins: ReadonlyArray<string>,
  charsByPin: ReadonlyMap<string, Array<Record<string, unknown>>>,
  locality: LocalityKeys,
): Record<CountyCharacteristicsSubreason, number> {
  const counts = Object.fromEntries(
    CHARACTERISTICS_SUBREASONS.map((subreason) => [subreason, 0]),
  ) as Record<CountyCharacteristicsSubreason, number>

  for (const pin of pins) {
    const subreason = classifyCharacteristics(charsByPin.get(pin) ?? [], pin, locality)
    if (subreason) counts[subreason] += 1
  }
  return counts
}

/**
 * Hand the counts to the internal observer, if there is one, and never let it
 * matter.
 *
 * The refusal is already decided by the time this runs and is rethrown by the
 * caller regardless, so the only way an observer could affect a packet is by
 * escaping — a synchronous throw, or a rejected promise surfacing as an
 * unhandled rejection. Both are absorbed here. A diagnostic that can break a
 * retrieval is worse than no diagnostic.
 */
function reportCharacteristicsDiagnostics(
  observe: CountyRefusalObserver | undefined,
  blocker: CountyGatewayBlocker,
  pins: ReadonlyArray<string>,
  charsByPin: ReadonlyMap<string, Array<Record<string, unknown>>>,
  locality: LocalityKeys,
): void {
  if (!observe) return
  try {
    const returned: unknown = observe({
      blocker,
      subreasonCounts: countCharacteristicsSubreasons(pins, charsByPin, locality),
    })
    if (typeof (returned as PromiseLike<void> | undefined)?.then === "function") {
      void Promise.resolve(returned).catch(() => {})
    }
  } catch {
    // Deliberately swallowed. See the note above.
  }
}

/** The mailed total for the exact year, or a refusal. Never certified, never board. */
function readMailedTotal(
  rows: ReadonlyArray<Record<string, unknown>>,
  locality: LocalityKeys,
): { propertyClass: string; mailedTotal: number } {
  if (rows.length !== 1) throw new CountyRefusal("CANDIDATE_ASSESSED_VALUE_AMBIGUOUS")
  const row = rows[0]
  requireTaxYear(row)

  // This dataset publishes both locality keys, so both are checked against the
  // universe rather than assumed from the query that asked for the PIN.
  if (
    asText(row.township_code) !== locality.townshipCode ||
    asText(row.nbhd) !== locality.neighborhoodCode
  ) {
    throw new CountyRefusal("CANDIDATE_LOCALITY_MISMATCH")
  }

  const mailedTotal = asExactDecimal(row.mailed_tot)
  const propertyClass = asText(row.class)
  if (mailedTotal === null || mailedTotal <= 0 || propertyClass === "") {
    throw new CountyRefusal("CANDIDATE_ASSESSED_VALUE_INCOMPLETE")
  }
  return { propertyClass, mailedTotal }
}

/**
 * The published street address for the exact year, or a refusal.
 *
 * This dataset carries no township and no neighbourhood, so none is checked and
 * none is inferred: it contributes an address and nothing else.
 */
function readAddress(rows: ReadonlyArray<Record<string, unknown>>): {
  address: string
  city: string
} {
  if (rows.length !== 1) throw new CountyRefusal("CANDIDATE_ADDRESS_AMBIGUOUS")
  const row = rows[0]
  requireTaxYear(row)

  const address = asText(row.prop_address_full)
  const city = asText(row.prop_address_city_name)
  const state = asText(row.prop_address_state).toUpperCase()
  if (typeof row.prop_address_full !== "string" || typeof row.prop_address_city_name !== "string" || address === "" || city === "" || state !== OFFICIAL_ADDRESS_STATE) {
    throw new CountyRefusal("CANDIDATE_ADDRESS_INCOMPLETE")
  }
  return { address, city }
}

/* ------------------------------------------------------------- the retrieval */

/**
 * Retrieve and assemble the complete official evidence for one parcel.
 *
 * Reusable on its own, and the only place any of this is implemented:
 * [[loadOfficialCountyData]] is a thin producer-facing wrapper around it.
 */
export async function fetchCountyEvidence(
  order: CountyOrderIdentity,
  deps: CountyGatewayDeps = defaultDeps(),
): Promise<CountyEvidenceResult> {
  let reader: CountyReader
  try {
    reader = new CountyReader(deps)
  } catch (error) {
    const blocker = error instanceof CountyRefusal ? error.blocker : "COUNTY_SOURCE_UNAVAILABLE"
    return { ok: false, blocker, sources: [] }
  }
  try {
    const evidence = await assemble(reader, order, deps)
    return { ok: true, evidence, sources: reader.receipts }
  } catch (error) {
    if (error instanceof CountyRefusal) {
      return { ok: false, blocker: error.blocker, sources: reader.receipts }
    }
    return { ok: false, blocker: "COUNTY_SOURCE_UNAVAILABLE", sources: reader.receipts }
  }
}

async function assemble(
  reader: CountyReader,
  order: CountyOrderIdentity,
  deps: CountyGatewayDeps,
): Promise<CountyEvidence> {
  // 1. The tax year is verified against the clock before anything is requested.
  //    A rollover must refuse, not read a year nobody validated.
  const calendarYear = chicagoCalendarYear(deps.now())
  if (calendarYear === null || calendarYear !== OFFICIAL_TAX_YEAR) {
    throw new CountyRefusal("COUNTY_TAX_YEAR_UNVERIFIED")
  }

  const subjectPin = parseOrderPin(order.propertyPin ?? "")
  if (!subjectPin) throw new CountyRefusal("SUBJECT_PIN_INVALID")

  // 2. The subject's parcel record: locality, class and township, for the exact
  //    year. Exactly one row, or the parcel's identity is not established.
  const universe = COUNTY_DATASETS.parcelUniverse
  const subjectRows = await reader.rows(
    universe,
    socrataUrl(universe.id, {
      select: universe.select,
      where: `year=${OFFICIAL_TAX_YEAR} AND pin='${subjectPin}'`,
      order: "pin",
      limit: 2,
    }),
    2,
  )
  if (subjectRows.length === 0) throw new CountyRefusal("SUBJECT_PARCEL_NOT_FOUND")
  if (subjectRows.length > 1) throw new CountyRefusal("SUBJECT_PARCEL_AMBIGUOUS")
  const subjectParcel = subjectRows[0]
  requireTaxYear(subjectParcel)

  // The row that came back must be the row that was asked for. A filter is a
  // request, not a promise.
  if (parseSourcePin(subjectParcel.pin) !== subjectPin) {
    throw new CountyRefusal("SUBJECT_PARCEL_AMBIGUOUS")
  }

  const subjectClass = asText(subjectParcel.class)
  if (!isClass2NonCondo(subjectClass)) throw new CountyRefusal("SUBJECT_CLASS_OUT_OF_SCOPE")

  const neighborhoodCode = parseLocalityCode(subjectParcel.nbhd_code)
  if (asText(subjectParcel.nbhd_code) === "") {
    throw new CountyRefusal("SUBJECT_NEIGHBORHOOD_UNAVAILABLE")
  }
  const townshipCode = parseLocalityCode(subjectParcel.township_code)
  if (!neighborhoodCode || !townshipCode) {
    throw new CountyRefusal("SUBJECT_LOCALITY_UNRECOGNIZED")
  }
  const locality: LocalityKeys = { neighborhoodCode, townshipCode }

  // 3. The township the order was sold against must be the township the county
  //    records for the parcel: the filing window in the packet is a township
  //    fact, and a packet carrying another township's window is wrong even if
  //    every figure in it is right.
  const townshipName = asText(subjectParcel.township_name)
  if (
    townshipName === "" ||
    townshipKeyFromName(townshipName) !== townshipKeyFromName(order.township ?? "")
  ) {
    throw new CountyRefusal("SUBJECT_TOWNSHIP_MISMATCH")
  }

  // 4. The WHOLE class-2 non-condominium pool of the subject's neighbourhood AND
  //    township, from the parcel universe rather than the assessed-value
  //    dataset: the latter omits parcels that carry no mailed value, so reading
  //    the pool from it would silently define the neighbourhood as "parcels that
  //    happen to have a value", which is exactly the kind of invisible narrowing
  //    the pool digest exists to rule out.
  const poolWhere =
    `year=${OFFICIAL_TAX_YEAR} AND nbhd_code='${neighborhoodCode}' ` +
    `AND township_code='${townshipCode}' AND starts_with(class, '2') AND class != '299'`
  const poolRows = await reader.allPages(universe, universe.select, poolWhere)
  if (poolRows.length === 0) throw new CountyRefusal("CANDIDATE_POOL_EMPTY")

  const poolClassByPin = new Map<string, string>()
  let previousPin = ""
  for (const row of poolRows) {
    requireTaxYear(row)
    const pin = parseSourcePin(row.pin)
    const rowClass = asText(row.class)
    // Every condition that was sent is re-checked on what came back, and the
    // parcel order is required to be strictly ascending across the whole walk:
    // pagination by offset over an unordered or re-ordered result set silently
    // skips and repeats rows.
    if (!pin || poolClassByPin.has(pin) || pin <= previousPin) {
      throw new CountyRefusal("CANDIDATE_POOL_UNSTABLE")
    }
    if (!isClass2NonCondo(rowClass)) throw new CountyRefusal("CANDIDATE_POOL_UNSTABLE")
    if (
      asText(row.nbhd_code) !== neighborhoodCode ||
      asText(row.township_code) !== townshipCode ||
      asText(row.township_name) !== townshipName
    ) {
      throw new CountyRefusal("CANDIDATE_LOCALITY_MISMATCH")
    }
    previousPin = pin
    poolClassByPin.set(pin, rowClass)
  }

  // 5. The subject's own pool row must agree with the row read in step 2 — not
  //    merely exist. Two reads of one parcel that disagree about its class or
  //    its locality are two different parcels as far as the packet is concerned.
  const subjectPoolClass = poolClassByPin.get(subjectPin)
  if (subjectPoolClass === undefined) throw new CountyRefusal("CANDIDATE_POOL_UNSTABLE")
  if (subjectPoolClass !== subjectClass) throw new CountyRefusal("SUBJECT_RECORD_INCONSISTENT")

  const pins = [...poolClassByPin.keys()].sort()
  const pinCount = pins.length

  // 6. The joins. Every pooled parcel must resolve, on all three datasets, to
  //    exactly one complete unambiguous record. Nothing is dropped and nothing
  //    is synthesised: an unavailable record refuses the whole retrieval,
  //    because a pool quietly missing its unavailable members is not the
  //    neighbourhood the packet says it is.
  const chars = COUNTY_DATASETS.characteristics
  const charsByPin = await reader.byPins(
    chars,
    chars.select,
    pins,
    "CANDIDATE_CHARACTERISTICS_AMBIGUOUS",
  )

  const comparableCandidates: ComparableMatchAttributes[] = []
  const comparableAssessedValues = new Map<string, number>()
  const comparableAddresses = new Map<string, string>()
  let subjectCharacteristics: CharacteristicsRow | null = null
  let subjectAddress: { address: string; city: string } | null = null

  // Everything that can refuse on the strength of the characteristics join runs
  // inside this block, so a characteristics refusal can be described in counts
  // before it is rethrown unchanged.
  //
  // The refusal itself is untouched: the same blocker, on the same parcel, after
  // the same requests in the same order. Only the internal observer learns
  // anything extra, and only ever as totals. The one characteristics blocker not
  // reachable here is `byPins`'s own chunk-integrity guard above — it refuses a
  // source that answered with parcels nobody asked for, which is a fact about
  // the response rather than about any parcel's record, and it throws before
  // there is a join to count.
  try {
    if (charsByPin.size !== pinCount) {
      throw new CountyRefusal("CANDIDATE_CHARACTERISTICS_INCOMPLETE")
    }

    const values = COUNTY_DATASETS.assessedValues
    const valuesByPin = await reader.byPins(
      values,
      values.select,
      pins,
      "CANDIDATE_ASSESSED_VALUE_AMBIGUOUS",
    )
    if (valuesByPin.size !== pinCount) throw new CountyRefusal("CANDIDATE_ASSESSED_VALUE_INCOMPLETE")

    const addresses = COUNTY_DATASETS.addresses
    const addressesByPin = await reader.byPins(
      addresses,
      addresses.select,
      pins,
      "CANDIDATE_ADDRESS_AMBIGUOUS",
    )
    if (addressesByPin.size !== pinCount) throw new CountyRefusal("CANDIDATE_ADDRESS_INCOMPLETE")

    for (const pin of pins) {
      const characteristics = readCharacteristics(charsByPin.get(pin) ?? [], pin, locality)
      const { propertyClass: valueClass, mailedTotal } = readMailedTotal(
        valuesByPin.get(pin) ?? [],
        locality,
      )
      const address = readAddress(addressesByPin.get(pin) ?? [])
      const universeClass = poolClassByPin.get(pin) ?? ""

      // Three datasets each publish the class. They have to agree, or the parcel's
      // classification — the thing Rule 15 requires comparables to share — is not
      // established by the record.
      if (characteristics.propertyClass !== universeClass || valueClass !== universeClass) {
        throw new CountyRefusal("CANDIDATE_CLASS_AMBIGUOUS")
      }

      comparableCandidates.push({
        pin,
        neighborhoodCode,
        propertyClass: universeClass,
        residentialSubtype: characteristics.residentialSubtype,
        buildingSqft: characteristics.buildingSqft,
        yearBuilt: characteristics.yearBuilt,
      })
      comparableAssessedValues.set(pin, mailedTotal)
      comparableAddresses.set(pin, address.address)
      if (pin === subjectPin) {
        subjectCharacteristics = characteristics
        subjectAddress = address
      }
    }
  } catch (error) {
    if (error instanceof CountyRefusal && CHARACTERISTICS_BLOCKERS.has(error.blocker)) {
      reportCharacteristicsDiagnostics(
        deps.observeRefusalDiagnostics,
        error.blocker,
        pins,
        charsByPin,
        locality,
      )
    }
    throw error
  }

  if (!subjectCharacteristics || !subjectAddress) {
    throw new CountyRefusal("CANDIDATE_POOL_UNSTABLE")
  }
  const subjectMailedTotal = comparableAssessedValues.get(subjectPin)
  if (subjectMailedTotal == null) throw new CountyRefusal("CANDIDATE_POOL_UNSTABLE")

  const subject: SubjectRecord = {
    pin: subjectPin,
    address: subjectAddress.address,
    city: subjectAddress.city,
    township: townshipName,
    neighborhoodCode,
    propertyClass: subjectClass,
    residentialSubtype: subjectCharacteristics.residentialSubtype,
    buildingSqft: subjectCharacteristics.buildingSqft,
    yearBuilt: subjectCharacteristics.yearBuilt,
    assessedTotalValue: subjectMailedTotal,
    assessmentStage: OFFICIAL_ASSESSMENT_STAGE,
    taxYear: OFFICIAL_TAX_YEAR,
    // Established by the single-card, single-landline, no-foreign-tieback
    // improvement check in [[readCharacteristics]] — never from the card count
    // on its own.
    pinCount: 1,
    // Every dataset read here is a Cook County Assessor publication covering
    // Cook County alone, so a parcel present in them is in Cook County.
    inCookCounty: true,
  }

  // The window is checked once more now that the last byte is in: a retrieval
  // whose tail ran long is not one bounded read, whatever its individual
  // requests did.
  reader.finish()

  return {
    subject,
    comparableCandidates,
    comparableAssessedValues,
    comparableAddresses,
    sources: reader.receipts,
  }
}

/* ------------------------------------------------------------ producer entry */

/**
 * The producer-facing adapter: official county evidence, or a named refusal.
 *
 * There is no separate capability gate here. Every condition this module
 * enforces is enforced inside [[fetchCountyEvidence]], so the two callers cannot
 * drift apart.
 */
export async function loadOfficialCountyData(
  order: CountyOrderIdentity,
  deps: CountyGatewayDeps = defaultDeps(),
): Promise<CountyEvidence | CountyDataRefusal> {
  const result = await fetchCountyEvidence(order, deps)
  return result.ok ? result.evidence : { blocker: result.blocker }
}
