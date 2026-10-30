/** @jest-environment node */
/**
 * B1: a late Set-Cookie from an older free lookup must not revoke the newer
 * result's read/report/transfer authority. Drives the REAL guarded free-check
 * route, the REAL HMAC capability authority, the REAL free report and transfer
 * routes, synthetic acquisition and the in-memory analysis store. Cookies are
 * applied to ONE shared jar in response-arrival order — a browser profile's
 * tabs share one jar, so that is the model for hero/sticky overlap and for two
 * tabs alike. No provider, database or paid state is involved.
 */
import { createGuardedFreeCheckRoute } from "@/lib/evidence/server/free-check-handler"
import { createFreeResultAccess } from "@/lib/evidence/server/free-result-access"
import { createInMemoryAnalysisStore } from "@/lib/evidence/server/analysis-store"
import { createFreeReportRoute } from "@/lib/evidence/server/free-report-handler"
import { createGuardedSnapshotTransferRoute, createSnapshotTransferAuthority } from "@/lib/commerce/snapshot-checkout-transfer"
import {
  createSyntheticAdapter,
  SYNTHETIC_SECOND_ADDRESS,
  SYNTHETIC_SECOND_PIN,
  SYNTHETIC_SUBJECT_PIN,
} from "@/test-support/factual-local-fixture"

const SECRET = "synthetic-cookie-order-secret-0123456789abcdef"
const ORIGIN = "https://local.invalid"

/** One browser cookie jar: a later Set-Cookie for the same name replaces the earlier one. */
class Jar {
  readonly cookies = new Map<string, string>()
  apply(res: Response): string {
    const set = res.headers.get("set-cookie")
    if (!set) throw new Error("expected a capability cookie")
    const pair = set.split(";")[0]
    const i = pair.indexOf("=")
    const name = pair.slice(0, i)
    this.cookies.set(name, pair.slice(i + 1))
    return name
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }
}

function harness(opts: { now?: () => number } = {}) {
  const base = createSyntheticAdapter()
  const gates = new Map<string, Promise<void>>()
  const adapter = {
    ...base,
    async acquire(req: any) {
      const gate = gates.get(String(req.pin ?? ""))
      if (gate) await gate
      return base.acquire(req)
    },
  }
  const store = createInMemoryAnalysisStore()
  const access = createFreeResultAccess({ secret: SECRET, now: opts.now })
  const route = createGuardedFreeCheckRoute({ adapter, store, access })
  const report = createFreeReportRoute({ store, access, now: () => "2026-10-30T00:00:00.000Z" })
  const transfer = createGuardedSnapshotTransferRoute({ store, access, transfer: createSnapshotTransferAuthority({ secret: SECRET }) })
  /** Hold acquisition for this PIN until the returned release is called. */
  const hold = (pin: string) => {
    let release!: () => void
    gates.set(pin.replace(/-/g, ""), new Promise<void>((r) => (release = r)))
    return () => release()
  }
  const post = (body: Record<string, string>) =>
    route.POST(new Request(`${ORIGIN}/api/free-check`, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify(body) }))
  const hero = (pin: string) => post({ mode: "pin", pin })
  const sticky = (address: string) => post({ mode: "address", address })
  const get = (id: string, cookie?: string) =>
    route.GET(new Request(`${ORIGIN}/api/free-check?id=${id}`, { headers: cookie ? { cookie } : {} }))
  const getReport = (id: string, cookie?: string) =>
    report.GET(new Request(`${ORIGIN}/api/free-check/report?id=${id}`, { headers: cookie ? { cookie } : {} }))
  const postTransfer = (id: string, cookie?: string) =>
    transfer.POST(new Request(`${ORIGIN}/api/free-check/transfer?id=${id}`, { method: "POST", headers: cookie ? { cookie } : {} }))
  return { hold, hero, sticky, get, getReport, postTransfer }
}

/** Yield until the pending request has reached acquisition. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe("free result capability survives response reordering in one cookie jar", () => {
  it("older lookup A completes late: newer B stays readable and A is readable too", async () => {
    const h = harness(), jar = new Jar()
    const releaseA = h.hold(SYNTHETIC_SUBJECT_PIN)
    const pendingA = h.hero(SYNTHETIC_SUBJECT_PIN)
    await settle()
    const resB = await h.hero(SYNTHETIC_SECOND_PIN)
    expect(resB.status).toBe(200)
    const b = await resB.json()
    jar.apply(resB)
    expect((await h.get(b.resultId, jar.header())).status).toBe(200)
    releaseA()
    const resA = await pendingA
    expect(resA.status).toBe(200)
    const a = await resA.json()
    jar.apply(resA)
    expect((await h.get(b.resultId, jar.header())).status).toBe(200)
    expect((await h.get(a.resultId, jar.header())).status).toBe(200)
  })

  it("opposite order: newer B completes late after A was applied; both stay readable", async () => {
    const h = harness(), jar = new Jar()
    const releaseB = h.hold(SYNTHETIC_SECOND_PIN)
    const pendingB = h.hero(SYNTHETIC_SECOND_PIN)
    await settle()
    const resA = await h.hero(SYNTHETIC_SUBJECT_PIN)
    const a = await resA.json()
    jar.apply(resA)
    expect((await h.get(a.resultId, jar.header())).status).toBe(200)
    releaseB()
    const resB = await pendingB
    const b = await resB.json()
    jar.apply(resB)
    expect((await h.get(a.resultId, jar.header())).status).toBe(200)
    expect((await h.get(b.resultId, jar.header())).status).toBe(200)
  })

  it("hero PIN lookup pending while the sticky address lookup wins: the sticky result keeps its authority", async () => {
    const h = harness(), jar = new Jar()
    const releaseHero = h.hold(SYNTHETIC_SUBJECT_PIN)
    const pendingHero = h.hero(SYNTHETIC_SUBJECT_PIN)
    await settle()
    const resSticky = await h.sticky(SYNTHETIC_SECOND_ADDRESS)
    expect(resSticky.status).toBe(200)
    const sticky = await resSticky.json()
    jar.apply(resSticky)
    releaseHero()
    const resHero = await pendingHero
    jar.apply(resHero)
    // The page keeps the sticky receipt (the hero response is stale); its read still works.
    expect((await h.get(sticky.resultId, jar.header())).status).toBe(200)
  })

  it("two tabs sharing one jar each keep their own receipt's authority", async () => {
    const h = harness(), jar = new Jar()
    const tab1 = await h.hero(SYNTHETIC_SUBJECT_PIN)
    const r1 = await tab1.json()
    jar.apply(tab1)
    const tab2 = await h.sticky(SYNTHETIC_SECOND_ADDRESS)
    const r2 = await tab2.json()
    jar.apply(tab2)
    expect(r1.resultId).not.toBe(r2.resultId)
    expect((await h.get(r1.resultId, jar.header())).status).toBe(200)
    expect((await h.get(r2.resultId, jar.header())).status).toBe(200)
  })

  it("keeps the existing cookie security attributes and 24h lifetime", async () => {
    const h = harness()
    const res = await h.hero(SYNTHETIC_SUBJECT_PIN)
    const set = res.headers.get("set-cookie")!
    expect(set).toMatch(/; Path=\/api\/free-check(;|$)/)
    expect(set).toMatch(/; Max-Age=86400(;|$)/)
    expect(set).toMatch(/; HttpOnly(;|$)/)
    expect(set).toMatch(/; SameSite=Strict(;|$)/)
    expect(set).toMatch(/; Secure(;|$)/)
  })
})

describe("refusals: the capability, not the result id, is the authority", () => {
  it("refuses a missing cookie, another result's cookie, and another result's value under this result's name", async () => {
    const h = harness()
    const jarA = new Jar(), jarB = new Jar()
    const resA = await h.hero(SYNTHETIC_SUBJECT_PIN)
    const a = await resA.json()
    jarA.apply(resA)
    const resB = await h.hero(SYNTHETIC_SECOND_PIN)
    const b = await resB.json()
    const nameB = jarB.apply(resB)
    expect((await h.get(b.resultId)).status).toBe(404)
    expect((await h.get(b.resultId, jarA.header())).status).toBe(404)
    const valueA = [...jarA.cookies.values()][0]
    expect((await h.get(b.resultId, `${nameB}=${valueA}`)).status).toBe(404)
    expect((await h.get(a.resultId, jarA.header())).status).toBe(200)
  })

  it("does not accept a result's capability under the retired single shared cookie name", async () => {
    const h = harness(), jar = new Jar()
    const res = await h.hero(SYNTHETIC_SUBJECT_PIN)
    const r = await res.json()
    const name = jar.apply(res)
    expect(name).not.toBe("ot_free_result")
    expect((await h.get(r.resultId, `ot_free_result=${jar.cookies.get(name)}`)).status).toBe(404)
  })

  it("refuses an expired capability", async () => {
    let clock = Date.parse("2026-10-30T00:00:00Z")
    const h = harness({ now: () => clock }), jar = new Jar()
    const res = await h.hero(SYNTHETIC_SUBJECT_PIN)
    const r = await res.json()
    jar.apply(res)
    expect((await h.get(r.resultId, jar.header())).status).toBe(200)
    expect((await h.getReport(r.resultId, jar.header())).status).toBe(200)
    clock += 25 * 3600 * 1000
    expect((await h.get(r.resultId, jar.header())).status).toBe(404)
    expect((await h.getReport(r.resultId, jar.header())).status).toBe(404)
    expect((await h.postTransfer(r.resultId, jar.header())).status).toBe(404)
  })

  it("report and transfer authority follow the same per-result capability after reordering", async () => {
    const h = harness(), jar = new Jar(), jarOnlyA = new Jar()
    const releaseA = h.hold(SYNTHETIC_SUBJECT_PIN)
    const pendingA = h.hero(SYNTHETIC_SUBJECT_PIN)
    await settle()
    const resB = await h.hero(SYNTHETIC_SECOND_PIN)
    const b = await resB.json()
    jar.apply(resB)
    releaseA()
    const resA = await pendingA
    const a = await resA.json()
    jar.apply(resA)
    jarOnlyA.apply(resA)
    // Another result's capability is not authority for B on either route,
    // while it remains authority for its own result.
    expect((await h.getReport(b.resultId, jarOnlyA.header())).status).toBe(404)
    expect((await h.postTransfer(b.resultId, jarOnlyA.header())).status).toBe(404)
    expect((await h.getReport(a.resultId, jarOnlyA.header())).status).toBe(200)
    // Positive authority controls: the report renders; the transfer passes the
    // capability check and then refuses only because a synthetic result carries
    // no acquisition snapshot (no paid state is fabricated).
    const report = await h.getReport(b.resultId, jar.header())
    expect(report.status).toBe(200)
    expect(report.headers.get("content-type")).toBe("application/pdf")
    const transfer = await h.postTransfer(b.resultId, jar.header())
    expect(transfer.status).toBe(409)
    expect((await transfer.json()).code).toBe("SNAPSHOT_NOT_TRANSFERABLE")
    // Without the capability both refuse as not found.
    expect((await h.getReport(b.resultId)).status).toBe(404)
    expect((await h.postTransfer(b.resultId)).status).toBe(404)
  })
})
