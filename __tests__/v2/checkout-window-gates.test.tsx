/** @jest-environment jsdom */
import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import CheckoutPage from "@/components/ot-design/CheckoutPage"

const push = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
jest.mock("@/lib/marketing/preview-gate-client", () => ({ isClientPreviewStubMode: () => false }))

function response(status: number, body: Record<string, unknown>) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function fillDetails() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Buyer" } })
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Example" } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } })
  fireEvent.change(screen.getByLabelText("Property address"), { target: { value: "2834 W Henderson St, Chicago IL 60618" } })
}

beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: () => "57dc81a6-1329-4a85-9210-0d6f574ea65d" })
})

describe("OT checkout filing-window UI", () => {
  it("honors a Done-For-You plan selected by the entry URL", () => {
    render(<CheckoutPage initialPlan="dfy" />)
    expect((document.querySelector('input[value="dfy"]') as HTMLInputElement).checked).toBe(true)
    expect(screen.getAllByText("$97")).toHaveLength(2)
  })

  it("renders the server-required T2 pending acknowledgment and sends the bound token only after checking it", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(409, {
        code: "T2_ACKNOWLEDGMENT_REQUIRED",
        error: "Official date pending",
        acknowledgmentToken: "server.bound.token",
        window: { township: "Jefferson", status: "future_cycle" },
      }))
      .mockResolvedValueOnce(response(500, { error: "stop after payload capture" }))
    global.fetch = fetchMock as jest.Mock

    render(<CheckoutPage />)
    fillDetails()
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }))

    const ack = await screen.findByRole("checkbox", { name: /ordering an assessment analysis now/i })
    expect(screen.getByText(/official window isn't confirmed yet/i)).toBeTruthy()
    expect((screen.getByRole("button", { name: /confirm and continue/i }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(ack)
    fireEvent.click(screen.getByRole("button", { name: /confirm and continue/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(secondBody).toMatchObject({
      tier: "T2",
      checkoutKey: "57dc81a6-1329-4a85-9210-0d6f574ea65d",
      analysisAcknowledged: true,
      acknowledgmentToken: "server.bound.token",
    })
  })

  it("renders T3 blocking as a disabled payment control with a free-check fallback", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(409, {
      code: "T3_WINDOW_BLOCKED",
      error: "Full filing unavailable",
      window: { township: "Jefferson", status: "closed" },
    })) as jest.Mock

    render(<CheckoutPage />)
    fireEvent.click(document.querySelector('input[value="dfy"]') as HTMLInputElement)
    fillDetails()
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }))

    expect(await screen.findByText(/can't offer a full filing for this property right now/i)).toBeTruthy()
    const unavailable = screen.getByRole("button", { name: "Payment unavailable" })
    expect((unavailable as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole("link", { name: /check my township for free/i }).getAttribute("href")).toBe("/#free-check")
  })

  it("shows address choices and does not retain a payment CTA while the property is ambiguous", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(409, {
      code: "ADDRESS_AMBIGUOUS",
      error: "More than one match",
      candidates: [
        { pin: "11111111111111", address: "123 MAIN ST UNIT 1", city: "CHICAGO", township: "Lake View" },
        { pin: "22222222222222", address: "123 MAIN ST UNIT 2", city: "CHICAGO", township: "Rogers Park" },
      ],
    })) as jest.Mock

    render(<CheckoutPage />)
    fillDetails()
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }))

    expect(await screen.findByText(/found more than one possible match/i)).toBeTruthy()
    expect(screen.getAllByRole("radio", { name: /123 MAIN ST UNIT/ })).toHaveLength(2)
    expect(screen.queryByRole("button", { name: /continue to payment/i })).toBeNull()
    expect((screen.getByRole("button", { name: /use this property/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})
