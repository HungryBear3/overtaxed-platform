import { loadNeutralOfficialCalendarRuntime, NEUTRAL_CALENDAR_URL, verifyAndCopyNeutralDeadlineEvidence } from "@/lib/fulfillment-runtime/neutral-deadline-gateway"

function response(body: string, options: { type?: string; status?: number } = {}): Response {
  const bytes = Buffer.from(body); let sent = false
  return { ok: (options.status ?? 200) === 200, status: options.status ?? 200, redirected: false, url: NEUTRAL_CALENDAR_URL, headers: { get: (name: string) => name.toLowerCase() === "content-type" ? (options.type ?? "text/html; charset=utf-8") : null }, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(bytes) }), cancel: async () => {} }) } } as any
}

async function withFetch(value: Response, run: () => Promise<void>) { const prior = globalThis.fetch; (globalThis as any).fetch = async () => value; try { await run() } finally { (globalThis as any).fetch = prior } }

test.each([
  ["forged html", response("not an official calendar")],
  ["wrong content type", response("x", { type: "application/json" })],
  ["bad status", response("x", { status: 503 })],
])("runtime calendar fails closed on %s", async (_name, value) => {
  await withFetch(value, async () => { await expect(loadNeutralOfficialCalendarRuntime({ subjectPin: "14000000000000", subjectTownship: "Lake" })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_DEADLINE_UNAVAILABLE" }) })
})

test("runtime calendar rejects final URL drift", async () => {
  const value = response("x"); Object.defineProperty(value, "url", { value: "https://example.test/" })
  await withFetch(value, async () => { await expect(loadNeutralOfficialCalendarRuntime({ subjectPin: "14000000000000", subjectTownship: "Lake" })).resolves.toEqual({ ok: false, blocker: "NEUTRAL_DEADLINE_UNAVAILABLE" }) })
})

test("copy boundary rejects a forged deadline evidence object", () => {
  expect(verifyAndCopyNeutralDeadlineEvidence({ deadline: { snapshotSha256: "a".repeat(64) } as any, sourceBytes: Buffer.from("x"), sourceBytesSha256: "a".repeat(64), deadlineEvidenceSha256: "b".repeat(64) })).toBeNull()
})

test("body stall is aborted and cancelled", async () => {
  jest.useFakeTimers()
  const cancel = jest.fn(async () => {})
  const value = { ok: true, status: 200, redirected: false, url: NEUTRAL_CALENDAR_URL, headers: { get: () => "text/html" }, body: { getReader: () => ({ read: () => new Promise(() => {}), cancel }) } } as any
  const prior = globalThis.fetch; (globalThis as any).fetch = async () => value
  try { const pending = loadNeutralOfficialCalendarRuntime({ subjectPin: "14000000000000", subjectTownship: "Lake" }); await jest.advanceTimersByTimeAsync(15_001); await expect(pending).resolves.toEqual({ ok: false, blocker: "NEUTRAL_DEADLINE_UNAVAILABLE" }); expect(cancel).toHaveBeenCalled() } finally { (globalThis as any).fetch = prior; jest.useRealTimers() }
})
