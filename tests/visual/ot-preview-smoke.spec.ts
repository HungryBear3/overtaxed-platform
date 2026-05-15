/**
 * Pass 2 visual QA smoke — 4 pages × 3 viewports.
 *
 * Run against a local prod server (`pnpm build && pnpm start`) or a
 * publicly-reachable preview by setting OT_PREVIEW_URL.
 *
 * Each check maps to one item in the Pass 2 launch-blocker brief.
 */
import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 900 },
] as const;

const PAGES = ["/", "/deadlines", "/checkout", "/township/palatine"] as const;

const ARTIFACTS = "tmp/ot-visual-qa";
fs.mkdirSync(path.join(ARTIFACTS, "shots"), { recursive: true });

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(ARTIFACTS, "shots", `${name}.png`),
    fullPage: true,
  });
}

/**
 * Goto + wait for a stable heading. Replaces the previous
 * `waitUntil: "networkidle"` calls which would hang on apps with
 * long-running analytics / websockets. `domcontentloaded` + an h1
 * visibility assertion lets Playwright's auto-waiting do the work.
 */
async function gotoAndWaitForHeading(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

// Per-test collector for runtime issues. Keyed by Page so the listeners
// don't bleed across the parallel-ready future state. Tests fail HARD on
// any uncaught page error (hydration bugs, runtime JS exceptions);
// failed network requests are attached as a diagnostic only — we
// deliberately don't fail on noisy third-party 404s.
const errorsByPage = new WeakMap<Page, string[]>();
const FAILED_REQUEST_ALLOWLIST = [
  /\/favicon/i,
  /googletagmanager|google-analytics|gtag/i,
  /sentry|datadog|posthog|fullstory|vercel-insights|_vercel\/insights/i,
  /^chrome-extension:/i,
];

test.describe("Pass 2 visual smoke", () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    errorsByPage.set(page, errors);

    page.on("pageerror", (err) => {
      errors.push(`pageerror: ${err.message}`);
    });
    page.on("requestfailed", (req) => {
      const url = req.url();
      if (FAILED_REQUEST_ALLOWLIST.some((re) => re.test(url))) return;
      const failure = req.failure();
      errors.push(`requestfailed: ${url} — ${failure?.errorText ?? "unknown"}`);
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = errorsByPage.get(page) ?? [];
    if (errors.length === 0) return;

    await testInfo.attach("page-diagnostics", {
      body: errors.join("\n"),
      contentType: "text/plain",
    });

    // Uncaught JS errors fail the test (hydration bugs etc.); failed
    // requests are informational only — surfaced via the attachment.
    const hard = errors.filter((e) => e.startsWith("pageerror:"));
    if (hard.length > 0) {
      throw new Error(
        `Uncaught page errors during '${testInfo.title}':\n${hard.join("\n")}`,
      );
    }
  });

  for (const vp of VIEWPORTS) {
    for (const url of PAGES) {
      test(`${vp.name} ${url}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await gotoAndWaitForHeading(page, url);
        const slug = url === "/" ? "home" : url.replace(/^\//, "").replace(/\//g, "-");
        await shot(page, `${vp.name}__${slug}`);

        // 1. No horizontal overflow at mobile/tablet
        if (vp.width <= 768) {
          const overflow = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            inner: window.innerWidth,
          }));
          expect(
            overflow.scroll,
            `${url} @ ${vp.width}: scrollWidth ${overflow.scroll} > innerWidth ${overflow.inner}`,
          ).toBeLessThanOrEqual(overflow.inner + 1);
        }
      });
    }
  }

  test("deadlines counter cards: no duplicate label", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAndWaitForHeading(page, "/deadlines");
    const bodyText = (await page.textContent("body")) || "";
    expect(bodyText).not.toMatch(/Open now\d+Open now/i);
    expect(bodyText).not.toMatch(/Opening soon\d+Opening soon/i);
    expect(bodyText).not.toMatch(/Closed\d+Closed/i);
  });

  test("deadline filter buttons actually filter the list", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAndWaitForHeading(page, "/deadlines");

    // Each filter button renders its label + a `.ot-tbl-filter-count` chip
    // with the current count. We read that chip first so we can assert the
    // post-click row count matches exactly — proving the click reduced the
    // visible list to *only* the open-status townships, not "passes
    // whatever happens" (the previous tautological `open <= all`).
    const filter = page.locator(".ot-tbl-filter");
    await expect(filter).toBeVisible();

    const allBtn = filter.getByRole("button", { name: /^All\b/ });
    const openBtn = filter.getByRole("button", { name: /^Open now\b/ });
    const totalChip = await allBtn.locator(".ot-tbl-filter-count").innerText();
    const openChip = await openBtn.locator(".ot-tbl-filter-count").innerText();
    const total = Number(totalChip);
    const expectedOpen = Number(openChip);

    expect(total, "All-button count chip must parse as a number").toBeGreaterThan(0);
    expect(expectedOpen, "Open-button count chip must parse as a number").toBeGreaterThan(0);

    // Sanity precondition: at least one township is not currently "Open
    // now". If the live data ever flips so every township is open, this
    // filter test cannot prove anything user-visible — it would still
    // pass but the suite would silently lose its filter coverage. Skip
    // (with annotation) rather than green-wash that case.
    if (expectedOpen === total) {
      test.skip(
        true,
        `Live deadlines data shows every township as 'Open now' (${expectedOpen}/${total}); ` +
          `filter test cannot distinguish filtered vs unfiltered row counts. ` +
          `Re-enable once at least one township is in a non-open state.`,
      );
      return;
    }

    // Baseline: unfiltered row count equals the All chip.
    await expect(page.locator(".ot-tbl-row")).toHaveCount(total);

    await openBtn.click();

    // The clicked button takes the active class — proves the click was
    // handled, not just registered as a hover.
    await expect(openBtn).toHaveClass(/is-active/);
    // And the visible row set converges to exactly the chip count — proves
    // the filter actually filtered, not just toggled UI state.
    // `toHaveCount` auto-retries, replacing the previous waitForTimeout(150).
    await expect(page.locator(".ot-tbl-row")).toHaveCount(expectedOpen);
    expect(expectedOpen).toBeLessThan(total);
  });

  test("/checkout — readable plan cards on mobile + desktop", async ({ page }) => {
    for (const w of [375, 1280]) {
      await page.setViewportSize({ width: w, height: 900 });
      await gotoAndWaitForHeading(page, "/checkout");
      const plans = page.locator(".ot-checkout-plan");
      await expect(plans.first()).toBeVisible();
      const count = await plans.count();
      expect(count, `/checkout @ ${w} should show ≥ 2 plan cards`).toBeGreaterThanOrEqual(2);
    }
  });

  test("/township/palatine — designed sections present, not flat dump", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAndWaitForHeading(page, "/township/palatine");
    await expect(page.locator(".ot-tp-hero").first()).toBeVisible();
    await expect(page.locator(".ot-tp-hero-card").first()).toBeVisible();
    await expect(page.locator(".ot-tp-stats").first()).toBeVisible();
    await expect(page.locator(".ot-tp-neighbors").first()).toBeVisible();
    await expect(page.locator(".ot-tp-faq").first()).toBeVisible();
  });

  test("/api/check returns labeled sample data, not real-looking results", async ({ request }) => {
    // The preview /api/check route deliberately does NOT echo the
    // submitted address back — earlier behavior pretended the sample
    // data was real for whatever address you typed. Current contract
    // (mirrored by __tests__/ot-design-port.test.ts):
    //   - 200, ok: true, preview: true
    //   - result.address is the sample-data label, never the submitted text
    //   - never the legacy Kedvale literal
    const submitted = "742 W Cornelia Ave, Chicago IL 60657";
    const res = await request.post("/api/check", {
      data: { address: submitted, mode: "address" },
    });
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.preview).toBe(true);
    expect(json.result.address).toMatch(/Sample result/);
    expect(json.result.address).not.toBe(submitted);
    expect(json.result.address).not.toMatch(/Kedvale/);
  });

  test("OG images return PNG (not 404) for all three routes", async ({ request, baseURL }) => {
    const routes = [
      "/opengraph-image",
      "/deadlines/opengraph-image",
      "/township/palatine/opengraph-image",
    ];
    for (const r of routes) {
      const res = await request.get(r);
      expect(res.status(), `${r} status`).toBeLessThan(400);
      const ct = res.headers()["content-type"] || "";
      expect(ct, `${r} content-type`).toMatch(/image\/(png|jpeg|webp)/);
    }
    // Sanity: the literal /og-*.png paths mentioned in the brief are routed
    // by Next via the per-route opengraph-image.tsx — they are NOT served at
    // /og-home.png. Document that in the report; spec just confirms PNGs ship.
    expect(baseURL).toBeTruthy();
  });

  test("deadline alert text reads cleanly (no `daysDON'T MISS`)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAndWaitForHeading(page, "/");
    const body = (await page.textContent("body")) || "";
    // The brief's bug: "Appeal window closes in 21 daysDON'T MISS THIS WINDOW".
    // After fix the "·" separator + flex gap break those two phrases apart.
    expect(body).not.toMatch(/days(DON'?T|Don'?t)/i);
    expect(body).not.toMatch(/daysClos(es|ing) this week/i);
  });
});
