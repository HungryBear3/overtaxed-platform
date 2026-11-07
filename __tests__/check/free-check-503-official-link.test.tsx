/**
 * A 503 from the free-check route is a refusal on our side: no figures are
 * shown. The reader still needs somewhere official to go, so the refusal
 * carries the same Assessor address-search link every other refusal carries.
 *
 * The link target is the code-owned official URL, never a URL read from the
 * response body.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"

import { FreeCheckForm } from "@/components/check/FreeCheckForm"
import { OFFICIAL_DEADLINE_SOURCES } from "@/lib/deadline-sources"

const OFFICIAL_ADDRESS_SEARCH_URL = "https://www.cookcountyassessoril.gov/address-search"
const HOLD_ERROR =
  "We are not able to retrieve a complete, consistent Cook County record set for this check yet, so no figures are shown. Look the property up on the Assessor's site."

function stubPost(status: number, body: unknown) {
  global.fetch = jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch
}

function submitPin() {
  fireEvent.change(screen.getByLabelText(/Cook County PIN/i), { target: { value: "16012160010000" } })
  fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }))
}

describe("/check 503 refusal carries the official Assessor link", () => {
  const onResult = jest.fn()

  beforeEach(() => {
    onResult.mockReset()
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  it("the link target is an entry of the official source catalog", () => {
    expect(OFFICIAL_DEADLINE_SOURCES.map((s) => s.href)).toContain(OFFICIAL_ADDRESS_SEARCH_URL)
  })

  it.each([
    ["an acquisition hold", { error: HOLD_ERROR, code: "ACQUISITION_HOLD", hold: "ACQUISITION_REJECTED", assessorAddressSearchUrl: OFFICIAL_ADDRESS_SEARCH_URL }],
    ["a refusal without a link field", { error: "Stored results are temporarily unavailable.", code: "ACCESS_UNAVAILABLE" }],
    ["a refusal without a message", {}],
  ])("links the Assessor address search on %s", async (_name, body) => {
    stubPost(503, body)
    render(<FreeCheckForm onResult={onResult} />)

    submitPin()

    const notice = await screen.findByRole("status")
    const link = within(notice).getByRole("link", { name: /Assessor's address search/i })
    expect(link.getAttribute("href")).toBe(OFFICIAL_ADDRESS_SEARCH_URL)
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
    expect(onResult).not.toHaveBeenCalled()
  })

  it("keeps the refusal text and never follows a URL supplied by the response", async () => {
    stubPost(503, { error: HOLD_ERROR, code: "ACQUISITION_HOLD", hold: "ACQUISITION_REJECTED", assessorAddressSearchUrl: "https://assessor.example.invalid/address-search" })
    render(<FreeCheckForm onResult={onResult} />)

    submitPin()

    const notice = await screen.findByRole("status")
    expect(notice.textContent).toContain(HOLD_ERROR)
    const hrefs = within(notice).getAllByRole("link").map((a) => a.getAttribute("href"))
    expect(hrefs).toEqual([OFFICIAL_ADDRESS_SEARCH_URL])
  })

  it("offers no paid action alongside the refusal", async () => {
    stubPost(503, { error: HOLD_ERROR, code: "ACQUISITION_HOLD", hold: "ACQUISITION_UNSUPPORTED", assessorAddressSearchUrl: OFFICIAL_ADDRESS_SEARCH_URL })
    render(<FreeCheckForm onResult={onResult} />)

    submitPin()

    await screen.findByRole("status")
    expect(screen.queryByRole("button", { name: /paid|checkout|report/i })).toBeNull()
    expect(screen.queryByRole("link", { name: /paid|checkout|pricing/i })).toBeNull()
  })
})
