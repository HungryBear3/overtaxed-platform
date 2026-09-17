import { test, expect } from "@playwright/test"

test.use({ launchOptions: process.env.OT_BROWSER_PATH ? { executablePath: process.env.OT_BROWSER_PATH } : {} })

// Harmless observer emulates already executed instrumentation. No analytics
// service or bearer credential is used. Run against the local candidate server.
for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`packet fresh-document boundary ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const violations: string[] = []
    await page.exposeFunction("reportPacketExposure", () => violations.push("form mounted in old document"))
    await page.goto("/packet")
    await expect(page.getByRole("textbox")).toBeVisible()
    expect(await page.locator('script[src*="googletagmanager"],script[src*="vercel-scripts"],script[src*="insights/script"]').count()).toBe(0)
    // Exercise private -> public -> private, also proving the latch cannot reset.
    await page.evaluate(() => (window as any).next.router.push("/pricing"))
    await expect(page).toHaveURL(/\/pricing$/)
    await expect(page.getByRole("textbox")).toHaveCount(0)
    await page.evaluate(() => {
      ;(window as any).oldDocumentObserver = true
      const inspect = () => {
        if (document.querySelector('input[name="packet-code"]')) (window as any).reportPacketExposure()
      }
      new MutationObserver(inspect).observe(document.body, { subtree: true, childList: true })
      document.addEventListener("input", inspect) // intentionally never removed
    })
    const freshDocument = page.waitForRequest(request => request.isNavigationRequest() && new URL(request.url()).pathname === "/packet")
    await page.evaluate(() => (window as any).next.router.push("/packet"))
    await freshDocument
    await expect(page.getByRole("textbox")).toBeVisible()
    expect(await page.evaluate(() => (window as any).oldDocumentObserver)).toBeUndefined()
    expect(violations).toEqual([])
    expect(await page.evaluate(() => ({ gtag: typeof (window as any).gtag, dataLayer: typeof (window as any).dataLayer }))).toEqual({ gtag: "undefined", dataLayer: "undefined" })
  })
}
