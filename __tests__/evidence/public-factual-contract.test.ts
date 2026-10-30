/**
 * @jest-environment node
 */
import { readFileSync } from "fs"
import { join } from "path"
import {
  decodeFactualResultJson,
  FACTUAL_SCHEMA_VERSION,
  MAX_FACTUAL_JSON_BYTES,
  REQUIRED_LIMITATIONS,
} from "@/lib/evidence/public-factual-contract"
import { createFactualLocalRuntime, SYNTHETIC_SUBJECT_PIN } from "@/test-support/factual-local-fixture"

async function validBody(): Promise<Record<string, unknown>> {
  const { route } = createFactualLocalRuntime()
  const post = await route.POST(new Request("http://local/api/free-check", { method: "POST", body: JSON.stringify({ pin: SYNTHETIC_SUBJECT_PIN }) }))
  const receipt = await post.json()
  const get = await route.GET(new Request(`http://local/api/free-check?id=${receipt.resultId}`))
  return JSON.parse(await get.text())
}

describe("baseline witness: legacy free route carried claim-bearing slots", () => {
  const root = process.cwd()
  it("route no longer ships the favorable preview sample or appeal argument", () => {
    const src = readFileSync(join(root, "app/api/free-check/route.ts"), "utf8")
    expect(src).not.toMatch(/PREVIEW_FREE_CHECK_SAMPLE|appealArgumentText|equityRatio|buildAppealArgument/)
    expect(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")).not.toMatch(/export (const|async function|function) (?!POST|GET|maxDuration|dynamic)/)
  })
  it("homepage no longer normalizes legacy bodies into a result", () => {
    const src = readFileSync(join(root, "components/ot-design/HomePage.tsx"), "utf8")
    expect(src).not.toMatch(/normalizeCheckResult\(data/)
  })
})

describe("FACTUAL_ONLY public contract decoder", () => {
  it("accepts the valid server body with raw facts and UNKNOWN window", async () => {
    const body = await validBody()
    const decoded = decodeFactualResultJson(JSON.stringify(body))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.schema).toBe(FACTUAL_SCHEMA_VERSION)
    expect(decoded.value.validation).toBe("UNVALIDATED")
    expect(decoded.value.window).toEqual({ state: "UNKNOWN", actionable: false })
    expect(decoded.value.records.some((r) => r.recordDate === null)).toBe(true)
    for (const key of REQUIRED_LIMITATIONS) expect(decoded.value.limitations).toContain(key)
  })

  const cases: Array<[string, (b: any) => unknown]> = [
    ["old VALIDATED", (b) => ({ ...b, validation: "VALIDATED" })],
    ["normalized ref1 slot", (b) => ({ ...b, normalized: { ref: 1, status: "OVER" } })],
    ["$999 savings slot", (b) => ({ ...b, savings: 999 })],
    ["$1 finding vs $999 record forgery", (b) => ({ ...b, finding: { ...b.finding, subjectAssessedTotalCents: 100 } })],
    ["+40 percentage slot", (b) => ({ ...b, finding: { ...b.finding, percentage: 40 } })],
    ["omitted limitation", (b) => ({ ...b, limitations: b.limitations.filter((l: string) => l !== "window_unknown") })],
    ["stale OPEN window", (b) => ({ ...b, window: { state: "OPEN", actionable: true } })],
    ["missing source", (b) => ({ ...b, sources: [] })],
    ["freeform source URL", (b) => ({ ...b, sources: ["https://evil.example/"] })],
    ["unknown version", (b) => ({ ...b, schema: "factual-only/v9" })],
    ["wrong type", (b) => ({ ...b, snapshotVersion: "1" })],
    ["record township rewrite to non-cohort pin", (b) => ({ ...b, subject: { ...b.subject, pin: "99-99-999-999-9999" } })],
    ["SYNTHETIC label removed while records stay synthetic? -> unknown origin", (b) => ({ ...b, dataOrigin: "VERIFIED" })],
  ]
  it.each(cases)("rejects %s", async (_name, mutate) => {
    const decoded = decodeFactualResultJson(JSON.stringify(mutate(await validBody())))
    expect(decoded.ok).toBe(false)
  })

  it("rejects duplicate keys, oversize, deep nesting and non-JSON", async () => {
    const text = JSON.stringify(await validBody())
    expect(decodeFactualResultJson(text.replace('"validation":"UNVALIDATED"', '"validation":"UNVALIDATED","validation":"VALIDATED"')).ok).toBe(false)
    expect(decodeFactualResultJson(text.slice(0, -1) + `,"pad":"${"x".repeat(MAX_FACTUAL_JSON_BYTES+1)}"}`)).toEqual({ ok: false, code: "TOO_LARGE" })
    expect(decodeFactualResultJson("[".repeat(40) + "]".repeat(40))).toEqual({ ok: false, code: "TOO_DEEP" })
    expect(decodeFactualResultJson("{'a':1}").ok).toBe(false)
  })

  it("documented limit: a coherent schema-valid raw number rewrite cannot be authenticated offline", async () => {
    const b: any = await validBody()
    const delta = 100_000
    b.records = b.records.map((r: any) => (r.role === "subject" ? { ...r, assessedTotalCents: r.assessedTotalCents + delta, buildingCents: r.buildingCents + delta } : r))
    b.finding = { ...b.finding, subjectAssessedTotalCents: b.finding.subjectAssessedTotalCents + delta }
    // Accepted by the decoder: only server-ID reload (see factual-server tests) defends this.
    expect(decodeFactualResultJson(JSON.stringify(b)).ok).toBe(true)
  })
})
