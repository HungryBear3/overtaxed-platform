import { createHash } from "node:crypto"

import { readNeutralOfficialBytesRuntime, verifyAndCopyNeutralEvidence } from "@/lib/fulfillment-runtime/neutral-raw-gateway"

const subjectPin = "14000000000000"
const otherPin = "14000000000001"
const now = () => new Date("2026-09-15T15:00:00.000Z")

function rowsFor(url: string): unknown[] {
  const parsed = new URL(url); const id = parsed.pathname.split("/").pop()!.replace(".json", "")
  if (id === "pabr-t5kh" && parsed.searchParams.get("$where")!.includes(`pin='${subjectPin}'`)) return [{ pin: subjectPin, year: "2026", class: "203", township_code: "70", township_name: "Lake", nbhd_code: "12" }]
  if (id === "pabr-t5kh") return [subjectPin, otherPin].map(pin => ({ pin, year: "2026", class: "203", township_code: "70", township_name: "Lake", nbhd_code: "12" }))
  if (id === "x54s-btds") return [subjectPin, otherPin].map(pin => ({ pin, year: "2026", class: "203", township_code: "70", char_bldg_sf: "1200", char_yrblt: "1950", char_type_resd: "1 Story", pin_num_cards: "1", tieback_key_pin: null, tieback_proration_rate: null, card_proration_rate: pin === subjectPin ? "0.0" : "1.0" }))
  if (id === "uzyt-m557") return [subjectPin, otherPin].map((pin, i) => ({ pin, year: "2026", class: "203", township_code: "70", nbhd: "12", mailed_tot: String(30000 + i) }))
  if (id === "3723-97qp") return [subjectPin, otherPin].map((pin, i) => ({ pin, year: "2026", prop_address_full: `${i + 1} TEST ST`, prop_address_city_name: "Chicago", prop_address_state: "IL" }))
  return []
}

function runtimeFetch(mutator?: (url: string, rows: unknown[]) => unknown[]) {
  return async (url: string, init: any) => {
    expect(init.method).toBe("GET"); expect(init.cache).toBe("no-store"); expect(init.credentials).toBe("omit"); expect(init.redirect).toBe("error")
    const rows = mutator?.(url, rowsFor(url)) ?? rowsFor(url); const body = Buffer.from(JSON.stringify(rows)); let sent = false
    return { ok: true, status: 200, redirected: false, url, headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null }, text: async () => body.toString(), body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(body) }), cancel: async () => {} }) } }
  }
}
async function read(mutator?: (url: string, rows: unknown[]) => unknown[]) {
  const prior = globalThis.fetch; (globalThis as any).fetch = runtimeFetch(mutator)
  try { return await readNeutralOfficialBytesRuntime({ propertyPin: subjectPin }) } finally { (globalThis as any).fetch = prior }
}

test("derives the complete neutral payload solely from exact official response bytes", async () => {
  const result = await read()
  expect(result.ok).toBe(true); if (!result.ok) return
  expect(result.evidence.subject.pin).toBe(subjectPin)
  expect(result.evidence.candidatePool.map(row => row.pin)).toEqual([subjectPin, otherPin])
  expect(result.evidence.subjectProration.cardProrationRate).toBe("0.0")
  expect(result.evidence.exactPages).toHaveLength(5)
  for (const page of result.evidence.exactPages) expect(page.receipt.contentSha256).toBe(createHash("sha256").update(page.bytes).digest("hex"))
  const copies = verifyAndCopyNeutralEvidence(result.evidence); expect(copies).not.toBeNull(); expect(copies![0].bytes).not.toBe(result.evidence.exactPages[0].bytes)
})

test.each([
  ["wrong year", (_url: string, rows: unknown[]) => rows.map((row: any) => ({ ...row, year: "2025" }))],
  ["duplicate", (url: string, rows: unknown[]) => url.includes("x54s-btds") ? [...rows, rows[0]] : rows],
  ["foreign row", (url: string, rows: unknown[]) => url.includes("3723-97qp") ? [...rows, { ...(rows[0] as any), pin: "99999999999999" }] : rows],
] as const)("refuses %s official responses", async (_name, mutate) => {
  await expect(read(mutate)).resolves.toMatchObject({ ok: false })
})

test("replayed pagination page refuses instead of duplicating the pool", async () => {
  const page = Array.from({ length: 500 }, (_, i) => ({ pin: String(14000000000000 + i), year: "2026", class: "203", township_code: "70", township_name: "Lake", nbhd_code: "12" }))
  const result = await read((url, rows) => url.includes("pabr-t5kh") && !new URL(url).searchParams.get("$where")!.includes(`pin='${subjectPin}'`) ? page : rows)
  expect(result).toEqual({ ok: false, blocker: "NEUTRAL_RAW_PAGINATION_CONFLICT" })
})

test("mutation after production is detected at the mandatory copy boundary", async () => {
  const result = await read(); if (!result.ok) throw new Error(result.blocker)
  result.evidence.exactPages[0].bytes[0] ^= 1
  expect(verifyAndCopyNeutralEvidence(result.evidence)).toBeNull()
})

test("pilot refuses a multi-card subject without interpreting it", async () => {
  const result = await read((url, rows) => url.includes("x54s-btds") ? rows.map((row: any) => row.pin === subjectPin ? { ...row, pin_num_cards: "2" } : row) : rows)
  expect(result).toEqual({ ok: false, blocker: "NEUTRAL_RAW_MULTI_CARD_UNSUPPORTED" })
})

test("pilot refuses a multi-card matching-property candidate without partial omission", async () => {
  const result = await read((url, rows) => url.includes("x54s-btds") ? rows.map((row: any) => row.pin === otherPin ? { ...row, pin_num_cards: "2" } : row) : rows)
  expect(result).toEqual({ ok: false, blocker: "NEUTRAL_RAW_MULTI_CARD_UNSUPPORTED" })
})

test("canonical requests have sorted unique parameters and role-specific allowlisted selects", async () => {
  const result = await read(); if (!result.ok) throw new Error(result.blocker)
  for (const { receipt } of result.evidence.exactPages) {
    const url = new URL(receipt.url); expect(url.origin).toBe("https://datacatalog.cookcountyil.gov")
    const keys = [...url.searchParams.keys()]; expect(keys).toEqual([...keys].sort()); expect(new Set(keys).size).toBe(keys.length)
    expect(url.searchParams.get("$order")).toBe("pin")
  }
})

test("county body stall aborts and cancels the reader", async () => {
  jest.useFakeTimers(); const cancel = jest.fn(async () => {})
  const prior = globalThis.fetch; (globalThis as any).fetch = async (url: string) => ({ ok: true, status: 200, redirected: false, url, headers: { get: () => "application/json" }, body: { getReader: () => ({ read: () => new Promise(() => {}), cancel }) }, text: async () => "" })
  try { const pending = readNeutralOfficialBytesRuntime({ propertyPin: subjectPin }); await jest.advanceTimersByTimeAsync(15_001); await expect(pending).resolves.toEqual({ ok: false, blocker: "NEUTRAL_RAW_SOURCE_UNAVAILABLE" }); expect(cancel).toHaveBeenCalled() } finally { (globalThis as any).fetch = prior; jest.useRealTimers() }
})

test("whole retrieval refuses a monotonic read exceeding 120 seconds", async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-15T15:00:00Z")); let calls = 0
  const prior = globalThis.fetch; (globalThis as any).fetch = async (url: string, init: any) => { calls += 1; if (calls === 2) jest.setSystemTime(new Date("2026-09-15T15:02:01Z")); return runtimeFetch()(url, init) }
  try { await expect(readNeutralOfficialBytesRuntime({ propertyPin: subjectPin })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_RAW_SOURCE_UNAVAILABLE" }) } finally { (globalThis as any).fetch = prior; jest.useRealTimers() }
})

test.each([
  ["final URL drift", (value: any) => ({ ...value, url: "https://example.test/" })],
  ["content type drift", (value: any) => ({ ...value, headers: { get: () => "text/html" } })],
])("county rejects %s", async (_name, mutate) => {
  const prior = globalThis.fetch; (globalThis as any).fetch = async (url: string, init: any) => mutate(await runtimeFetch()(url, init))
  try { await expect(readNeutralOfficialBytesRuntime({ propertyPin: subjectPin })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_RAW_SOURCE_UNAVAILABLE" }) } finally { (globalThis as any).fetch = prior }
})
