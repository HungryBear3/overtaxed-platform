/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.overtaxed-il.com/"}
 *
 * The Meta Pixel migration HOLD, enforced where an ordinary merge would take
 * effect rather than in a document.
 *
 * Phase A mounted a Pixel that loaded without consent whenever
 * NEXT_PUBLIC_META_PIXEL_ID was set. The consent-gated candidate has no
 * consent surface to grant it, so mounting it in the live tree would silently
 * stop Meta collection on deploy, and restoring the Phase-A mount would
 * restore nonconsensual collection. Neither ships: the live tree mounts no
 * Pixel at all, and a build with the variable set refuses to evaluate its
 * config — the deployment that would change behavior is never built, and the
 * current one keeps serving until the owner decides.
 */
import React from "react"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { act, render } from "@testing-library/react"

jest.mock("@/lib/marketing/preview-gate-client", () => ({
  isClientPreviewStubMode: () => false,
  isClientProductionMarketingRuntime: () => true,
}))
jest.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

import { AnalyticsProvider } from "@/components/analytics/analytics-provider"
import { MARKETING_CONSENT_STORAGE_KEY } from "@/lib/analytics/meta-pixel-policy"

const PIXEL_ID = "1234567890123456"

describe("the live analytics tree", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID
    localStorage.clear()
    delete (window as { fbq?: unknown }).fbq
    delete (window as { _fbq?: unknown })._fbq
  })

  it("mounts no Meta Pixel, even in production on the canonical host with a configured id and a granted consent", async () => {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = PIXEL_ID
    localStorage.setItem(
      MARKETING_CONSENT_STORAGE_KEY,
      JSON.stringify({ version: 1, meta_pixel: "granted", decided_at: Date.now() }),
    )

    render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )
    await act(async () => {})

    expect(document.querySelectorAll('script[src*="facebook"]')).toHaveLength(0)
    expect((window as { fbq?: unknown }).fbq).toBeUndefined()
    expect((window as { _fbq?: unknown })._fbq).toBeUndefined()
  })
})

describe("the build config", () => {
  const CONFIG = pathToFileURL(join(process.cwd(), "next.config.mjs")).href

  /** Evaluates the config Next resolves, as a production build does, in a clean process: PATH plus `extra`. */
  function evaluate(extra: Record<string, string>) {
    return spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import c from ${JSON.stringify(CONFIG)};process.stdout.write(JSON.stringify(c))`],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", ...extra } },
    )
  }

  it.each([
    ["no Meta Pixel id", {}],
    ["an empty Meta Pixel id", { NEXT_PUBLIC_META_PIXEL_ID: "" }],
  ])("evaluates with %s", (_label, extra) => {
    const result = evaluate(extra)

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).images).toEqual({ unoptimized: true })
  })

  it.each([PIXEL_ID, "123456789", " "])("refuses to build while a Meta Pixel id is set (%j), without echoing it", (value) => {
    const result = evaluate({ NEXT_PUBLIC_META_PIXEL_ID: value })

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("META_PIXEL_ACTIVATION_HOLD")
    if (value.trim() !== "") expect(result.stderr).not.toContain(value)
  })
})
