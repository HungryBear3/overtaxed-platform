import "server-only"

import { createHash } from "node:crypto"
import { isUtf8 } from "node:buffer"

import type { SourceRecord, SubjectRecord } from "@/lib/fulfillment/t2-artifact-content"
import type { ComparableMatchAttributes } from "@/lib/fulfillment/t2-comparables"
import { COUNTY_DATASETS, OFFICIAL_TAX_YEAR, type CountyBody } from "@/lib/fulfillment-runtime/t2-county-gateway"
import type { NeutralSourceReceipt, PublishedProration } from "@/lib/fulfillment/neutral-report-content"

const ORIGIN = "https://datacatalog.cookcountyil.gov"
const PAGE = 500
const MAX_ROWS = 5000
const MAX_BYTES = 2_000_000
const MAX_TOTAL_BYTES = 32_000_000
const MAX_REQUESTS = 200
const PIN = /^\d{14}$/

export type NeutralRawBlocker =
  | "NEUTRAL_RAW_INPUT_INVALID"
  | "NEUTRAL_RAW_SOURCE_UNAVAILABLE"
  | "NEUTRAL_RAW_RESPONSE_INVALID"
  | "NEUTRAL_RAW_IDENTITY_CONFLICT"
  | "NEUTRAL_RAW_PAGINATION_CONFLICT"
  | "NEUTRAL_RAW_INCOMPLETE"
  | "NEUTRAL_RAW_MULTI_CARD_UNSUPPORTED"

export type ExactSourcePage = Readonly<{
  receipt: NeutralSourceReceipt
  bytes: Buffer
}>

export type NeutralRawEvidence = Readonly<{
  subject: SubjectRecord
  subjectProration: PublishedProration
  candidatePool: ReadonlyArray<ComparableMatchAttributes>
  assessedValues: ReadonlyMap<string, number>
  addresses: ReadonlyMap<string, string>
  sources: ReadonlyArray<NeutralSourceReceipt>
  exactPages: ReadonlyArray<ExactSourcePage>
  dataEvidenceSha256: string
}>

type RawResponse = { ok: boolean; status: number; redirected?: boolean; url: string; headers: { get(name: string): string | null }; body?: CountyBody | null; text(): Promise<string> }
type RawFetch = (url: string, init: { method: "GET"; headers: Record<string, string>; cache: "no-store"; redirect: "error"; credentials: "omit"; signal: AbortSignal }) => Promise<RawResponse>
type NeutralRawDeps = { fetch: RawFetch; now: () => Date; deadline?: number }

type Row = Record<string, unknown>
type Dataset = { id: string; title: string; select: string }
type Role = NeutralSourceReceipt["roles"][number]

class Refusal extends Error { constructor(readonly blocker: NeutralRawBlocker) { super(blocker) } }

function sha(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex") }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
  return JSON.stringify(value)
}
function text(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return ""
  const out = String(value).trim()
  return out.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(out) ? out : ""
}
function integer(value: unknown): number | null {
  const out = text(value)
  if (!/^-?\d+(?:\.0+)?$/.test(out)) return null
  const parsed = Number(out)
  return Number.isSafeInteger(parsed) ? parsed : null
}
function decimal(value: unknown): number | null {
  const out = text(value)
  if (!/^-?\d+(?:\.\d+)?$/.test(out)) return null
  const parsed = Number(out)
  return Number.isFinite(parsed) ? parsed : null
}
function year(row: Row): void { if (integer(row.year) !== OFFICIAL_TAX_YEAR) throw new Refusal("NEUTRAL_RAW_IDENTITY_CONFLICT") }
function pin(row: Row): string { const out = text(row.pin); if (!PIN.test(out)) throw new Refusal("NEUTRAL_RAW_IDENTITY_CONFLICT"); return out }
function published(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== "string" && typeof value !== "number") throw new Refusal("NEUTRAL_RAW_RESPONSE_INVALID")
  const out = String(value)
  if (out.length > 64 || /[\p{Cc}\p{Cf}]/u.test(out)) throw new Refusal("NEUTRAL_RAW_RESPONSE_INVALID")
  return out
}
function query(dataset: Dataset, where: string, limit: number, offset: number): string {
  const p = new URLSearchParams()
  p.set("$select", dataset.select); p.set("$where", where); p.set("$order", "pin"); p.set("$limit", String(limit)); p.set("$offset", String(offset))
  p.sort()
  return `${ORIGIN}/resource/${dataset.id}.json?${p.toString()}`
}

class Reader {
  readonly pages: ExactSourcePage[] = []
  private requests = 0
  private cumulativeBytes = 0
  private readonly started: number
  private last: number
  constructor(private readonly deps: NeutralRawDeps, private readonly subjectPin: string) { this.started = this.tickRaw(); this.last = this.started }
  private tickRaw(): number { const value = this.deps.now().getTime(); if (!Number.isFinite(value)) throw new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE"); return value }
  private tick(): Date { const value = this.tickRaw(); if (value < this.last || value - this.started > 120_000) throw new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE"); this.last = value; return new Date(value) }
  private async bytes(response: RawResponse, signal: AbortSignal): Promise<Buffer> {
    if (!response.body) {
      const out = Buffer.from(await response.text(), "utf8")
      if (out.length > MAX_BYTES) throw new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE")
      this.cumulativeBytes += out.length
      if (this.cumulativeBytes > MAX_TOTAL_BYTES) throw new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE")
      return out
    }
    const reader = response.body.getReader(); const chunks: Buffer[] = []; let total = 0
    const abort = new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
    try { for (;;) { const next = await Promise.race([reader.read(), abort]); if (next.done) break; if (!next.value) continue; total += next.value.length; if (total > MAX_BYTES) throw new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE"); chunks.push(Buffer.from(next.value)) } }
    catch (error) { await reader.cancel("neutral raw refused").catch(() => {}); throw error }
    const out = Buffer.concat(chunks)
    this.cumulativeBytes += out.length
    if (this.cumulativeBytes > MAX_TOTAL_BYTES) throw new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE")
    if (!isUtf8(out)) throw new Refusal("NEUTRAL_RAW_RESPONSE_INVALID")
    return out
  }
  async one(dataset: Dataset, url: string, roles: Role[], maxRows: number): Promise<Row[]> {
    if (++this.requests > MAX_REQUESTS || !url.startsWith(`${ORIGIN}/resource/${dataset.id}.json?`)) throw new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE")
    const remaining = this.deps.deadline == null ? 15_000 : this.deps.deadline - this.tickRaw()
    if (remaining <= 0) throw new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE")
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.min(15_000, remaining))
    let response: RawResponse; let bytes: Buffer
    try {
      this.tick()
      response = await this.deps.fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", credentials: "omit", signal: controller.signal })
      if (!response.ok || response.status !== 200 || response.redirected || response.url !== url || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE")
      bytes = await this.bytes(response, controller.signal)
      this.tick()
    } catch (error) { throw error instanceof Refusal ? error : new Refusal("NEUTRAL_RAW_SOURCE_UNAVAILABLE") } finally { clearTimeout(timer) }
    let parsed: unknown
    try { parsed = JSON.parse(bytes.toString("utf8")) } catch { throw new Refusal("NEUTRAL_RAW_RESPONSE_INVALID") }
    if (!Array.isArray(parsed) || parsed.length > maxRows || parsed.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Refusal("NEUTRAL_RAW_RESPONSE_INVALID")
    const now = this.tick()
    const receipt: NeutralSourceReceipt = Object.freeze({ datasetId: dataset.id, datasetTitle: dataset.title, url, retrievedAt: now.toISOString(), contentSha256: sha(bytes), roles: Object.freeze([...roles]), subjectPin: this.subjectPin, taxYear: OFFICIAL_TAX_YEAR })
    this.pages.push(Object.freeze({ receipt, bytes: Buffer.from(bytes) }))
    return parsed as Row[]
  }
  async all(dataset: Dataset, where: string, roles: Role[]): Promise<Row[]> {
    const out: Row[] = []; let previous = ""
    for (let offset = 0; ; offset += PAGE) {
      const rows = await this.one(dataset, query(dataset, where, PAGE, offset), roles, PAGE)
      for (const row of rows) { year(row); const current = pin(row); if (current <= previous) throw new Refusal("NEUTRAL_RAW_PAGINATION_CONFLICT"); previous = current; out.push(row); if (out.length > MAX_ROWS) throw new Refusal("NEUTRAL_RAW_PAGINATION_CONFLICT") }
      if (rows.length < PAGE) break
    }
    return out
  }
  async forPins(dataset: Dataset, pins: string[], roles: Role[]): Promise<Row[]> {
    const out: Row[] = []
    for (let start = 0; start < pins.length; start += 100) {
      const chunk = pins.slice(start, start + 100)
      const where = `year=${OFFICIAL_TAX_YEAR} AND pin in(${chunk.map(value => `'${value}'`).join(",")})`
      const rows = await this.all(dataset, where, roles)
      if (rows.some(row => !chunk.includes(pin(row)))) throw new Refusal("NEUTRAL_RAW_IDENTITY_CONFLICT")
      out.push(...rows)
    }
    return out
  }
}

/**
 * Dedicated neutral reader. It discloses published proration values but never
 * interprets them. Every normalized fact is parsed from retained exact bytes.
 */
async function readNeutralOfficialBytes(input: { propertyPin: string }, deps: NeutralRawDeps): Promise<{ ok: true; evidence: NeutralRawEvidence } | { ok: false; blocker: NeutralRawBlocker }> {
  if (!PIN.test(input.propertyPin)) return { ok: false, blocker: "NEUTRAL_RAW_INPUT_INVALID" }
  const subjectPin = input.propertyPin
  try {
    const reader = new Reader(deps, subjectPin)
    const universe = COUNTY_DATASETS.parcelUniverse
    const subjects = await reader.one(universe, query(universe, `year=${OFFICIAL_TAX_YEAR} AND pin='${subjectPin}'`, 2, 0), ["subject"], 2)
    if (subjects.length !== 1 || pin(subjects[0]) !== subjectPin) throw new Refusal("NEUTRAL_RAW_IDENTITY_CONFLICT")
    const subjectRow = subjects[0]; year(subjectRow)
    const propertyClass = text(subjectRow.class), townshipCode = text(subjectRow.township_code), township = text(subjectRow.township_name), neighborhoodCode = text(subjectRow.nbhd_code)
    if (!/^2\d{2}$/.test(propertyClass) || propertyClass === "299" || !/^\d{1,10}$/.test(townshipCode) || !/^\d{1,10}$/.test(neighborhoodCode) || !township) throw new Refusal("NEUTRAL_RAW_INCOMPLETE")
    const where = `year=${OFFICIAL_TAX_YEAR} AND nbhd_code='${neighborhoodCode}' AND township_code='${townshipCode}' AND starts_with(class, '2') AND class != '299'`
    const pool = await reader.all(universe, where, ["candidates"])
    if (!pool.some(row => pin(row) === subjectPin)) throw new Refusal("NEUTRAL_RAW_IDENTITY_CONFLICT")
    const pins = pool.map(pin)
    const chars = await reader.forPins(COUNTY_DATASETS.characteristics, pins, ["subject", "candidates", "proration"])
    const values = await reader.forPins(COUNTY_DATASETS.assessedValues, pins, ["subject", "assessed_values"])
    const addresses = await reader.forPins(COUNTY_DATASETS.addresses, pins, ["subject", "addresses"])
    const unique = (rows: Row[]) => { const out = new Map<string, Row>(); for (const row of rows) { const key = pin(row); if (!pins.includes(key) || out.has(key)) throw new Refusal("NEUTRAL_RAW_IDENTITY_CONFLICT"); out.set(key, row) }; if (out.size !== pins.length) throw new Refusal("NEUTRAL_RAW_INCOMPLETE"); return out }
    const byChar = unique(chars), byValue = unique(values), byAddress = unique(addresses)
    const candidates: ComparableMatchAttributes[] = []; const assessedValues = new Map<string, number>(); const addressMap = new Map<string, string>()
    for (const key of pins) {
      const u = pool.find(row => pin(row) === key)!; const c = byChar.get(key)!; const v = byValue.get(key)!; const a = byAddress.get(key)!
      for (const row of [u, c, v, a]) year(row)
      if (text(u.class) !== text(c.class) || text(u.class) !== text(v.class) || text(c.township_code) !== townshipCode || text(v.township_code) !== townshipCode || text(v.nbhd) !== neighborhoodCode) throw new Refusal("NEUTRAL_RAW_IDENTITY_CONFLICT")
      if (integer(c.pin_num_cards) !== 1) throw new Refusal("NEUTRAL_RAW_MULTI_CARD_UNSUPPORTED")
      const buildingSqft = decimal(c.char_bldg_sf), yearBuilt = integer(c.char_yrblt), subtype = text(c.char_type_resd), assessed = decimal(v.mailed_tot), address = text(a.prop_address_full), city = text(a.prop_address_city_name)
      if (!buildingSqft || !yearBuilt || !subtype || !assessed || !address || !city || text(a.prop_address_state).toUpperCase() !== "IL") throw new Refusal("NEUTRAL_RAW_INCOMPLETE")
      candidates.push({ pin: key, neighborhoodCode, propertyClass: text(u.class), residentialSubtype: subtype, buildingSqft, yearBuilt }); assessedValues.set(key, assessed); addressMap.set(key, address)
    }
    const sc = byChar.get(subjectPin)!, sv = byValue.get(subjectPin)!, sa = byAddress.get(subjectPin)!
    const subjectCandidate = candidates.find(row => row.pin === subjectPin)!
    const prorationReceipt = reader.pages.find(page => page.receipt.datasetId === COUNTY_DATASETS.characteristics.id && page.bytes.includes(Buffer.from(subjectPin)))?.receipt
    if (!prorationReceipt) throw new Refusal("NEUTRAL_RAW_INCOMPLETE")
    const prorationHash = prorationReceipt.contentSha256!
    const subjectProration: PublishedProration = Object.freeze({ pinNumCards: published(sc.pin_num_cards), tiebackKeyPin: published(sc.tieback_key_pin), tiebackProrationRate: published(sc.tieback_proration_rate), cardProrationRate: published(sc.card_proration_rate), sourceDatasetId: COUNTY_DATASETS.characteristics.id, sourceRetrievedAt: prorationReceipt.retrievedAt, sourceContentSha256: prorationHash, ambiguitySemantics: "PUBLISHED_ZERO_OR_NULL_NOT_INTERPRETED" })
    if (integer(sc.pin_num_cards) !== 1) throw new Refusal("NEUTRAL_RAW_MULTI_CARD_UNSUPPORTED")
    const subject: SubjectRecord = Object.freeze({ ...subjectCandidate, address: addressMap.get(subjectPin)!, city: text(sa.prop_address_city_name), township, assessedTotalValue: decimal(sv.mailed_tot)!, assessmentStage: "mailed", taxYear: OFFICIAL_TAX_YEAR, pinCount: 1, inCookCounty: true })
    const exactPages = Object.freeze(reader.pages.map(page => Object.freeze({ receipt: page.receipt, bytes: Buffer.from(page.bytes) })))
    const sources = Object.freeze(exactPages.map(page => page.receipt))
    const dataEvidenceSha256 = sha(canonical(exactPages.map(page => ({ receipt: page.receipt, bytesSha256: sha(page.bytes) }))))
    return { ok: true, evidence: Object.freeze({ subject, subjectProration, candidatePool: Object.freeze(candidates), assessedValues, addresses: addressMap, sources, exactPages, dataEvidenceSha256 }) }
  } catch (error) { return { ok: false, blocker: error instanceof Refusal ? error.blocker : "NEUTRAL_RAW_SOURCE_UNAVAILABLE" } }
}

/** Production reader: transport and clock are owned here, never caller injected. */
export async function readNeutralOfficialBytesRuntime(input: { propertyPin: string; deadline?: number }): Promise<{ ok: true; evidence: NeutralRawEvidence } | { ok: false; blocker: NeutralRawBlocker }> {
  return readNeutralOfficialBytes(input, {
    now: () => new Date(),
    deadline: input.deadline,
    fetch: async (url, init) => {
      const response = await globalThis.fetch(url, init as RequestInit)
      return { ok: response.ok, status: response.status, redirected: response.redirected, url: response.url, headers: response.headers, body: response.body as CountyBody | null, text: () => response.text() }
    },
  })
}

/** Mandatory persistence boundary: verify all receipts and return deep byte copies. */
export function verifyAndCopyNeutralEvidence(evidence: NeutralRawEvidence): ExactSourcePage[] | null {
  if (evidence.exactPages.length !== evidence.sources.length) return null
  for (let i = 0; i < evidence.exactPages.length; i++) {
    const page = evidence.exactPages[i], receipt = evidence.sources[i]
    if (page.receipt !== receipt || receipt.contentSha256 !== sha(page.bytes) || !receipt.url.startsWith(`${ORIGIN}/resource/${receipt.datasetId}.json?`)) return null
  }
  const digest = sha(canonical(evidence.exactPages.map(page => ({ receipt: page.receipt, bytesSha256: sha(page.bytes) }))))
  return digest === evidence.dataEvidenceSha256 ? evidence.exactPages.map(page => Object.freeze({ receipt: page.receipt, bytes: Buffer.from(page.bytes) })) : null
}
