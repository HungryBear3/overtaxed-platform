/** @jest-environment jsdom */

import React from "react"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render, screen } from "@testing-library/react"

const mockRedirect = jest.fn()
jest.mock("next/navigation", () => ({
  redirect: mockRedirect,
}))

const repoRoot = resolve(__dirname, "..")

function requireExistingModule(path: string) {
  const absolute = resolve(repoRoot, path)
  if (!existsSync(absolute)) {
    expect(existsSync(absolute)).toBe(true)
    return null
  }
  return require(absolute)
}

describe("public 404 recovery", () => {
  beforeEach(() => jest.clearAllMocks())

  it("permanently redirects the observed legacy /index path without creating another crawlable page", () => {
    expect(existsSync(resolve(repoRoot, "app/index/page.tsx"))).toBe(false)
    const config = readFileSync(resolve(repoRoot, "next.config.mjs"), "utf8")
    expect(config).toMatch(/source:\s*["']\/index["']/)
    expect(config).toMatch(/destination:\s*["']\/["']/)
    expect(config).toMatch(/permanent:\s*true/)
  })

  it("redirects legacy plural township URLs to the canonical singular route", async () => {
    const route = requireExistingModule("app/townships/[slug]/page.tsx")
    if (!route) return

    await route.default({ params: Promise.resolve({ slug: "stickney" }) })
    expect(mockRedirect).toHaveBeenCalledWith("/township/stickney")
  })

  it("gives unknown URLs a clear path to the free check and homepage", () => {
    const route = requireExistingModule("app/not-found.tsx")
    if (!route) return

    render(React.createElement(route.default))
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeTruthy()
    expect(screen.getByRole("link", { name: /start a free property check/i }).getAttribute("href")).toBe("/#hero-check")
    expect(screen.getByRole("link", { name: /return home/i }).getAttribute("href")).toBe("/")
  })
})
