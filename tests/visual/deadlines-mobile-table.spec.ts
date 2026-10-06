/**
 * /deadlines township table must fit its card at phone widths.
 *
 * Production at 390px: `.ot-tbl` began at x21 and ended at x411 inside a
 * `.ot-tbl-wrap` with `overflow: hidden`, so the Days and details-arrow cells
 * were laid out but clipped. The preview never showed it because every row
 * was "Pending date" / "—"; the overflow needs the mixed statuses Production
 * had once the live snapshot loaded ("Not yet open" pills, "deadline passed"
 * days) next to long township names.
 *
 * The rows here are produced by the real `DeadlinesPage` from a snapshot prop
 * (the same hypothetical-fixture shape `__tests__/deadlines` uses), evaluated
 * by the real calendar code at a pinned clock, and styled by the real
 * `globals.css` + `ot-design.css` compiled through the project's Tailwind
 * PostCSS plugin. No API response is mocked and no server is needed.
 */
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const ORIGIN = "http://ot-deadlines-table.test";
const NOW = "2026-06-02T17:00:00Z";
const MOBILE = [320, 360, 390, 414] as const;
const DESKTOP = 1280;
const STATUSES = ["open", "upcoming", "closed", "pending"] as const;

const requireFromRoot = createRequire(path.join(ROOT, "package.json"));
// Toolchain packages the app already builds with; resolved through their
// direct dependents so the spec adds no dependency of its own.
const esbuild = createRequire(requireFromRoot.resolve("tsx"))("esbuild") as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
};
const tailwindPostcss = requireFromRoot("@tailwindcss/postcss");
const postcss = createRequire(requireFromRoot.resolve("@tailwindcss/postcss"))("postcss");

/** Hypothetical windows chosen to yield every rendered status, with the
 *  longest status labels on the longest township names. Not a real calendar. */
const ENTRY = `
import { createRoot } from "react-dom/client";
import DeadlinesPage from "@/components/ot-design/DeadlinesPage";
const URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";
const open = { noticeDate: "2026-05-20", openDate: "2026-05-25", lastFileDate: "2026-06-08" };
const upcoming = { noticeDate: "2026-06-10", openDate: "2026-06-15", lastFileDate: "2026-06-29" };
const closed = { noticeDate: "2026-04-25", openDate: "2026-05-01", lastFileDate: "2026-05-15" };
const windows = {
  "north-chicago": ["North Chicago", upcoming], "norwood-park": ["Norwood Park", upcoming],
  "river-forest": ["River Forest", upcoming], "northfield": ["Northfield", upcoming],
  "south-chicago": ["South Chicago", closed], "schaumburg": ["Schaumburg", closed],
  "west-chicago": ["West Chicago", open], "rogers-park": ["Rogers Park", open],
};
const townships = {};
for (const [slug, [townshipName, assessor]] of Object.entries(windows)) townships[slug] = { townshipName, stages: { assessor } };
const snapshot = { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
  authority: "cook_county_assessor", sourceUrl: URL, finalUrl: URL, httpStatus: 200,
  retrievedAt: "2026-06-02T16:55:00Z", sourceUpdatedAt: "2026-05-20T00:00:00Z",
  contentSha256: "c".repeat(64), parseStatus: "ok", parserVersion: "test-fixture",
} }, townships };
createRoot(document.getElementById("root")).render(<DeadlinesPage snapshot={snapshot} />);
`;

let bundle = "";
let css = "";

test.beforeAll(async () => {
  const built = await esbuild.build({
    stdin: { contents: ENTRY, loader: "tsx", resolveDir: ROOT, sourcefile: "deadlines-table-entry.tsx" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "var process = { env: {} };" },
    logLevel: "silent",
  });
  bundle = built.outputFiles[0].text;
  const source = ["app/globals.css", "app/ot-design.css"]
    .map((file) => readFileSync(path.join(ROOT, file), "utf8"))
    .join("\n");
  css = (await postcss([tailwindPostcss({ base: ROOT })]).process(source, { from: path.join(ROOT, "app/globals.css") })).css;
});

async function mount(page: Page, width: number) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith("/app.js")) return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.endsWith("/app.css")) return route.fulfill({ contentType: "text/css", body: css });
    if (url === `${ORIGIN}/`) {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div class="ot-root" id="root"></div><script src="/app.js"></script></body></html>`,
      });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  // External imagery on the map is irrelevant to the table and must not hit the network.
  await page.route(/^https?:\/\/(?!ot-deadlines-table\.test)/, (route) => route.fulfill({ status: 204, body: "" }));
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${ORIGIN}/`);
  for (const status of STATUSES) {
    await expect(page.locator(`.ot-tbl-row-${status}`).first()).toBeAttached();
  }
  const table = page.locator(".ot-tbl-wrap");
  await table.scrollIntoViewIfNeeded();
  return table;
}

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

/** Geometry of every row, read in one pass. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    // A wrapped link is several line boxes; the middle of its bounding box can
    // be the gap between words. Every line box must reach the link itself.
    const hit = (el: Element) =>
      [...el.getClientRects()].every((r) => {
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!at && (at === el || el.contains(at));
      });
    const wrap = document.querySelector(".ot-tbl-wrap")!;
    const table = document.querySelector(".ot-tbl")!;
    const inner = wrap.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(wrap).borderLeftWidth);
    return {
      viewport: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      wrapContent: { left: inner.left + border, right: inner.right - border },
      wrapClientWidth: wrap.clientWidth,
      tableScrollWidth: table.scrollWidth,
      table: box(table),
      headers: [...table.querySelectorAll("thead th")].map((th) => getComputedStyle(th).display),
      rows: [...table.querySelectorAll("tbody tr.ot-tbl-row")].map((tr) => {
        // Hit-testing only sees the viewport; bring each row on screen first.
        tr.scrollIntoView({ block: "center" });
        const cells = [...tr.querySelectorAll("td")];
        const pill = tr.querySelector(".ot-status-pill")!;
        const name = tr.querySelector(".ot-tbl-name a")!;
        const arrow = tr.querySelector(".ot-tbl-arrow a")!;
        return {
          status: tr.className.replace(/.*ot-tbl-row-/, ""),
          name: name.textContent,
          pill: pill.textContent,
          days: cells[3].textContent,
          display: cells.map((td) => getComputedStyle(td).display),
          cells: cells.map(box),
          pillBox: box(pill),
          pillClipped: pill.scrollWidth > pill.clientWidth + 0.5,
          pillLines: (() => {
            const range = document.createRange();
            range.selectNodeContents(pill.lastChild!); // the label text, not the dot
            return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
          })(),
          nameBox: box(name),
          arrowBox: box(arrow),
          nameHit: hit(name),
          arrowHit: hit(arrow),
        };
      }),
    };
  });
}

function assertFits(m: Awaited<ReturnType<typeof measure>>, width: number) {
  const tol = 0.5;
  expect(m.pageScrollWidth, `${width}px: page must not scroll sideways`).toBeLessThanOrEqual(m.viewport);
  expect(m.table.right, `${width}px: .ot-tbl ends at ${m.table.right}, card content ends at ${m.wrapContent.right}`)
    .toBeLessThanOrEqual(m.wrapContent.right + tol);
  expect(m.tableScrollWidth, `${width}px: table wider than its card`).toBeLessThanOrEqual(m.wrapClientWidth + tol);
  expect(new Set(m.rows.map((r) => r.status))).toEqual(new Set(STATUSES));
  for (const row of m.rows) {
    const label = `${width}px ${row.name} (${row.status})`;
    for (const [i, cell] of row.cells.entries()) {
      if (row.display[i] === "none") continue;
      expect(cell.right, `${label}: cell ${i + 1} clipped`).toBeLessThanOrEqual(m.wrapContent.right + tol);
      expect(cell.left, `${label}: cell ${i + 1} clipped`).toBeGreaterThanOrEqual(m.wrapContent.left - tol);
    }
    expect(row.pillClipped, `${label}: status pill text clipped`).toBe(false);
    expect(row.pillBox.right, `${label}: status pill escapes its cell`).toBeLessThanOrEqual(row.cells[1].right + tol);
    expect(row.nameHit, `${label}: township link not tappable`).toBe(true);
    expect(row.arrowHit, `${label}: details arrow not tappable`).toBe(true);
    if (width < DESKTOP) {
      // Touch target (WCAG 2.5.8 minimum) on phone widths.
      expect(row.arrowBox.width, `${label}: details arrow target too narrow`).toBeGreaterThanOrEqual(24);
      expect(row.arrowBox.height, `${label}: details arrow target too short`).toBeGreaterThanOrEqual(24);
    }
    expect(row.arrowBox.right, `${label}: details arrow clipped`).toBeLessThanOrEqual(m.wrapContent.right + tol);
  }
}

for (const width of MOBILE) {
  test(`/deadlines table fits the card at ${width}px with mixed statuses`, async ({ page }, testInfo) => {
    const table = await mount(page, width);
    const m = await measure(page);
    await table.screenshot({ path: testInfo.outputPath(`deadlines-table-${width}.png`) });
    await testInfo.attach(`measure-${width}.json`, { body: JSON.stringify(m, null, 2), contentType: "application/json" });

    // Only the official-deadline column is dropped on phones.
    expect(m.headers).toEqual(["table-cell", "table-cell", "none", "table-cell", "table-cell"]);
    for (const row of m.rows) expect(row.display).toEqual(["table-cell", "table-cell", "none", "table-cell", "table-cell"]);
    // The longest real labels are actually on screen, not just in the fixture.
    expect(m.rows.some((r) => r.pill === "Not yet open" && r.name === "North Chicago")).toBe(true);
    expect(m.rows.some((r) => r.days === "deadline passed" && r.name === "South Chicago")).toBe(true);
    // Pills only break onto two lines where nothing else fits.
    if (width >= 360) for (const row of m.rows) expect(row.pillLines, `${width}px ${row.name}: "${row.pill}" wrapped`).toBe(1);
    assertFits(m, width);
  });
}

test(`/deadlines table keeps all five columns at ${DESKTOP}px`, async ({ page }, testInfo) => {
  const table = await mount(page, DESKTOP);
  const m = await measure(page);
  await table.screenshot({ path: testInfo.outputPath(`deadlines-table-${DESKTOP}.png`) });
  await testInfo.attach(`measure-${DESKTOP}.json`, { body: JSON.stringify(m, null, 2), contentType: "application/json" });

  expect(m.headers).toEqual(Array(5).fill("table-cell"));
  for (const row of m.rows) expect(row.display).toEqual(Array(5).fill("table-cell"));
  await expect(page.locator(".ot-tbl thead th").nth(2)).toHaveText("Official 2026 deadline");
  await expect(page.locator(".ot-tbl-row-closed .ot-tbl-window").first()).toHaveText(/^Last file: /);
  assertFits(m, DESKTOP);
});
