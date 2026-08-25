/**
 * The served bytes of a prerendered route must contain the route.
 *
 * `app/layout.tsx` wraps every route in `AnalyticsProviderWithSuspense`. The
 * provider inside it calls `useSearchParams()`, which cannot be prerendered:
 * React suspends, and Next hands the *entire enclosing Suspense boundary* to
 * the client, leaving `<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING">`
 * in the HTML where that boundary's content should be.
 *
 * `{children}` was inside that boundary, so the boundary was the whole page.
 * At `a1f5f78` the built HTML for `/`, `/pricing` and `/terms` had a readable
 * body of one character and no `<h1>` at all; every one of them only became a
 * page after hydration.
 *
 * That is invisible to the existing suites by construction.
 * `governed-claims.spec.ts` reads the served response for *prohibited* strings
 * — an empty body passes every one of them — and reads the hydrated DOM for
 * the rest, which is exactly the layer the bailout does not affect. So the
 * regression this file exists for is one both other layers report GREEN on.
 *
 * The assertion is deliberately not "the served HTML equals the DOM": streamed
 * and client-only regions legitimately differ. It is that the route's own
 * heading and body copy are in the bytes, and that they match what the reader
 * ends up seeing.
 *
 * Runs against a local production server (`next build && next start`) or a
 * deployed preview via `OT_PREVIEW_URL`, like the other specs in this
 * directory.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/** Prerendered marketing routes — the ones a crawler and a link preview fetch
 *  without running scripts. `/checkout` is dynamic and is covered for claims by
 *  `governed-claims.spec.ts`; it is included here for its served heading only. */
const PRERENDERED = ["/", "/pricing", "/terms"] as const;

const BAILOUT_MARKER = /BAILOUT_TO_CLI(?:ENT_SIDE_RENDERING)?/g;

/** Text as a reader sees it. Mirrors `readable()` in `governed-claims.spec.ts`. */
function readable(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The `<body>` only. A populated `<head>` must not be able to satisfy a body
 *  assertion — that is precisely how the bailout went unnoticed. */
function servedBody(html: string): string {
  const opened = html.split(/<body[^>]*>/i)[1] ?? "";
  return readable(opened.split(/<\/body>/i)[0] ?? opened);
}

function servedH1(html: string): string | null {
  const body = html.split(/<body[^>]*>/i)[1] ?? html;
  const match = body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? readable(match[1]) : null;
}

async function servedHtml(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(path);
  expect(response.status(), `${path} served status`).toBeLessThan(400);
  return response.text();
}

async function hydratedH1(page: Page, path: string): Promise<string> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const heading = page.getByRole("heading", { level: 1 }).first();
  await expect(heading).toBeVisible();
  return (await heading.innerText()).replace(/\s+/g, " ").trim();
}

test.describe("prerendered routes serve their own body", () => {
  for (const route of PRERENDERED) {
    test(`${route} — served HTML carries the route's heading and copy`, async ({ request }) => {
      const html = await servedHtml(request, route);

      expect(servedH1(html), `${route} served HTML declares an <h1>`).toBeTruthy();
      expect(
        servedBody(html).length,
        `${route} served <body> is substantive, not a client-render shell`,
      ).toBeGreaterThan(500);
    });

    test(`${route} — no client-render bailout stands in for the page`, async ({ request }) => {
      const html = await servedHtml(request, route);
      const markers = (html.match(BAILOUT_MARKER) ?? []).length;

      // A bailed boundary serves as `<!--$!--><template data-dgst="..."></template><!--/$-->`:
      // its children are simply absent from the bytes. So the question is never
      // "is a marker present" — `ReferralCapture` legitimately produces one in a
      // live-marketing build — but "did a marker take the route with it".
      // Answered by asking whether the heading survives once every bailed
      // region is deleted from the markup.
      const withoutBailedRegions = html.replace(/<!--\$!-->[\s\S]*?<!--\/\$-->/g, " ");

      expect(
        servedH1(withoutBailedRegions),
        `${route} keeps its <h1> outside every client-render bailout ` +
          `(${markers} bailout ${markers === 1 ? "boundary" : "boundaries"} served)`,
      ).toBeTruthy();
      expect(
        servedBody(withoutBailedRegions).length,
        `${route} keeps a substantive body outside every client-render bailout`,
      ).toBeGreaterThan(500);
    });

    test(`${route} — served heading is the heading the reader gets`, async ({ page, request }) => {
      const served = servedH1(await servedHtml(request, route));
      const hydrated = await hydratedH1(page, route);

      expect(served, `${route} served <h1> matches hydrated <h1>`).toBe(hydrated);
    });

    test(`${route} — hydrated DOM remains substantive`, async ({ page }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const text = (await page.innerText("body")).replace(/\s+/g, " ").trim();
      expect(text.length, `${route} hydrated body is substantive`).toBeGreaterThan(500);
    });
  }
});
