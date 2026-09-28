/**
 * @jest-environment jsdom
 *
 * Runtime proof for the real CheckoutPage caller of begin_checkout.
 *
 * Nothing in lib/analytics or lib/attribution is mocked: the page runs the real
 * event emitter down to `window.gtag`, the real GA cookie reader and the real
 * touch store. Only the router, the preview gate and the network are doubles.
 * A checkout intent is one user-initiated submission; it counts as started
 * exactly once, when the server returns a hosted Stripe URL.
 */
import React, { StrictMode } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

import CheckoutPage from "@/components/ot-design/CheckoutPage"

const push = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
jest.mock("@/lib/marketing/preview-gate-client", () => ({
  isClientPreviewStubMode: () => false,
  isClientProductionMarketingRuntime: () => true,
}))

const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_redacted#fidkdWxOYHwnPyd1blpxYHZxWjA0"

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

function response(status: number, body: Record<string, unknown>): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function setCookies(cookies: string[]) {
  Object.defineProperty(document, "cookie", { configurable: true, get: () => cookies.join("; ") })
}

function setReferrer(referrer: string) {
  Object.defineProperty(document, "referrer", { configurable: true, value: referrer })
}

function fillDetails() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Buyer" } })
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Example" } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } })
  fireEvent.change(screen.getByLabelText("Property address"), { target: { value: "2834 W Henderson St, Chicago IL 60618" } })
}

function checkoutForm(container: HTMLElement): HTMLFormElement {
  return container.querySelector("form.ot-checkout-form") as HTMLFormElement
}

function continueButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /continue to payment/i }) as HTMLButtonElement
}

function pageShow(persisted: boolean) {
  const event =
    typeof PageTransitionEvent === "function"
      ? new PageTransitionEvent("pageshow", { persisted })
      : Object.assign(new Event("pageshow"), { persisted })
  window.dispatchEvent(event)
}

let gtag: jest.Mock

function beginCheckoutCalls() {
  return gtag.mock.calls.filter((call) => call[0] === "event" && call[1] === "begin_checkout")
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

let uuidCounter = 0

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  setCookies([])
  setReferrer("")
  window.history.replaceState({}, "", "/checkout")
  gtag = jest.fn()
  window.gtag = gtag
  uuidCounter = 0
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: () => `57dc81a6-1329-4a85-9210-${String(++uuidCounter).padStart(12, "0")}`,
  })
  delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
})

afterEach(() => {
  delete (window as { gtag?: unknown }).gtag
})

describe("begin_checkout from the real checkout page", () => {
  it("emits exactly one begin_checkout, with an empty page URL and referrer, for one successful intent under StrictMode", async () => {
    window.history.replaceState({}, "", "/checkout?email=owner@example.com#result")
    setReferrer("https://partner.example.test/clients/jane-doe-123-main-st")
    global.fetch = jest.fn().mockResolvedValue(response(200, { url: STRIPE_URL })) as jest.Mock

    render(
      <StrictMode>
        <CheckoutPage />
      </StrictMode>,
    )
    fillDetails()
    fireEvent.click(continueButton())

    await waitFor(() => expect(push).toHaveBeenCalledWith(STRIPE_URL))
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(beginCheckoutCalls()).toEqual([
      ["event", "begin_checkout", { plan: "T2", value: 69, page_location: "", page_referrer: "" }],
    ])
    const serialized = JSON.stringify(gtag.mock.calls)
    for (const forbidden of ["owner@example.com", "jane-doe", "Buyer", "Henderson", "cs_test", "checkout.stripe.com"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("sends one request and one begin_checkout when the form is submitted again while the first request is in flight", async () => {
    const pending = deferred<FakeResponse>()
    global.fetch = jest.fn(() => pending.promise) as jest.Mock

    const { container } = render(
      <StrictMode>
        <CheckoutPage />
      </StrictMode>,
    )
    fillDetails()
    fireEvent.submit(checkoutForm(container))
    fireEvent.submit(checkoutForm(container))

    expect(global.fetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve(response(200, { url: STRIPE_URL }))
    })
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(beginCheckoutCalls()).toHaveLength(1)
  })

  it("ignores further submits after the hand-off to Stripe, and treats the next submit after a back-forward restore as a fresh intent", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, { url: STRIPE_URL })) as jest.Mock

    const { container } = render(
      <StrictMode>
        <CheckoutPage />
      </StrictMode>,
    )
    fillDetails()
    fireEvent.click(continueButton())
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))

    fireEvent.submit(checkoutForm(container))
    await settle()
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(beginCheckoutCalls()).toHaveLength(1)

    act(() => {
      pageShow(true)
    })
    expect(continueButton().disabled).toBe(false)
    fireEvent.click(continueButton())

    await waitFor(() => expect(push).toHaveBeenCalledTimes(2))
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(beginCheckoutCalls()).toHaveLength(2)
  })

  it.each([
    ["server failure", () => response(500, { error: "stale request failed" })],
    ["network rejection", () => { throw new Error("stale network failed") }],
    ["JSON rejection", () => ({ ok: true, status: 200, json: async () => { throw new Error("stale JSON failed") } })],
    ["eligibility gate", () => response(409, { code: "T2_ACKNOWLEDGMENT_REQUIRED", error: "stale gate", acknowledgmentToken: "stale.token" })],
    ["success", () => response(200, { url: `${STRIPE_URL}-stale` })],
  ])("ignores stale %s after BFCache restore while the current intent owns the lock", async (_label, staleResponse) => {
    const old = deferred<void>()
    const current = deferred<FakeResponse>()
    global.fetch = jest.fn()
      .mockImplementationOnce(() => old.promise.then(staleResponse))
      .mockImplementation(() => current.promise) as jest.Mock

    const { container } = render(<StrictMode><CheckoutPage /></StrictMode>)
    fillDetails()
    fireEvent.submit(checkoutForm(container))
    act(() => { pageShow(true) })
    expect(continueButton().disabled).toBe(false)
    fireEvent.submit(checkoutForm(container))
    expect(global.fetch).toHaveBeenCalledTimes(2)

    await act(async () => { old.resolve() })
    // Submit the form directly as well as inspecting the disabled button:
    // React state alone cannot protect against another queued submit event.
    fireEvent.submit(checkoutForm(container))
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(push).not.toHaveBeenCalled()
    expect(gtag).not.toHaveBeenCalled()
    expect(container.textContent).not.toMatch(/stale/)
    expect(screen.queryByRole("status")).toBeNull()
    expect((screen.getByRole("button", { name: /checking eligibility/i }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { current.resolve(response(200, { url: STRIPE_URL })) })
    expect(push.mock.calls).toEqual([[STRIPE_URL]])
    expect(beginCheckoutCalls()).toEqual([
      ["event", "begin_checkout", { plan: "T2", value: 69, page_location: "", page_referrer: "" }],
    ])
    expect(gtag).toHaveBeenCalledTimes(1)
    fireEvent.submit(checkoutForm(container))
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it("keeps the hand-off lock across an ordinary (non-restored) pageshow", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, { url: STRIPE_URL })) as jest.Mock

    const { container } = render(<CheckoutPage />)
    fillDetails()
    fireEvent.click(continueButton())
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))

    act(() => {
      pageShow(false)
    })
    fireEvent.submit(checkoutForm(container))
    await settle()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(beginCheckoutCalls()).toHaveLength(1)
  })

  it.each([
    ["a server error", () => Promise.resolve(response(500, { error: "provider unavailable" })), "provider unavailable"],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch")), "Failed to fetch"],
  ])("emits nothing on %s and releases the intent, so a later genuine attempt emits once", async (_label, fail, message) => {
    global.fetch = jest
      .fn()
      .mockImplementationOnce(fail)
      .mockResolvedValueOnce(response(200, { url: STRIPE_URL })) as jest.Mock

    render(
      <StrictMode>
        <CheckoutPage />
      </StrictMode>,
    )
    fillDetails()
    fireEvent.click(continueButton())

    expect(await screen.findByText(message)).toBeTruthy()
    expect(beginCheckoutCalls()).toHaveLength(0)
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(continueButton())
    await waitFor(() => expect(push).toHaveBeenCalledWith(STRIPE_URL))
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(beginCheckoutCalls()).toHaveLength(1)
  })

  it("does not count a server gate as a checkout start; the confirmed resubmission emits once", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        response(409, {
          code: "T2_ACKNOWLEDGMENT_REQUIRED",
          error: "Official date pending",
          acknowledgmentToken: "server.bound.token",
          window: { township: "Jefferson", status: "future_cycle" },
        }),
      )
      .mockResolvedValueOnce(response(200, { url: STRIPE_URL })) as jest.Mock

    render(
      <StrictMode>
        <CheckoutPage />
      </StrictMode>,
    )
    fillDetails()
    fireEvent.click(continueButton())

    fireEvent.click(await screen.findByRole("checkbox", { name: /ordering an assessment analysis now/i }))
    expect(beginCheckoutCalls()).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: /confirm and continue/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith(STRIPE_URL))
    expect(beginCheckoutCalls()).toHaveLength(1)
  })

  it("emits nothing and does not navigate when the page is left before checkout creation returns", async () => {
    const pending = deferred<FakeResponse>()
    global.fetch = jest.fn(() => pending.promise) as jest.Mock

    const view = render(
      <StrictMode>
        <CheckoutPage />
      </StrictMode>,
    )
    fillDetails()
    fireEvent.click(continueButton())
    view.unmount()

    await act(async () => {
      pending.resolve(response(200, { url: STRIPE_URL }))
    })
    await settle()

    expect(push).not.toHaveBeenCalled()
    expect(beginCheckoutCalls()).toHaveLength(0)
  })

  it("treats a remounted checkout page as a new intent with its own checkout key", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, { url: STRIPE_URL })) as jest.Mock

    const first = render(<CheckoutPage />)
    fillDetails()
    fireEvent.click(continueButton())
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    first.unmount()

    render(<CheckoutPage />)
    fillDetails()
    fireEvent.click(continueButton())
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2))

    const keys = (global.fetch as jest.Mock).mock.calls.map((call) => JSON.parse(call[1].body).checkoutKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
    expect(beginCheckoutCalls()).toHaveLength(2)
  })
})

describe("what the checkout request carries", () => {
  const firstTouch = () => ({
    source: "property_manager",
    medium: "email",
    campaign: "hoa_resident_resource_20260723",
    landing: "/hoa",
    at: Date.now() - 3 * 24 * 60 * 60 * 1000,
  })
  const lastTouch = () => ({
    source: "facebook",
    medium: "paid_social",
    campaign: "ot_2026_cicero_deadline",
    content: "v1_video",
    landing: "/appeal-deadline/[slug]",
    at: Date.now() - 60 * 60 * 1000,
  })

  it("carries the stored first and last non-direct touches and the exactly-read GA identifiers", async () => {
    const first = firstTouch()
    const last = lastTouch()
    localStorage.setItem("ot_touch_first_v1", JSON.stringify(first))
    localStorage.setItem("ot_touch_last_v1", JSON.stringify(last))
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-ABC1234"
    setCookies(["_ga=GA1.1.1234567890.1724102400", "_ga_ABC1234=GS1.1.1724102400.4"])
    global.fetch = jest.fn().mockResolvedValue(response(500, { error: "stop after payload capture" })) as jest.Mock

    render(<CheckoutPage />)
    fillDetails()
    fireEvent.click(continueButton())
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.attribution).toEqual({ first, last })
    expect(body).toMatchObject({
      gaClientId: "1234567890.1724102400",
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })
  })

  it("forwards no tampered stored touch", async () => {
    localStorage.setItem("ot_touch_first_v1", JSON.stringify({ ...firstTouch(), source: "owner@example.com" }))
    localStorage.setItem("ot_touch_last_v1", JSON.stringify({ ...lastTouch(), term: "16-01-216-001-0000" }))
    global.fetch = jest.fn().mockResolvedValue(response(500, { error: "stop after payload capture" })) as jest.Mock

    render(<CheckoutPage />)
    fillDetails()
    fireEvent.click(continueButton())
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    const rawBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string
    expect(JSON.parse(rawBody)).not.toHaveProperty("attribution")
    expect(rawBody).not.toContain("owner@example.com")
    expect(rawBody).not.toContain("16-01-216-001-0000")
  })

  it("keeps stored attribution out of the begin_checkout event itself", async () => {
    localStorage.setItem("ot_touch_first_v1", JSON.stringify(firstTouch()))
    localStorage.setItem("ot_touch_last_v1", JSON.stringify(lastTouch()))
    global.fetch = jest.fn().mockResolvedValue(response(200, { url: STRIPE_URL })) as jest.Mock

    render(<CheckoutPage />)
    fillDetails()
    fireEvent.click(continueButton())
    await waitFor(() => expect(push).toHaveBeenCalledWith(STRIPE_URL))

    expect(beginCheckoutCalls()).toEqual([
      ["event", "begin_checkout", { plan: "T2", value: 69, page_location: "", page_referrer: "" }],
    ])
  })
})
