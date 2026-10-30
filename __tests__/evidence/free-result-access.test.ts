/** @jest-environment node */
import { createFreeResultAccess, productionFreeResultAccess, isSameOrigin, FREE_RESULT_COOKIE } from "@/lib/evidence/server/free-result-access"

const SECRET = "test-only-secret-0123456789abcdef0123456789abcdef"
const binding = { resultId: "res_" + "a".repeat(24), snapshotId: "snap_" + "b".repeat(24), subject: { pin: "18062140110000", township: "Cicero", taxYear: 2025 } }
const cookieOf = (setCookie: string) => setCookie.split(";")[0]
const req = (cookie?: string, headers: Record<string, string> = {}) =>
  new Request("http://local/api/free-check/report?id=" + binding.resultId, { headers: { ...(cookie ? { cookie } : {}), ...headers } })

describe("free result access capability", () => {
  it("fails closed when the signing secret is missing or short", () => {
    for (const secret of [undefined, "", "short"]) {
      const a = createFreeResultAccess({ secret })
      expect(a.configured).toBe(false)
      expect(a.issueCookie(binding)).toBeNull()
    }
  })
  it("production access reads NEXTAUTH_SECRET and has no bypass when unset", () => {
    const saved = process.env.NEXTAUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    try { expect(productionFreeResultAccess().configured).toBe(false) } finally { if (saved !== undefined) process.env.NEXTAUTH_SECRET = saved }
  })
  it("issues an HttpOnly same-site path-scoped cookie that does not contain the secret", () => {
    const set = createFreeResultAccess({ secret: SECRET }).issueCookie(binding)!
    expect(set.startsWith(`${FREE_RESULT_COOKIE}_${binding.resultId}=`)).toBe(true)
    expect(set).toMatch(/; HttpOnly/)
    expect(set).toMatch(/; SameSite=Strict/)
    expect(set).toMatch(/; Path=\/api\/free-check/)
    expect(set).toMatch(/; Secure/)
    expect(set).toMatch(/; Max-Age=\d+/)
    expect(set).not.toContain(SECRET)
  })
  it("binds to the exact result id, signature, secret and expiry", () => {
    let now = 1_000_000
    const a = createFreeResultAccess({ secret: SECRET, now: () => now })
    const c = cookieOf(a.issueCookie(binding)!)
    expect(a.readBinding(req(c), binding.resultId)).toEqual(binding)
    expect(a.readBinding(req(c), "res_" + "c".repeat(24))).toBeNull()
    expect(a.readBinding(req(), binding.resultId)).toBeNull()
    expect(a.readBinding(req(c.slice(0, -2) + (c.endsWith("AA") ? "BB" : "AA")), binding.resultId)).toBeNull()
    expect(a.readBinding(req(`${FREE_RESULT_COOKIE}_${binding.resultId}=garbage`), binding.resultId)).toBeNull()
    expect(createFreeResultAccess({ secret: SECRET + "x" }).readBinding(req(c), binding.resultId)).toBeNull()
    now += 7 * 24 * 3600 * 1000
    expect(a.readBinding(req(c), binding.resultId)).toBeNull()
  })
  it("matches only the canonical persisted identity", () => {
    const a = createFreeResultAccess({ secret: SECRET })
    expect(a.matches(binding, binding)).toBe(true)
    expect(a.matches(binding, { ...binding, snapshotId: "snap_" + "d".repeat(24) })).toBe(false)
    expect(a.matches(binding, { ...binding, subject: { ...binding.subject, taxYear: 2024 } })).toBe(false)
    expect(a.matches(binding, { ...binding, subject: { ...binding.subject, township: "Berwyn" } })).toBe(false)
  })
  it("same-origin control refuses cross-site fetch metadata and foreign Origin", () => {
    expect(isSameOrigin(req())).toBe(true)
    expect(isSameOrigin(req(undefined, { "sec-fetch-site": "same-origin", origin: "http://local" }))).toBe(true)
    expect(isSameOrigin(req(undefined, { "sec-fetch-site": "cross-site" }))).toBe(false)
    expect(isSameOrigin(req(undefined, { "sec-fetch-site": "same-site" }))).toBe(false)
    expect(isSameOrigin(req(undefined, { origin: "https://evil.example" }))).toBe(false)
  })
})
