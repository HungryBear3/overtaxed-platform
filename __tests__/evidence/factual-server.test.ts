/**
 * @jest-environment node
 */
import { createInMemoryAnalysisStore } from "@/lib/evidence/server/analysis-store"
import { createFreeCheckRoute } from "@/lib/evidence/server/free-check-handler"
import { cookCountyUnsupportedAdapter } from "@/lib/evidence/server/factual-analysis"
import { produceFactualPreviewPdf, buildFactualDocumentText } from "@/lib/evidence/server/factual-document"
import { presentFactualResult } from "@/lib/evidence/evidence-presentation"
import { evaluateSnapshotAcknowledgment } from "@/lib/evidence/snapshot-acknowledgment"
import { createFactualLocalRuntime, SYNTHETIC_SUBJECT_PIN, SYNTHETIC_SECOND_PIN } from "@/test-support/factual-local-fixture"

const post = (body: unknown) =>
  new Request("http://local/api/free-check", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) })

describe("server-owned factual analysis", () => {
  it("synthetic fixture binds each row explicitly and never shares PINs across townships", async () => {
    const { adapter, route } = createFactualLocalRuntime()
    const seen = new Set<string>()
    for (const [pin, township] of [[SYNTHETIC_SUBJECT_PIN, "Cicero"], [SYNTHETIC_SECOND_PIN, "Berwyn"]]) {
      const acquisition = await adapter.acquire({ pin })
      expect(acquisition.ok).toBe(true)
      if (!acquisition.ok) throw new Error("fixture acquisition failed")
      for (const row of acquisition.parcels) {
        expect(row.township).toBe(township)
        expect(row.neighborhoodCode).toBe(acquisition.cohort.neighborhoodCode)
        expect(row.sourceId).toBe("ccao_assessed_values")
        expect(acquisition.sources).toContain(row.sourceId)
        expect(seen.has(row.pin)).toBe(false)
        seen.add(row.pin)
      }
      expect((await route.POST(post({ pin }))).status).toBe(200)
    }
    expect(seen.size).toBe(8)
  })
  it("default real path holds: unsupported atomic acquisition never fabricates a result", async () => {
    const route = createFreeCheckRoute({ adapter: cookCountyUnsupportedAdapter, store: createInMemoryAnalysisStore() })
    const res = await route.POST(post({ pin: SYNTHETIC_SUBJECT_PIN }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe("ACQUISITION_HOLD")
    expect(body.resultId).toBeUndefined()
  })

  it("rejects client-submitted analysis bodies and client-chosen IDs", async () => {
    const { route } = createFactualLocalRuntime()
    for (const body of [
      { pin: SYNTHETIC_SUBJECT_PIN, resultId: "res_attackerchosen0000000000" },
      { pin: SYNTHETIC_SUBJECT_PIN, result: { validation: "VALIDATED" } },
      { pin: SYNTHETIC_SUBJECT_PIN, snapshot: {} },
      "not json",
    ]) {
      const res = await route.POST(post(body))
      expect(res.status).toBe(400)
    }
  })

  it("stores immutable results; caller mutation cannot change the stored record", async () => {
    const { route, store } = createFactualLocalRuntime()
    const receipt = await (await route.POST(post({ pin: SYNTHETIC_SUBJECT_PIN }))).json()
    expect(receipt.resultId).toMatch(/^res_[a-z0-9]{24}$/)
    const got = store.getResult(receipt.resultId)!
    expect(Object.isFrozen(got)).toBe(true)
    expect(() => { (got as any).validation = "VALIDATED" }).toThrow()
    const again = store.getResult(receipt.resultId)!
    expect(again.validation).toBe("UNVALIDATED")
    expect(() => store.putResult({ ...again } as any)).toThrow(/IMMUTABLE/)
  })

  it("rejects an acquisition with duplicate subject or missing sources", async () => {
    const dup = createFactualLocalRuntime({ mutate: (a) => (a.ok ? { ...a, parcels: [...a.parcels, { ...a.parcels[0] }] } : a) })
    expect((await dup.route.POST(post({ pin: SYNTHETIC_SUBJECT_PIN }))).status).toBe(503)
    const nosrc = createFactualLocalRuntime({ mutate: (a) => (a.ok ? { ...a, sources: [] } : a) })
    expect((await nosrc.route.POST(post({ pin: SYNTHETIC_SUBJECT_PIN }))).status).toBe(503)
    const nonatomic = createFactualLocalRuntime({ mutate: (a) => (a.ok ? { ...a, atomic: false as unknown as true } : a) })
    expect((await nonatomic.route.POST(post({ pin: SYNTHETIC_SUBJECT_PIN }))).status).toBe(503)
  })

  it("paid preview PDF reloads the same server ID, rejects returned client bodies, keeps parity", async () => {
    const { route, store } = createFactualLocalRuntime()
    const receipt = await (await route.POST(post({ pin: SYNTHETIC_SUBJECT_PIN }))).json()
    const free = JSON.parse(await (await route.GET(new Request(`http://local/api/free-check?id=${receipt.resultId}`))).text())
    await expect(produceFactualPreviewPdf(store, receipt.resultId, { generatedAt: "2026-10-16T00:00:00Z", clientBody: free })).rejects.toThrow(/CLIENT_BODY_REJECTED/)
    await expect(produceFactualPreviewPdf(store, "res_unknownunknownunknown00", { generatedAt: "2026-10-16T00:00:00Z" })).rejects.toThrow(/RESULT_NOT_FOUND/)
    const out = await produceFactualPreviewPdf(store, receipt.resultId, { generatedAt: "2026-10-16T00:00:00Z" })
    expect(out.bytes.subarray(0, 5).toString()).toBe("%PDF-")
    const p = presentFactualResult(free)
    for (const line of [p.findingText, p.windowText, ...p.limitations, ...p.sources.map((s) => s.url), p.identity.resultId, p.identity.snapshotId]) {
      expect(out.text).toContain(line)
    }
    expect(out.text).toContain("SYNTHETIC PREVIEW")
    expect(out.text).toMatch(/Cohort assessed total: \$105,300\.00 across 3 parcels/)
    expect(out.text).not.toMatch(/per sq|savings|recommend|eligible|OPEN|deadline/i)
    expect(buildFactualDocumentText(store.getResult(receipt.resultId)!)).toBe(out.text)
  })

  it("acknowledgment requires redisclosure for any changed snapshot, never authorizes checkout", async () => {
    const { route, store } = createFactualLocalRuntime()
    const a = await (await route.POST(post({ pin: SYNTHETIC_SUBJECT_PIN }))).json()
    const b = await (await route.POST(post({ pin: SYNTHETIC_SUBJECT_PIN }))).json()
    expect(a.resultId).not.toBe(b.resultId)
    const same = await evaluateSnapshotAcknowledgment(store, { shownResultId: b.resultId, currentResultId: b.resultId })
    expect(same).toMatchObject({ ok: true, redisclosureRequired: false, checkoutAuthorized: false })
    const changed = await evaluateSnapshotAcknowledgment(store, { shownResultId: a.resultId, currentResultId: b.resultId })
    // Same finding numbers, different snapshot: still redisclose.
    expect(store.getResult(a.resultId)!.finding).toEqual(store.getResult(b.resultId)!.finding)
    expect(changed).toMatchObject({ ok: true, redisclosureRequired: true, checkoutAuthorized: false })
    expect(changed.ok && changed.acknowledges).toEqual({ resultId: b.resultId, snapshotId: store.getResult(b.resultId)!.snapshotId, snapshotVersion: store.getResult(b.resultId)!.snapshotVersion })
    expect(await evaluateSnapshotAcknowledgment(store, { shownResultId: "res_nope", currentResultId: b.resultId })).toMatchObject({ ok: false, checkoutAuthorized: false })
  })
})
