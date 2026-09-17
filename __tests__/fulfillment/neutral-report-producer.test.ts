import { ASSESSOR_CONTEXT } from "@/lib/deadlines/assessor-calendar-context"
import { TOWNSHIPS } from "@/lib/townships"
import { produceNeutralReport } from "@/lib/fulfillment-runtime/neutral-report-producer"
import { installNeutralTestRuntime, TestNeutralRepository } from "@/test-support/neutral-report-runtime"

const pin = "14000000000000", other = "14000000000001"
const field = (label: string, key: string) => `<div><span class="label-a">${label}</span><div class="field--name-field-${key}"><time datetime="2026-09-${key === "last-file-date" ? "24" : "01"}T12:00:00Z">9/${key === "last-file-date" ? "24" : "01"}/2026</time></div></div>`
const card = (name: string) => `<div class="views-row"><div class="row On title"><div class="views-field-title">${name}</div><div class="open-appeal">Open For Appeals Until 9/24/2026</div></div><div class="row copy">${field("Reassessment Notice Date", "reassessment-notice-date")}${field("Last File Date", "last-file-date")}</div></div>`
const groups = ["South &amp; West Suburban Cook County", "North Suburbs &amp; City of Chicago"]
function calendarHtml() { return `<!doctype html><html><body><main class="region-content"><h1 class="page-title">Assessment &amp; Appeal Calendar</h1>${groups.map((group, index) => `<section class="paragraph--type--township-set"><h2 class="field--name-field-title">2026 Assessment Calendar: ${group}</h2><div class="field--name-field-long-text">${ASSESSOR_CONTEXT[index]}</div><div class="field--name-field-assessment"><div class="paragraph--type--assessment-calendar-set"><div class="field--name-field-set">${TOWNSHIPS.filter(t => (t.district === "south-west-suburbs") === (index === 0)).map(t => card(t.name === "Lake View" ? "Lakeview" : t.name)).join("")}</div></div></div></section>`).join("")}</main></body></html>` }

function countyRows(url: string): unknown[] {
  const parsed = new URL(url), id = parsed.pathname.split("/").pop()!.replace(".json", "")
  if (id === "pabr-t5kh" && parsed.searchParams.get("$where")!.includes(`pin='${pin}'`)) return [{ pin, year: "2026", class: "203", township_code: "70", township_name: "Lake", nbhd_code: "12" }]
  if (id === "pabr-t5kh" && parsed.searchParams.get("$where")!.includes(`pin='${other}'`)) return [{ pin: other, year: "2026", class: "203", township_code: "70", township_name: "Lake", nbhd_code: "12" }]
  if (id === "pabr-t5kh") return [pin, other].map(pin => ({ pin, year: "2026", class: "203", township_code: "70", township_name: "Lake", nbhd_code: "12" }))
  if (id === "x54s-btds") return [pin, other].map(pin => ({ pin, year: "2026", class: "203", township_code: "70", char_bldg_sf: "1200", char_yrblt: "1950", char_type_resd: "1 Story", pin_num_cards: "1", tieback_key_pin: null, tieback_proration_rate: null, card_proration_rate: "0" }))
  if (id === "uzyt-m557") return [pin, other].map((pin, i) => ({ pin, year: "2026", class: "203", township_code: "70", nbhd: "12", mailed_tot: String(30000 + i) }))
  if (id === "3723-97qp") return [pin, other].map((pin, i) => ({ pin, year: "2026", prop_address_full: `${i + 1} TEST ST`, prop_address_city_name: "Chicago", prop_address_state: "IL" }))
  return []
}
function fake(body: string, url: string, type: string) { const bytes = Buffer.from(body); let sent = false; return { ok: true, status: 200, redirected: false, url, headers: { get: (name: string) => name.toLowerCase() === "content-type" ? type : null }, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(bytes) }), cancel: async () => {} }) }, text: async () => body } as any }
async function withRuntimeFetch(run: (repo: TestNeutralRepository) => Promise<void>, mutate?: (url: string, response: any) => any, repo = new TestNeutralRepository()) {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-15T15:00:00Z"))
  const prior = globalThis.fetch
  const uninstall = installNeutralTestRuntime(repo)
  ;(globalThis as any).fetch = async (url: string) => { const base = url.includes("assessment-calendar") ? fake(calendarHtml(), url, "text/html; charset=utf-8") : fake(JSON.stringify(countyRows(url)), url, "application/json; charset=utf-8"); return mutate?.(url, base) ?? base }
  try { await run(repo) } finally { uninstall(); (globalThis as any).fetch = prior; jest.useRealTimers() }
}

test("global-fetch producer atomically persists exact artifacts/evidence and returns only durable receipt", async () => {
  await withRuntimeFetch(async () => {
    const result = await produceNeutralReport({ orderId: "ord_fixture", propertyPin: pin })
    expect(result.ok).toBe(true); if (!result.ok) return
    expect(result).toEqual({ ok: true, receipt: expect.objectContaining({ key: expect.stringMatching(/^neutral-order\/[0-9a-f]{64}$/), pdfSha256: expect.stringMatching(/^[0-9a-f]{64}$/), dataEvidenceSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }) })
    expect(result).not.toHaveProperty("pdf"); expect(result).not.toHaveProperty("manifest")
  })
  await withRuntimeFetch(async repo => {
    const result=await produceNeutralReport({orderId:"ord_unicode_regression",propertyPin:pin});expect(result.ok).toBe(true);if(!result.ok)return
    const stored=repo.confirmed.get(result.receipt.key);expect(stored).toBeTruthy()
    for(const bytes of [stored!.write.pdf,stored!.write.csv]){
      expect(bytes.includes(Buffer.from("\\u{2014}","ascii"))).toBe(false)
      expect(bytes.includes(Buffer.from("\\u2014","ascii"))).toBe(false)
    }
  })
  await withRuntimeFetch(async repo => {
    repo.mutateRead = value => { value.dataPages[0].bytes[0] ^= 1; return value }
    await expect(produceNeutralReport({ orderId: "ord_fixture", propertyPin: pin })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_STAGE_VERIFY_FAILED" })
  })
})

test("persistence readback mutation and cross-field corruption fail closed", async () => {
  await withRuntimeFetch(async repo => {
    repo.mutateRead = value => { value.pdf[0] ^= 1; return value }
    await expect(produceNeutralReport({ orderId: "ord_fixture", propertyPin: pin })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_STAGE_VERIFY_FAILED" })
  })
  await withRuntimeFetch(async repo => {
    repo.mutateRead = value => ({ ...value, manifestJson: value.manifestJson.replace("ord_fixture", "ord_forged") })
    await expect(produceNeutralReport({ orderId: "ord_fixture", propertyPin: pin })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_STAGE_VERIFY_FAILED" })
  })
})

test("calendar final URL/type and forged HTML refuse before persistence", async () => {
  for (const mutation of [
    (url: string, response: any) => url.includes("assessment-calendar") ? { ...response, url: "https://example.test/" } : response,
    (url: string, response: any) => url.includes("assessment-calendar") ? { ...response, headers: { get: () => "application/json" } } : response,
    (url: string, response: any) => url.includes("assessment-calendar") ? fake("forged", url, "text/html") : response,
  ]) await withRuntimeFetch(async () => { await expect(produceNeutralReport({ orderId: "ord_fixture", propertyPin: pin })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_DEADLINE_UNAVAILABLE" }) }, mutation)
})

test("content-address replay cannot overwrite an existing durable bundle", async () => {
  await withRuntimeFetch(async () => {
    const first = await produceNeutralReport({ orderId: "ord_fixture", propertyPin: pin })
    expect(first.ok).toBe(true)
    await expect(produceNeutralReport({ orderId: "ord_fixture", propertyPin: pin })).resolves.toEqual(first)
  })
})

test.each(["stage", "promote"] as const)("reconciles %s commit-then-timeout by exact readback", async phase => {
  const repo = new TestNeutralRepository()
  if (phase === "stage") repo.stageMode = "commit-timeout"; else repo.promoteMode = "commit-timeout"
  await withRuntimeFetch(async () => { expect((await produceNeutralReport({ orderId: `ord_${phase}`, propertyPin: pin })).ok).toBe(true) }, undefined, repo)
})

test("inactive runtime refuses before network access", async () => {
  const repo = new TestNeutralRepository(), uninstall = installNeutralTestRuntime(repo, false)
  const prior = globalThis.fetch, fetchSpy = jest.fn()
  ;(globalThis as any).fetch = fetchSpy
  try { await expect(produceNeutralReport({ orderId: "ord_off", propertyPin: pin })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_REPORT_INACTIVE" }); expect(fetchSpy).not.toHaveBeenCalled() }
  finally { uninstall(); (globalThis as any).fetch = prior }
})

test("activation is rechecked immediately before atomic promotion", async () => {
  const repo = new TestNeutralRepository()
  repo.afterStage = () => { (globalThis as any).__OT_NEUTRAL_REPORT_TEST_RUNTIME__ = { active: false, repository: repo } }
  await withRuntimeFetch(async () => {
    await expect(produceNeutralReport({ orderId: "ord_deactivated", propertyPin: pin })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_REPORT_INACTIVE" })
    expect(repo.quarantined.size).toBe(1)
  }, undefined, repo)
})

test("same order with a different PIN is refused by durable order binding before a second fetch", async () => {
  const repo = new TestNeutralRepository()
  await withRuntimeFetch(async () => {
    const first = await produceNeutralReport({ orderId: "ord_same", propertyPin: pin })
    expect(first.ok).toBe(true)
    const prior = globalThis.fetch, forbidden = jest.fn()
    ;(globalThis as any).fetch = forbidden
    try { await expect(produceNeutralReport({ orderId: "ord_same", propertyPin: other })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_REPLAY_CONFLICT" }); expect(forbidden).not.toHaveBeenCalled() }
    finally { (globalThis as any).fetch = prior }
    expect(repo.confirmed.size).toBe(1)
  }, undefined, repo)
})

test.each(["commit-timeout", "unknown", "conflict"] as const)("order binding handles %s fail-closed", async mode => {
  const repo = new TestNeutralRepository(); repo.orderReserveMode = mode
  await withRuntimeFetch(async () => {
    const result = await produceNeutralReport({ orderId: `ord_binding_${mode}`, propertyPin: pin })
    if (mode === "commit-timeout") expect(result.ok).toBe(true)
    else expect(result).toEqual({ ok: false, blocker: mode === "conflict" ? "NEUTRAL_REPLAY_CONFLICT" : "NEUTRAL_RESERVATION_UNKNOWN" })
  }, undefined, repo)
})

test("a CONFIRMED promote carrying a wrong receipt is reconciled only against exact durable receipt", async () => {
  const repo = new TestNeutralRepository(); repo.wrongPromoteReceipt = true
  await withRuntimeFetch(async () => { expect((await produceNeutralReport({ orderId: "ord_wrong_return", propertyPin: pin })).ok).toBe(true) }, undefined, repo)
})

test("commit-then-timeout with a wrong durable receipt quarantines and refuses", async () => {
  const repo = new TestNeutralRepository(); repo.promoteMode = "commit-timeout"; repo.wrongStoredReceipt = true
  await withRuntimeFetch(async () => {
    await expect(produceNeutralReport({ orderId: "ord_wrong_durable", propertyPin: pin })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_PROMOTE_UNKNOWN" })
    expect(repo.quarantined.size).toBe(1)
  }, undefined, repo)
})
