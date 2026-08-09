/** @jest-environment jsdom */

import "@testing-library/jest-dom"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ManualReviewControl } from "@/components/admin/ManualReviewControl"

const refreshMock = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

const eligible = {
  eligible: true as const,
  status: "ARTIFACT_PENDING" as const,
  statusRevision: 2,
  reason: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      outcome: "ENTERED_MANUAL_REVIEW",
      status: "MANUAL_REVIEW",
      statusRevision: 3,
    }),
  }) as jest.Mock
})

describe("ManualReviewControl", () => {
  it("renders no interactive control while the mutation flag is off", () => {
    render(
      <ManualReviewControl orderId="ord_1" enabled={false} capability={eligible} />,
    )
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("shows reconciliation copy but no button for a paid order with no ledger", () => {
    render(
      <ManualReviewControl
        orderId="ord_1"
        enabled
        capability={{
          eligible: false,
          status: null,
          statusRevision: null,
          reason: "NO_FULFILLMENT_SUMMARY",
        }}
      />,
    )
    expect(screen.getByText(/reconciliation/i)).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it.each([
    "INELIGIBLE_SOURCE_STATUS",
    "LEASE_PRESENT",
    "DOWNSTREAM_EVIDENCE_PRESENT",
  ])("renders no button for %s", (reason) => {
    render(
      <ManualReviewControl
        orderId="ord_1"
        enabled
        capability={{
          eligible: false,
          status: "ARTIFACT_PENDING",
          statusRevision: 2,
          reason,
        }}
      />,
    )
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("renders exactly one narrowly named control and explicit no-side-effect copy", () => {
    const { container } = render(
      <ManualReviewControl orderId="ord_1" enabled capability={eligible} />,
    )
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(
      screen.getByRole("button", { name: /enter manual review/i }),
    ).toBeEnabled()
    expect(screen.getByText(/does not send or generate/i)).toBeInTheDocument()
    expect(container.textContent?.toLowerCase()).not.toMatch(
      /retry|regenerate|deliver|payment|refund/,
    )
  })

  it("posts exact displayed status/revision and refreshes on success", async () => {
    render(<ManualReviewControl orderId="ord_1" enabled capability={eligible} />)
    fireEvent.click(screen.getByRole("button", { name: /enter manual review/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/evidence/ord_1/manual-review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ENTER_MANUAL_REVIEW",
          expectedStatus: "ARTIFACT_PENDING",
          expectedStatusRevision: 2,
        }),
      },
    )
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1))
  })

  it("shows stale guidance and refreshes on 409", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, code: "STALE_STATE" }),
    })
    render(<ManualReviewControl orderId="ord_1" enabled capability={eligible} />)
    fireEvent.click(screen.getByRole("button", { name: /enter manual review/i }))

    expect(
      await screen.findByText(/State changed; refresh and review current evidence/i),
    ).toBeInTheDocument()
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it("submits at most once under a double click", async () => {
    let resolveFetch!: (value: unknown) => void
    ;(global.fetch as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    render(<ManualReviewControl orderId="ord_1" enabled capability={eligible} />)
    const button = screen.getByRole("button", { name: /enter manual review/i })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, outcome: "ENTERED_MANUAL_REVIEW" }),
    })
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1))
  })
})
