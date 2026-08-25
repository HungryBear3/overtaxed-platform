/**
 * The root analytics boundary must not hold the route tree.
 *
 * `AnalyticsProviderWithSuspense` is mounted once, in the root layout, around
 * `{children}` — i.e. around every route in the app. The provider it wraps
 * calls `useSearchParams()`, and a client component that reads search params
 * cannot be prerendered: React suspends it, and Next resolves the *whole
 * enclosing Suspense boundary* on the client instead, leaving
 * `<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING">` in the served HTML
 * where the page body should be.
 *
 * Because `children` sat inside that boundary, the bailout took the entire
 * page with it: `/`, `/pricing` and `/terms` shipped an empty `<body>` with no
 * H1 and no readable copy, and only looked correct after hydration. A crawler,
 * a link preview, and a reader on a slow or scripted-blocked client all saw
 * nothing.
 *
 * This suite pins the structural contract that fixes it: the search-param
 * tracker may suspend, but route children must render regardless. It is a unit
 * test of the boundary shape; `tests/visual/prerendered-body.spec.ts` proves
 * the same property end-to-end against served bytes.
 *
 * The mock below makes `useSearchParams()` suspend on first call, which is
 * exactly what it does during a static render, and is the only way to observe
 * the boundary's shape from jsdom.
 */
import React from "react"
import "@testing-library/jest-dom"
import { act, render, screen } from "@testing-library/react"

import { AnalyticsProvider, AnalyticsProviderWithSuspense } from "@/components/analytics/analytics-provider"
import { captureUTMParams } from "@/lib/analytics/utm-tracking"

// `var` (not `const`) so the hoisted `jest.mock` factory below can close over
// the binding without hitting its temporal dead zone.
var mockSearchParams: {
  ready: boolean
  value: URLSearchParams
  promise: Promise<void>
  release: () => void
}

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => {
    if (!mockSearchParams.ready) throw mockSearchParams.promise
    return mockSearchParams.value
  },
}))

jest.mock("@/lib/analytics/utm-tracking", () => ({
  captureUTMParams: jest.fn(),
}))

jest.mock("@/lib/analytics/events", () => ({
  trackGA4Event: jest.fn(),
}))

jest.mock("@/components/analytics/meta-pixel", () => ({
  MetaPixel: () => <div data-testid="meta-pixel" />,
}))

function RouteChildren() {
  return (
    <main>
      <h1>Cook County property tax appeals</h1>
      <p>Substantive route copy a crawler must be able to read.</p>
    </main>
  )
}

describe("root analytics Suspense boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    let release: () => void = () => {}
    const promise = new Promise<void>((resolve) => {
      release = () => {
        mockSearchParams.ready = true
        resolve()
      }
    })
    mockSearchParams = { ready: false, value: new URLSearchParams(), promise, release }
  })

  it("renders route children while the search-param tracker is still suspended", () => {
    render(
      <AnalyticsProviderWithSuspense>
        <RouteChildren />
      </AnalyticsProviderWithSuspense>,
    )

    // This is the prerender contract: the H1 and the body copy exist even
    // though the analytics tracker has not resolved. Before the boundary was
    // narrowed, both were swallowed by the provider's fallback.
    expect(
      screen.getByRole("heading", { level: 1, name: /Cook County property tax appeals/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Substantive route copy/i)).toBeInTheDocument()

    // And the tracker really is suspended — otherwise the assertion above
    // would pass for the wrong reason.
    expect(captureUTMParams).not.toHaveBeenCalled()
  })

  it("runs the tracker effects once search params resolve, without remounting children", async () => {
    render(
      <AnalyticsProviderWithSuspense>
        <RouteChildren />
      </AnalyticsProviderWithSuspense>,
    )
    const heading = screen.getByRole("heading", { level: 1 })

    await act(async () => {
      mockSearchParams.release()
      await mockSearchParams.promise
    })

    // Same DOM node: children were never inside the boundary, so resolving it
    // does not tear the page down and rebuild it.
    expect(screen.getByRole("heading", { level: 1 })).toBe(heading)
    expect(captureUTMParams).toHaveBeenCalledTimes(1)
  })

  it("keeps AnalyticsProvider's own children contract intact", async () => {
    mockSearchParams.release()
    await mockSearchParams.promise

    render(
      <AnalyticsProvider>
        <RouteChildren />
      </AnalyticsProvider>,
    )

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument()
    expect(captureUTMParams).toHaveBeenCalledTimes(1)
  })
})
