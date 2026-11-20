/**
 * Synthetic Cook County Socrata provider for the subject-lookup tests.
 *
 * Every PIN, address, city, ZIP and figure here is made up. Nothing is fetched:
 * `globalThis.fetch` is replaced for the duration of each test and any dataset
 * this fake does not recognise answers `[]`.
 */
export const SYNTH_PIN = "01020304050000"
export const SYNTH_PIN_DASHED = "01-02-030-405-0000"
export const SYNTH_AV = 33000

export type AssessedMode =
  | "found" | "empty" | "zero" | "http500" | "network" | "timeout" | "nonArray" | "emptyButHistory"
export type FakeOptions = {
  assessed?: AssessedMode
  parcelCurrent?: "ok" | "fail"
  parcelArchived?: "ok" | "fail"
  history?: "ok" | "fail"
  singleFamily?: "ok" | "fail"
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

export function installFakeSocrata(opts: FakeOptions = {}) {
  const o = { assessed: "found", parcelCurrent: "ok", parcelArchived: "ok", history: "ok", singleFamily: "ok", ...opts }
  const calls: string[] = []
  const impl = async (input: unknown) => {
    const url = decodeURIComponent(String(input))
    calls.push(url)
    const ds = (url.match(/resource\/([a-z0-9]{4}-[a-z0-9]{4})\.json/) ?? [])[1]
    const forSubject = url.includes(`pin='${SYNTH_PIN}'`)
    switch (ds) {
      case "pabr-t5kh":
        if (o.parcelCurrent === "fail") return json({ message: "synthetic" }, 500)
        return json(forSubject ? [{ pin: SYNTH_PIN, township_name: "Synthetic", nbhd_code: "00000", class: "203" }] : [])
      case "tx2p-k2g9":
        if (forSubject && o.parcelArchived === "fail") return json({ message: "synthetic" }, 500)
        if (forSubject || /prop_address_full\) like upper\('100 SYNTHETIC/.test(url))
          return json([{ pin: SYNTH_PIN, prop_address_full: "100 SYNTHETIC ST", prop_address_city_name: "TESTVILLE", prop_address_zipcode_1: "60000", year: "2025" }])
        return json([])
      case "c49d-89sn":
        if (/property_address\) like upper\('%100 SYNTHETIC/.test(url))
          return json([{ pin: SYNTH_PIN, property_address: "100 SYNTHETIC ST", property_city: "TESTVILLE", property_zip: "60000" }])
        return json([])
      case "x54s-btds":
        return json([])
      case "bcnq-qi2z":
        if (o.singleFamily === "fail") return json({ message: "synthetic" }, 500)
        return json([])
      case "uzyt-m557": {
        if (!forSubject) return json([])
        if (url.includes("mailed_tot > 0")) {
          switch (o.assessed) {
            case "http500": return json({ message: "synthetic" }, 500)
            case "network": throw new TypeError("fetch failed (synthetic)")
            case "timeout": throw new DOMException("This operation was aborted", "AbortError")
            case "nonArray": return json({ error: true, message: "synthetic non-array" })
            case "empty": case "emptyButHistory": return json([])
            case "zero": return json([{ pin: SYNTH_PIN, year: "2025", mailed_tot: "31000", certified_tot: "32000", board_tot: "0" }])
            default: return json([{ pin: SYNTH_PIN, year: "2025", mailed_tot: String(SYNTH_AV), mailed_land: "3000", mailed_bldg: "30000" }])
          }
        }
        if (o.history === "fail") return json({ message: "synthetic history failure" }, 429)
        if (o.assessed === "empty") return json([])
        return json([{ pin: SYNTH_PIN, year: "2025", mailed_tot: String(SYNTH_AV) }])
      }
      default:
        return json([])
    }
  }
  const spy = jest.spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch)
  return { calls, spy }
}

export const assessedQueries = (calls: string[]) =>
  calls.filter((u) => u.includes("/uzyt-m557.json") && u.includes(`pin='${SYNTH_PIN}'`)).sort()
