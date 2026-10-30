/** @jest-environment ./test-support/factual-jsdom-environment.cjs */
import { act, render, screen, waitFor } from "@testing-library/react"
import { FreeCheckResult } from "@/components/check/FreeCheckResult"
import HomePage from "@/components/ot-design/HomePage"
import {
  createFactualLocalRuntime,
  SYNTHETIC_SECOND_PIN,
  SYNTHETIC_SUBJECT_PIN,
} from "@/test-support/factual-local-fixture"

type Rt = ReturnType<typeof createFactualLocalRuntime>

/** fetch delegates to the actual DI route handler; `rewrite` simulates a tampering hop. */
function installFetch(rt: Rt, opts: { rewrite?: (b: any) => any; gate?: Record<string, Promise<void>> } = {}) {
  const f = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://local")
    if (url.pathname !== "/api/free-check") return new Response("{}", { status: 404 })
    const req = new Request(url, init as RequestInit)
    const res = init?.method === "POST" ? await rt.route.POST(req) : await rt.route.GET(req)
    const id = url.searchParams.get("id") ?? ""
    if (opts.gate?.[id]) await opts.gate[id]
    if (!opts.rewrite || init?.method === "POST") return res
    return new Response(JSON.stringify(opts.rewrite(JSON.parse(await res.text()))), { status: res.status })
  })
  ;(global as any).fetch = f
  return f
}

async function receipt(rt: Rt, pin: string) {
  return (await rt.route.POST(new Request("http://local/api/free-check", { method: "POST", body: JSON.stringify({ pin }) }))).json()
}

const FAVORABLE = /savings|overpa|eligible|strong case|\$999|deadline|window is open/i

describe("both free consumers render one server result through the shared renderer", () => {
  it("/check FreeCheckResult shows raw assessments, sources, limitations and UNKNOWN window", async () => {
    const rt = createFactualLocalRuntime()
    installFetch(rt)
    const r = await receipt(rt, SYNTHETIC_SUBJECT_PIN)
    render(<FreeCheckResult result={r} />)
    await screen.findByTestId("factual-summary")
    expect(screen.getByTestId("factual-summary").getAttribute("data-result-id")).toBe(r.resultId)
    expect(screen.getByRole("heading", { name: /SYNTHETIC PREVIEW/ })).toBeTruthy()
    expect(screen.getByText("$42,500.00")).toBeTruthy()
    expect(screen.getAllByRole("link").some((a) => (a as HTMLAnchorElement).href.startsWith("https://datacatalog.cookcountyil.gov/"))).toBe(true)
    expect(screen.getByText(/Filing window: UNKNOWN/)).toBeTruthy()
    expect(document.body.textContent).toMatch(/date not stated in source/i)
    expect(document.body.textContent).not.toMatch(FAVORABLE)
  })

  const forgeries: Array<[string, (b: any) => any]> = [
    ["VALIDATED/ref1/$999", (b) => ({ ...b, validation: "VALIDATED", normalized: { ref: 1 }, savings: 999 })],
    ["$1 vs +40", (b) => ({ ...b, finding: { ...b.finding, subjectAssessedTotalCents: 100, percentage: 40 } })],
    ["omitted limitation", (b) => ({ ...b, limitations: b.limitations.slice(1) })],
    ["stale OPEN", (b) => ({ ...b, window: { state: "OPEN", actionable: true } })],
    ["whole-body township rewrite", (b) => ({ ...b, subject: { ...b.subject, township: "Lemont" } })],
    ["missing source", (b) => ({ ...b, sources: [] })],
    ["different server result id", (b) => ({ ...b, resultId: "res_" + "z".repeat(24) })],
  ]
  it.each(forgeries)("FreeCheckResult refuses %s without favorable fallback", async (_n, rewrite) => {
    const rt = createFactualLocalRuntime()
    installFetch(rt, { rewrite })
    render(<FreeCheckResult result={await receipt(rt, SYNTHETIC_SUBJECT_PIN)} />)
    await screen.findByTestId("factual-refused")
    expect(screen.queryByTestId("factual-summary")).toBeNull()
    expect(document.body.textContent).not.toMatch(FAVORABLE)
    expect(document.body.textContent).not.toMatch(/\$42,500/)
  })

  it("FreeCheckResult refuses a legacy body (no server identity)", async () => {
    render(<FreeCheckResult result={{ success: true, potentialOverpaymentPerYear: 999, outcome: { code: "supportive" } } as any} />)
    await screen.findByTestId("factual-refused")
    expect(document.body.textContent).not.toMatch(FAVORABLE)
  })

  it("FreeCheckResult A->B: A is never shown as B and late A cannot paint over B", async () => {
    const rt = createFactualLocalRuntime()
    let releaseA!: () => void
    const a = await receipt(rt, SYNTHETIC_SUBJECT_PIN)
    const b = await receipt(rt, SYNTHETIC_SECOND_PIN)
    installFetch(rt, { gate: { [a.resultId]: new Promise<void>((r) => (releaseA = r)) } })
    const view = render(<FreeCheckResult result={a} />)
    view.rerender(<FreeCheckResult result={b} />)
    // Render-time binding: before any effect resolves, nothing bound to A shows.
    expect(screen.queryByTestId("factual-summary")).toBeNull()
    await waitFor(() => expect(screen.getByTestId("factual-summary").getAttribute("data-result-id")).toBe(b.resultId))
    await act(async () => { releaseA(); await new Promise((r) => setTimeout(r, 10)) })
    expect(screen.getByTestId("factual-summary").getAttribute("data-result-id")).toBe(b.resultId)
    expect(document.body.textContent).toContain("Berwyn")
    expect(document.body.textContent).not.toContain("Cicero")
  })

  it("HomePage uses the same shared renderer and same server identity, with late-A defense", async () => {
    const rt = createFactualLocalRuntime()
    let releaseA!: () => void
    const a = await receipt(rt, SYNTHETIC_SUBJECT_PIN)
    const b = await receipt(rt, SYNTHETIC_SECOND_PIN)
    installFetch(rt, { gate: { [a.resultId]: new Promise<void>((r) => (releaseA = r)) } })
    render(<HomePage />)
    act(() => { window.dispatchEvent(new CustomEvent("ot:free-check-result", { detail: { result: a } })) })
    act(() => { window.dispatchEvent(new CustomEvent("ot:free-check-result", { detail: { result: b } })) })
    expect(screen.queryByTestId("factual-summary")).toBeNull()
    await waitFor(() => expect(screen.getByTestId("factual-summary").getAttribute("data-result-id")).toBe(b.resultId))
    await act(async () => { releaseA(); await new Promise((r) => setTimeout(r, 10)) })
    expect(screen.getByTestId("factual-summary").getAttribute("data-result-id")).toBe(b.resultId)
    expect(screen.getByTestId("factual-summary").textContent).toContain("Berwyn")
  })

  it("HomePage refuses a forged body with no favorable fallback", async () => {
    const rt = createFactualLocalRuntime()
    installFetch(rt, { rewrite: (b) => ({ ...b, validation: "VALIDATED" }) })
    const a = await receipt(rt, SYNTHETIC_SUBJECT_PIN)
    render(<HomePage />)
    act(() => { window.dispatchEvent(new CustomEvent("ot:free-check-result", { detail: { result: a } })) })
    await screen.findByTestId("factual-refused")
    expect(screen.queryByTestId("factual-summary")).toBeNull()
  })
})
