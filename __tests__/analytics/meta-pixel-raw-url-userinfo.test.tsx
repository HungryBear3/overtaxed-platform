/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://jane-doe:123-main-st@www.overtaxed-il.com/"}
 *
 * The Pixel reports `location.href` raw. A browser's `location.origin`, host,
 * path, search and hash never show URL userinfo, so a page whose parts are all
 * clean can still hand the vendor a name and a street in its username and
 * password. The candidate is judged on the raw href: with every other gate
 * open, this page inserts no script and nothing reaches the SDK.
 */
import React from "react"
import { act, render } from "@testing-library/react"

jest.mock("@/lib/marketing/preview-gate-client", () => ({
  isClientPreviewStubMode: () => false,
  isClientProductionMarketingRuntime: () => true,
}))
jest.mock("next/navigation", () => ({ usePathname: () => window.location.pathname }))

import { MetaPixelCandidate, trackMetaEvent } from "@/components/analytics/meta-pixel"
import { MARKETING_CONSENT_STORAGE_KEY } from "@/lib/analytics/meta-pixel-policy"

const PIXEL_ID = "1234567890123456"

type FbqStub = ((...args: unknown[]) => void) & { queue: unknown[][]; callMethod?: (...args: unknown[]) => void }

const fbq = () => (window as unknown as { fbq?: FbqStub }).fbq
const pixelScripts = () => Array.from(document.querySelectorAll("script")).filter((script) => script.src.includes("facebook"))

beforeEach(() => {
  localStorage.setItem(
    MARKETING_CONSENT_STORAGE_KEY,
    JSON.stringify({ version: 1, meta_pixel: "granted", decided_at: Date.now() - 60_000 }),
  )
})

it("is a page whose decomposed parts are all clean while its raw URL carries userinfo", () => {
  expect(window.location.origin).toBe("https://www.overtaxed-il.com")
  expect(window.location.host).toBe("www.overtaxed-il.com")
  expect([window.location.pathname, window.location.search, window.location.hash]).toEqual(["/", "", ""])
  expect(window.location.href).toBe("https://jane-doe:123-main-st@www.overtaxed-il.com/")
})

it("inserts no script, installs no fbq and sends nothing from a page whose raw URL carries userinfo", () => {
  render(<MetaPixelCandidate pixelId={PIXEL_ID} />)

  expect(pixelScripts()).toHaveLength(0)
  expect(fbq()).toBeUndefined()

  // Had anything been installed, this is everything a ready SDK would send.
  const sdk = jest.fn()
  act(() => {
    const stub = fbq()
    if (stub) {
      stub.callMethod = sdk
      for (const call of stub.queue.splice(0)) sdk(...call)
      for (const script of pixelScripts()) script.dispatchEvent(new Event("load"))
    }
    trackMetaEvent("PageView")
    trackMetaEvent("InitiateCheckout", { content_name: "T2", value: 69 })
  })

  expect(sdk).not.toHaveBeenCalled()
})
