/**
 * Browser E2E for the free-check address flow, desktop and mobile.
 *
 * `/api/free-check` is intercepted in the browser and answered with synthetic
 * Cook County-shaped fixtures. Nothing here reaches Socrata, and no real
 * address or PIN is typed, requested, or rendered — the street is "Sample" and
 * the PINs are a fixed synthetic prefix. The server-side flow is covered by
 * `__tests__/check/free-check-route-address.test.ts`; what this file proves is
 * that the rendered surfaces behave on the four states that flow produces.
 *
 * Run against a local production server:
 *   npm run build && npx next start -p 3999
 *   OT_PREVIEW_URL=http://localhost:3999 npx playwright test tests/visual/free-check-address-flow.spec.ts
 */
import { test, expect, type Page, type Route } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "desktop-1280", width: 1280, height: 900 },
] as const

const ARTIFACTS = "tmp/ot-freecheck-e2e"
fs.mkdirSync(path.join(ARTIFACTS, "shots"), { recursive: true })

const SYNTHETIC_ADDRESS = "1234 N Sample St, Chicago IL 60600"
const pinAt = (n: number) => `18-06-214-${String(n).padStart(3, "0")}-0000`

const CC_02 =
  "This free check compares available public Cook County records. It estimates whether the evidence appears to support closer review. It does not predict whether an appeal will succeed or reduce taxes."
const CC_05 = "Insufficient evidence"

/**
 * The response for a subject the county publishes no market value for: the
 * assessment level is unavailable, the assessed values are not. This is the
 * shape the released parent suppressed entirely.
 */
const ASSESSED_ONLY_RESULT = {
  success: true,
  disclosure: CC_02,
  sourceCaveat: null,
  outcome: {
    code: "insufficient_evidence",
    headline: CC_05,
    allowCheckout: false,
    reason: "no_comparable_level",
    showFigures: false,
    showRecordComparison: true,
  },
  subject: {
    pin: pinAt(1),
    address: "1234 N SAMPLE ST",
    city: "Chicago",
    zipCode: "60600",
    township: "Lake View",
    neighborhoodCode: "70",
    taxYear: 2026,
    assessedTotalValue: 42500,
    marketValue: null,
  },
  compCount: 3,
  comps: [
    { pin: pinAt(2), address: "1236 N SAMPLE ST", city: "Chicago", assessedValue: 36400, marketValue: null, squareFeet: 1200, yearBuilt: 1925, propertyClass: "2-03" },
    { pin: pinAt(3), address: "1238 N SAMPLE ST", city: "Chicago", assessedValue: 34800, marketValue: null, squareFeet: 1180, yearBuilt: 1923, propertyClass: "2-03" },
    { pin: pinAt(4), address: "1240 N SAMPLE ST", city: "Chicago", assessedValue: 34100, marketValue: null, squareFeet: 1210, yearBuilt: 1924, propertyClass: "2-03" },
  ],
  avgComparableAssessedValue: 35100,
  equityRatio: null,
  targetEquityRatio: 10,
  avgCompEquityRatio: null,
  assessmentGap: 7400,
  potentialOverpaymentPerYear: null,
  potentialOverpayment3Year: null,
  appealArgumentText: null,
  appealWindowStatus: null,
  propertyCharacteristics: null,
  compSelection: {
    basis: "cohort_recency",
    distanceRanked: false,
    label: "Selected from available Cook County records for similar properties in the same assessment cohort.",
  },
  source: "Cook County Open Data",
}

const AMBIGUOUS_RESPONSE = {
  error: "More than one Cook County property matches that address.",
  code: "ADDRESS_AMBIGUOUS",
  candidateCount: 3,
  candidatesShown: 3,
  assessorAddressSearchUrl: "https://www.cookcountyassessoril.gov/address-search",
  disclosure: CC_02,
  candidates: [
    { pin: pinAt(1), address: "1234 N SAMPLE ST", city: "Chicago", zipCode: "60600", unit: "1A" },
    { pin: pinAt(2), address: "1234 N SAMPLE ST", city: "Chicago", zipCode: "60600", unit: "1B" },
    { pin: pinAt(3), address: "1234 N SAMPLE ST", city: "Chicago", zipCode: "60600", unit: null },
  ],
}

const OUTAGE_RESPONSE = {
  error:
    "We could not reach the Cook County records service just now. Please try again in a few minutes — this is on our side, not your address.",
  code: "ADDRESS_LOOKUP_UNAVAILABLE",
  retryable: true,
}

/** Answer `/api/free-check` from a queue of [status, body] pairs. */
async function stubFreeCheck(page: Page, replies: Array<[number, unknown]>) {
  const queue = [...replies]
  await page.route("**/api/free-check", async (route: Route) => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    await route.fulfill({
      status: next[0],
      contentType: "application/json",
      body: JSON.stringify(next[1]),
    })
  })
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(ARTIFACTS, "shots", `${name}.png`), fullPage: true })
}

const pageErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on("pageerror", (err) => errors.push(String(err)))
})

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
})

for (const viewport of VIEWPORTS) {
  test.describe(`/check — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test("a unique address match renders the assessed-value comparison with no market value", async ({ page }) => {
      await stubFreeCheck(page, [[200, ASSESSED_ONLY_RESULT]])
      await page.goto("/check", { waitUntil: "domcontentloaded" })

      await page.getByRole("button", { name: "Look up by address" }).click()
      await page.getByLabel("Street address").fill(SYNTHETIC_ADDRESS)
      await page.getByRole("button", { name: /check my assessment/i }).click()

      // The verdict is unchanged — CC-05, no offer — and the public record is
      // rendered beneath it rather than suppressed along with the ratio.
      await expect(page.getByText(CC_05)).toBeVisible()
      await expect(page.getByText("$42,500").first()).toBeVisible()
      await expect(page.getByText("$35,100").first()).toBeVisible()
      await expect(page.getByText(/Avg of 3 comparables on record/)).toBeVisible()
      await expect(page.getByText(/Comparable properties \(3\)/)).toBeVisible()

      const body = (await page.locator("body").innerText()).toLowerCase()
      expect(body).not.toContain("nearby")
      expect(body).not.toContain("nearest")
      expect(body).not.toContain("estimated savings")
      expect(body).not.toContain("10.0% (target)")
      await shot(page, `check-assessed-only-${viewport.name}`)
    })

    test("an ambiguous address offers the parcels instead of picking one", async ({ page }) => {
      await stubFreeCheck(page, [[409, AMBIGUOUS_RESPONSE], [200, ASSESSED_ONLY_RESULT]])
      await page.goto("/check", { waitUntil: "domcontentloaded" })

      await page.getByRole("button", { name: "Look up by address" }).click()
      await page.getByLabel("Street address").fill(SYNTHETIC_ADDRESS)
      await page.getByRole("button", { name: /check my assessment/i }).click()

      await expect(page.getByText(/More than one Cook County property matches/)).toBeVisible()
      const options = page.locator("button", { hasText: "1234 N SAMPLE ST" })
      await expect(options).toHaveCount(3)
      await expect(page.getByText(/Unit 1A/)).toBeVisible()
      // No result is rendered until the reader chooses.
      await expect(page.getByText("$35,100")).toHaveCount(0)
      await shot(page, `check-ambiguous-${viewport.name}`)

      await options.first().click()
      await expect(page.getByText("$35,100").first()).toBeVisible()
      await expect(page.getByText(/More than one Cook County property matches/)).toHaveCount(0)
    })

    test("a provider outage does not blame the address or send the reader for a PIN", async ({ page }) => {
      await stubFreeCheck(page, [[503, OUTAGE_RESPONSE]])
      await page.goto("/check", { waitUntil: "domcontentloaded" })

      await page.getByRole("button", { name: "Look up by address" }).click()
      await page.getByLabel("Street address").fill(SYNTHETIC_ADDRESS)
      await page.getByRole("button", { name: /check my assessment/i }).click()

      const notice = page.getByRole("status")
      await expect(notice).toContainText(/on our side, not your address/i)
      await expect(notice).not.toContainText(/Try your 14-digit PIN/i)
      await shot(page, `check-outage-${viewport.name}`)
    })

    test("PIN entry remains available as the fallback", async ({ page }) => {
      await stubFreeCheck(page, [[200, ASSESSED_ONLY_RESULT]])
      await page.goto("/check", { waitUntil: "domcontentloaded" })

      await page.getByRole("button", { name: "I have my PIN" }).click()
      const pinField = page.getByLabel(/Cook County PIN/)
      await pinField.fill("18062140010000")
      await expect(pinField).toHaveValue(pinAt(1))
      await page.getByRole("button", { name: /check my assessment/i }).click()

      await expect(page.getByText(CC_05)).toBeVisible()
      await expect(page.getByText("$42,500").first()).toBeVisible()
      await shot(page, `check-pin-fallback-${viewport.name}`)
    })
  })

  test.describe(`homepage hero — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test("promises no overpayment figure and claims no nearby comps", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" })
      const body = await page.locator("body").innerText()
      expect(body).not.toMatch(/Estimated annual \+ 3-year overpayment/i)
      expect(body).not.toMatch(/Estimated annual overpayment/i)
      expect(body).not.toMatch(/\bnearby comps?\b/i)
      expect(body).not.toMatch(/\bnearest\b/i)
      await shot(page, `home-${viewport.name}`)
    })

    test("offers the parcel choice in the hero rather than resolving it", async ({ page }) => {
      await stubFreeCheck(page, [[409, AMBIGUOUS_RESPONSE], [200, ASSESSED_ONLY_RESULT]])
      await page.goto("/", { waitUntil: "domcontentloaded" })

      const heroInput = page.getByPlaceholder("123 S Sample Ave, La Grange IL").last()
      await heroInput.fill(SYNTHETIC_ADDRESS)
      await page.getByRole("button", { name: /check my assessment/i }).last().click()

      await expect(page.getByText(/More than one Cook County property matches that address/)).toBeVisible()
      await shot(page, `home-ambiguous-${viewport.name}`)

      await page.locator("button.ot-check-candidate").first().click()
      // Scoped to the result panel: the static sample card on the same page
      // carries the same label, and a page-wide match would pass without the
      // result ever rendering.
      const resultPanel = page.locator(".ot-check-result")
      await expect(resultPanel.getByText("$35,100")).toBeVisible()
      await expect(resultPanel.getByText(/Avg of 3 comparables on record/)).toBeVisible()
      await expect(resultPanel.getByText(/Assessment level/)).toHaveCount(0)
    })
  })
}
