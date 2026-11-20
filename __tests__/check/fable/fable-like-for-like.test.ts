/**
 * @jest-environment node
 *
 * FABLE REVIEW (2026-11-19) — acceptance test for FABLE-CORRECTION-like-for-like.diff.
 * Fails on Elon's retarget patch (2 of 4), passes with the correction applied.
 */
import { getPropertyByPIN } from "@/lib/cook-county"

const PIN = "01020304050000"
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

function install(current: unknown[], history: unknown[]) {
  jest.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
    const url = decodeURIComponent(String(input))
    const ds = (url.match(/resource\/([a-z0-9]{4}-[a-z0-9]{4})\.json/) ?? [])[1]
    if (!url.includes(`pin='${PIN}'`)) return json([])
    if (ds === "pabr-t5kh") return json([{ pin: PIN, township_name: "Synthetic", nbhd_code: "00000", class: "203" }])
    if (ds === "tx2p-k2g9") return json([{ pin: PIN, prop_address_full: "100 SYNTHETIC ST", prop_address_city_name: "TESTVILLE", prop_address_zipcode_1: "60000" }])
    if (ds === "uzyt-m557") return json(url.includes("mailed_tot > 0") ? current : history)
    return json([])
  }) as unknown as typeof fetch)
}
beforeEach(() => { jest.spyOn(console, "error").mockImplementation(() => {}); jest.spyOn(console, "warn").mockImplementation(() => {}) })
afterEach(() => jest.restoreAllMocks())

describe("an empty current-value answer is a contradiction only against a MAILED total", () => {
  it("history with a positive mailed total → unavailable (unchanged)", async () => {
    install([], [{ pin: PIN, year: "2025", mailed_tot: "33000" }])
    expect((await getPropertyByPIN(PIN)).assessedValueLookup).toBe("unavailable")
  })
  it("certified-only history → absent, not unavailable", async () => {
    install([], [{ pin: PIN, year: "2025", certified_tot: "31000" }])
    const res = await getPropertyByPIN(PIN)
    expect(res.assessedValueLookup).toBe("absent")
    expect(res.data?.assessedTotalValue).toBeNull()
  })
  it("board-only history → absent, not unavailable", async () => {
    install([], [{ pin: PIN, year: "2025", board_tot: "30000" }])
    expect((await getPropertyByPIN(PIN)).assessedValueLookup).toBe("absent")
  })
  it("no history at all → absent (unchanged)", async () => {
    install([], [])
    expect((await getPropertyByPIN(PIN)).assessedValueLookup).toBe("absent")
  })
})
