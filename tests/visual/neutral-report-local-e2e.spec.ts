import { expect, test, type Page } from "@playwright/test"

const neutral = process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED === "true"
const paths = ["/", "/pricing", "/checkout", "/terms", "/checkout/success"] as const

function captureRuntimeFailures(page: Page) {
  const failures: string[] = []
  page.on("pageerror", error => failures.push(`pageerror: ${error.message}`))
  page.on("console", message => {
    const source = message.location().url
    if (message.type() === "error" && !source.includes("/_vercel/insights/")) {
      failures.push(`console: ${message.text()} @ ${source}`)
    }
  })
  return failures
}

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })))
    .toEqual(expect.objectContaining({ width: expect.any(Number), scroll: expect.any(Number) }))
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
  expect(dimensions.scroll, `horizontal overflow: ${dimensions.scroll} > ${dimensions.width}`).toBeLessThanOrEqual(dimensions.width + 1)
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "iphone", width: 390, height: 844 },
] as const) {
  test.describe(`${neutral ? "neutral-on" : "neutral-off"} ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const path of paths) {
      test(`${path} renders without runtime errors or overflow`, async ({ page }) => {
        const failures = captureRuntimeFailures(page)
        await page.goto(path, { waitUntil: "domcontentloaded" })
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
        await expectNoOverflow(page)
        expect(failures).toEqual([])

        const body = page.locator("body")
        if (neutral && path !== "/checkout/success") {
          await expect(body).toContainText(/Assessment Records|records report|official records/i)
          await expect(body).not.toContainText(/DIY Appeal Packet|appeal argument tailored/i)
        }
        if (!neutral && path !== "/checkout/success") {
          await expect(body).not.toContainText("Cook County Assessment Records & Matching Property Report")
        }
      })
    }
  })
}

test("neutral checkout posts only to the local checkout API and follows its mocked URL", async ({ page }) => {
  test.skip(!neutral, "neutral-copy server required")
  const failures = captureRuntimeFailures(page)
  let requestBody: Record<string, unknown> | undefined
  await page.route("**/api/checkout/session", async route => {
    requestBody = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "/checkout/success" }) })
  })
  await page.goto("/checkout")
  await page.getByLabel("First name").fill("Sample")
  await page.getByLabel("Last name").fill("Owner")
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("owner@example.invalid")
  await page.getByLabel("Property address").fill("1234 N Sample St, Chicago IL 60600")
  await page.getByRole("button", { name: /Continue to payment/ }).click()
  await expect(page).toHaveURL(/\/checkout\/success$/)
  expect(requestBody).toMatchObject({ tier: "T2", email: "owner@example.invalid", name: "Sample Owner" })
  expect(failures).toEqual([])
})

test("packet redemption downloads the mocked neutral ZIP without external calls", async ({ page }) => {
  const failures = captureRuntimeFailures(page)
  const capability = "A".repeat(43)
  const zip = Buffer.from("PK\u0003\u0004synthetic-neutral-zip")
  await page.route("**/api/ot/packet/download", async route => {
    expect(route.request().method()).toBe("POST")
    expect(route.request().url()).not.toContain("?")
    expect(route.request().postDataJSON()).toEqual({ capability })
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      headers: { "Content-Disposition": 'attachment; filename="overtaxed-records-report.zip"' },
      body: zip,
    })
  })
  await page.goto("/packet")
  await page.getByLabel("One-time code").fill(capability)
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download packet" }).click()
  const received = await download
  expect(received.suggestedFilename()).toBe("overtaxed-records-report.zip")
  await expect(page.getByRole("status")).toContainText(/downloaded/i)
  await expect(page.getByLabel("One-time code")).toHaveValue("")
  expect(failures).toEqual([])
})
