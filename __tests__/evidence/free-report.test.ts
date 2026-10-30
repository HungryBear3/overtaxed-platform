/** @jest-environment node */
import fs from "node:fs"
import { createInMemoryAnalysisStore, type AnalysisStore } from "@/lib/evidence/server/analysis-store"
import { createGuardedFreeCheckRoute } from "@/lib/evidence/server/free-check-handler"
import { createFreeReportRoute } from "@/lib/evidence/server/free-report-handler"
import { createFreeResultAccess } from "@/lib/evidence/server/free-result-access"
import { createSyntheticAdapter, SYNTHETIC_SUBJECT_PIN, SYNTHETIC_SECOND_PIN } from "@/test-support/factual-local-fixture"

const SECRET = "test-only-secret-0123456789abcdef0123456789abcdef"
const URL0 = "http://local/api/free-check"

function setup(opts: { secret?: string; store?: AnalysisStore } = {}) {
  const store = opts.store ?? createInMemoryAnalysisStore()
  const access = createFreeResultAccess({ secret: "secret" in opts ? opts.secret : SECRET })
  const adapter = createSyntheticAdapter()
  return { store, access, check: createGuardedFreeCheckRoute({ adapter, store, access }), report: createFreeReportRoute({ store, access, now: () => "2026-10-20T00:00:00.000Z" }) }
}
async function lookup(h: ReturnType<typeof setup>, pin = SYNTHETIC_SUBJECT_PIN) {
  const res = await h.check.POST(new Request(URL0, { method: "POST", body: JSON.stringify({ pin }), headers: { "content-type": "application/json" } }))
  const set = res.headers.get("set-cookie")
  return { res, receipt: await res.json(), cookie: set ? set.split(";")[0] : undefined }
}
const get = (path: string, cookie?: string, headers: Record<string, string> = {}) => new Request("http://local" + path, { headers: { ...(cookie ? { cookie } : {}), ...headers } })

describe("result-bound free report access", () => {
  it("POST issues a capability cookie bound to the persisted result; GET result requires it", async () => {
    const h = setup()
    const { res, receipt, cookie } = await lookup(h)
    expect(res.status).toBe(200)
    expect(cookie).toBeDefined()
    expect(JSON.stringify(receipt)).not.toContain(cookie!.split("=")[1])
    const ok = await h.check.GET(get(`/api/free-check?id=${receipt.resultId}`, cookie))
    expect(ok.status).toBe(200)
    expect((await ok.json()).resultId).toBe(receipt.resultId)
    expect(ok.headers.get("cache-control")).toMatch(/no-store/)
    const other = await h.check.GET(get(`/api/free-check?id=${receipt.resultId}`))
    expect(other.status).toBe(404)
  })

  it("refusals are uniform for missing, cross-result, unknown and malformed ids", async () => {
    const h = setup()
    const a = await lookup(h)
    const b = await lookup(h, SYNTHETIC_SECOND_PIN)
    const bodies: string[] = []
    for (const [path, cookie] of [
      [`/api/free-check/report?id=${a.receipt.resultId}`, undefined],
      [`/api/free-check/report?id=${a.receipt.resultId}`, b.cookie],
      [`/api/free-check/report?id=res_${"0".repeat(24)}`, a.cookie],
      [`/api/free-check/report?id=../../etc`, a.cookie],
      [`/api/free-check/report`, a.cookie],
    ] as const) {
      const r = await h.report.GET(get(path, cookie))
      expect(r.status).toBe(404)
      expect(r.headers.get("content-type")).toMatch(/json/)
      bodies.push(await r.text())
    }
    expect(new Set(bodies).size).toBe(1)
    const cross = await h.check.GET(get(`/api/free-check?id=${a.receipt.resultId}`, b.cookie))
    expect(cross.status).toBe(404)
    expect(await cross.text()).toBe(bodies[0])
  })

  it("report returns real PDF bytes from persisted facts with private no-store headers", async () => {
    const h = setup()
    const { receipt, cookie } = await lookup(h)
    const r = await h.report.GET(get(`/api/free-check/report?id=${receipt.resultId}`, cookie, { "sec-fetch-site": "same-origin" }))
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toBe("application/pdf")
    expect(r.headers.get("cache-control")).toMatch(/private/)
    expect(r.headers.get("cache-control")).toMatch(/no-store/)
    expect(r.headers.get("x-content-type-options")).toBe("nosniff")
    expect(r.headers.get("content-disposition")).toContain(`${receipt.resultId}.pdf`)
    const bytes = Buffer.from(await r.arrayBuffer())
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-")
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it("rejects client fact inputs and cross-origin requests", async () => {
    const h = setup()
    const { receipt, cookie } = await lookup(h)
    const facts = await h.report.GET(get(`/api/free-check/report?id=${receipt.resultId}&assessed=1`, cookie))
    expect(facts.status).toBe(400)
    const xs = await h.report.GET(get(`/api/free-check/report?id=${receipt.resultId}`, cookie, { "sec-fetch-site": "cross-site" }))
    expect(xs.status).toBe(403)
    const xo = await h.report.GET(get(`/api/free-check/report?id=${receipt.resultId}`, cookie, { origin: "https://evil.example" }))
    expect(xo.status).toBe(403)
    const xpost = await h.check.POST(new Request(URL0, { method: "POST", body: JSON.stringify({ pin: SYNTHETIC_SUBJECT_PIN }), headers: { origin: "https://evil.example" } }))
    expect(xpost.status).toBe(403)
    expect(xpost.headers.get("set-cookie")).toBeNull()
  })

  it("snapshot drift between the capability and persisted record is refused", async () => {
    const inner = createInMemoryAnalysisStore()
    const store: AnalysisStore = { ...inner, getResult: async (id) => { const r = await inner.getResult(id); return r && { ...r, snapshotId: "snap_" + "f".repeat(24) } } }
    const h = setup({ store })
    const { receipt, cookie } = await lookup(h)
    expect((await h.report.GET(get(`/api/free-check/report?id=${receipt.resultId}`, cookie))).status).toBe(404)
  })

  it("a later store read cannot replace the authorized snapshot during PDF generation", async () => {
    const inner = createInMemoryAnalysisStore()
    let reads = 0
    const store: AnalysisStore = { ...inner, getResult: async (id) => {
      const r = await inner.getResult(id)
      return r && ++reads > 1 ? { ...r, snapshotId: "snap_" + "f".repeat(24) } : r
    } }
    const h = setup({ store })
    const { receipt, cookie } = await lookup(h)
    const response = await h.report.GET(get(`/api/free-check/report?id=${receipt.resultId}`, cookie))
    // Authorize and render exactly one persisted value, not an unchecked re-read.
    expect(response.status).toBe(200)
    expect(reads).toBe(1)
  })

  it("storage unavailable fails closed with 503 and no PDF", async () => {
    const inner = createInMemoryAnalysisStore()
    let down = false
    const store: AnalysisStore = { ...inner, getResult: async (id) => { if (down) throw new Error("db down"); return inner.getResult(id) } }
    const h = setup({ store })
    const { receipt, cookie } = await lookup(h)
    down = true
    const r = await h.report.GET(get(`/api/free-check/report?id=${receipt.resultId}`, cookie))
    expect(r.status).toBe(503)
    expect(r.headers.get("content-type")).toMatch(/json/)
    expect((await h.check.GET(get(`/api/free-check?id=${receipt.resultId}`, cookie))).status).toBe(503)
  })

  it("missing signing config fails closed before acquisition and on reads", async () => {
    const h = setup({ secret: undefined })
    const acquire = jest.fn()
    const check = createGuardedFreeCheckRoute({ adapter: { ...createSyntheticAdapter(), acquire }, store: h.store, access: h.access })
    const res = await check.POST(new Request(URL0, { method: "POST", body: JSON.stringify({ pin: SYNTHETIC_SUBJECT_PIN }) }))
    expect(res.status).toBe(503)
    expect(acquire).not.toHaveBeenCalled()
    expect(res.headers.get("set-cookie")).toBeNull()
    expect((await h.report.GET(get(`/api/free-check/report?id=res_${"0".repeat(24)}`))).status).toBe(503)
  })

  it("production routes always mount guarded handlers with production access (no bypass)", () => {
    const check = fs.readFileSync("app/api/free-check/route.ts", "utf8")
    const report = fs.readFileSync("app/api/free-check/report/route.ts", "utf8")
    expect(check).toMatch(/createGuardedFreeCheckRoute\(/)
    expect(check).not.toMatch(/createFreeCheckRoute\(/)
    for (const src of [check, report]) expect(src).toMatch(/productionFreeResultAccess\(\)/)
    expect(report).toMatch(/createFreeReportRoute\(/)
    expect(report).not.toMatch(/export (async )?function POST/)
  })
})
