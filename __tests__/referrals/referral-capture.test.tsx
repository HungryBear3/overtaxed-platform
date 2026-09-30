/**
 * ReferralCapture is the first place a hostile `?ref=` value lands. It may set
 * the `ot_ref` cookie and POST the visit only for a canonical code, and it must
 * write and send the canonical form — never the raw query value.
 */
import { render } from "@testing-library/react"

let search = new URLSearchParams()
jest.mock("next/navigation", () => ({
  useSearchParams: () => search,
}))
jest.mock("@/lib/marketing/preview-gate-client", () => ({
  isClientPreviewStubMode: () => false,
}))

import { ReferralCapture } from "@/components/ReferralCapture"

const fetchMock = jest.fn(async () => new Response(JSON.stringify({ ok: true })))

function clearCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0].trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

beforeEach(() => {
  clearCookies()
  fetchMock.mockClear()
  global.fetch = fetchMock as unknown as typeof fetch
})

function mountWith(query: string) {
  search = new URLSearchParams(query)
  render(<ReferralCapture />)
}

describe("ReferralCapture", () => {
  it.each([
    ["an email", "ref=owner%40example.com"],
    ["a name with a space", "ref=John%20Smith"],
    ["a URL", "ref=https%3A%2F%2Fevil.example"],
    ["cookie injection", "ref=john%3B%20Domain%3Devil.example"],
    ["a control character", "ref=john%00"],
    ["a Cyrillic confusable", "ref=j%D0%BEhn"],
    ["an oversized value", `ref=${"a".repeat(65)}`],
    ["an empty value", "ref="],
  ])("sets no cookie and sends nothing for %s", (_label, query) => {
    mountWith(query)
    expect(document.cookie).not.toContain("ot_ref")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does nothing without a ref parameter", () => {
    mountWith("utm_source=newsletter")
    expect(document.cookie).not.toContain("ot_ref")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("stores and posts only the canonical form of a valid code", () => {
    mountWith("ref=John")
    expect(document.cookie).toContain("ot_ref=john")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/referrals/visit")
    expect(JSON.parse(String(init.body))).toEqual({ code: "john" })
  })
})
