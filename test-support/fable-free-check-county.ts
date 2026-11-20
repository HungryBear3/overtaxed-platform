/**
 * FABLE REVIEW (2026-11-19) test support: one in-memory county for the free check.
 *
 * Serves the subject lookup, the address search and the comparison reader from
 * the repo's anonymized authentic pool fixture. Latency is simulated by advancing
 * jest's fake clock, so callers must have fake timers installed. Nothing is fetched.
 */
import { COUNTY_DATASETS } from "@/lib/fulfillment-runtime/t2-county-gateway"
import fixture from "@/__tests__/fixtures/free-check-authentic-pool.json"

type Row = Record<string, unknown>
export const SUBJECT = fixture.subjectPin
export const SUBJECT_DASHED = `${SUBJECT.slice(0, 2)}-${SUBJECT.slice(2, 4)}-${SUBJECT.slice(4, 7)}-${SUBJECT.slice(7, 10)}-${SUBJECT.slice(10)}`
const tables: Record<string, Row[]> = {
  [COUNTY_DATASETS.parcelUniverse.id]: fixture.universe,
  [COUNTY_DATASETS.characteristics.id]: fixture.characteristics,
  [COUNTY_DATASETS.assessedValues.id]: fixture.assessed,
  [COUNTY_DATASETS.addresses.id]: fixture.addresses,
}

function respond(url: string, value: unknown): Response {
  const response = new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })
  Object.defineProperty(response, "url", { value: url })
  return response
}
const advance = (ms: number) => { if (ms > 0) jest.setSystemTime(Date.now() + ms) }

export type Latency = { addressQueryMs?: number; comparisonRequestMs?: number }

export function install(latency: Latency = {}) {
  const lookupCalls: string[] = []
  const comparisonCalls: string[] = []
  const addressCalls: string[] = []
  const impl = async (input: unknown) => {
    const raw = String(input)
    const url = new URL(raw)
    const id = url.pathname.split("/").pop()!.replace(".json", "")
    const where = url.searchParams.get("$where") ?? ""
    const select = url.searchParams.get("$select") ?? ""

    // ── The comparison reader: metadata reads and every `$select` query ──────
    if (url.pathname.startsWith("/api/views/") || select) {
      comparisonCalls.push(raw)
      advance(latency.comparisonRequestMs ?? 0)
      if (url.pathname.startsWith("/api/views/")) {
        const dataset = Object.values(COUNTY_DATASETS).find((d) => d.id === id)!
        return respond(raw, {
          id, provenance: "official", rowsUpdatedAt: 1793552580, viewLastModified: 1793552580, tableId: 1,
          columns: [...dataset.select.split(","), "card", "mailed_land", "mailed_bldg"].map((fieldName) => ({
            fieldName, dataTypeName: fieldName === "pin_is_multiland" ? "checkbox" : "text",
          })),
        })
      }
      if (select.startsWith("count(")) return respond(raw, [{ n: String(tables[id].length) }])
      const single = where.match(/pin='(\d{14})'/)?.[1]
      const listed = where.match(/pin in\(([^)]*)\)/)?.[1]
      let rows = tables[id]
      if (single) rows = rows.filter((row) => row.pin === single)
      else if (listed) rows = rows.filter((row) => listed.includes(`'${row.pin}'`))
      const offset = Number(url.searchParams.get("$offset") ?? 0)
      const limit = Number(url.searchParams.get("$limit") ?? 1000)
      return respond(raw, rows.slice(offset, offset + limit))
    }

    // ── Address search (the only step the PIN path does not run) ─────────────
    if (/like upper\(/i.test(where)) {
      addressCalls.push(raw)
      advance(latency.addressQueryMs ?? 0)
      if (id === "c49d-89sn" && /100 SYNTHETIC/.test(where))
        return respond(raw, [{ pin: SUBJECT, property_address: "100 SYNTHETIC ST", property_city: "SYNTHETIC CITY", property_zip: "60000" }])
      return respond(raw, [])
    }

    // ── Subject lookup (`getPropertyByPIN`), same on both paths ──────────────
    lookupCalls.push(raw)
    const forSubject = where.includes(`pin='${SUBJECT}'`)
    if (!forSubject) return respond(raw, [])
    switch (id) {
      case "pabr-t5kh": return respond(raw, [{ pin: SUBJECT, township_name: "Synthetic", township_code: "99", nbhd_code: "99001", class: "203" }])
      case "tx2p-k2g9": return respond(raw, [{ pin: SUBJECT, prop_address_full: "100 SYNTHETIC ST", prop_address_city_name: "SYNTHETIC CITY", prop_address_zipcode_1: "60000", year: "2025" }])
      case "uzyt-m557": return respond(raw, [{ pin: SUBJECT, year: "2026", mailed_tot: "33000", mailed_land: "11400", mailed_bldg: "21600" }])
      default: return respond(raw, [])
    }
  }
  jest.spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch)
  return { lookupCalls, comparisonCalls, addressCalls }
}

export const PIN_INPUT = { pin: SUBJECT }
export const ADDRESS_INPUT = { address: "100 Synthetic St", city: "Synthetic City" }
