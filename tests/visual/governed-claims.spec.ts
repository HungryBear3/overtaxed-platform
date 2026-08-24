/**
 * Prohibited-claim regression for the governed purchase path, tested twice:
 * once against the bytes the server produced, and once against the DOM a
 * homeowner actually reads.
 *
 * Why both, and why neither alone is enough.
 *
 * The source-string suites under `__tests__` read files. They cannot see a
 * claim that reaches a page from shared chrome rather than from the route's
 * own source, and that is precisely how the last one survived: `/checkout`,
 * `CheckoutPage.tsx` and `/pricing` were all remediated for the held tiers,
 * and the badge that promised "If your township denies the filing on
 * procedural grounds, we refund your packet" was in
 * `components/ot-design/SiteChrome.tsx`, which was on nobody's list. It served
 * live for as long as the remediation was believed complete.
 *
 * A served-HTML sweep does not close that either. `/` renders its body on the
 * client: the initial HTML for the home page is a shell, and `curl` reports it
 * clean while a browser renders the same badge twice. Any check that reads
 * only the response body reports GREEN on the page most homeowners land on.
 *
 * So: layer 1 reads the response, because that is what a crawler and a link
 * preview keep showing after the page changes — it is where metadata lives and
 * metadata outlives copy. Layer 2 drives a real browser and reads
 * `document.body.innerText` after hydration, because that is the claim a buyer
 * is actually shown. A rule has to pass both.
 *
 * Run against a local production server (`pnpm build && pnpm start`) or a
 * deployed preview via `OT_PREVIEW_URL`, the same way
 * `tests/visual/ot-preview-smoke.spec.ts` runs.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/** The canonical production origin. Deliberately not `baseURL`: a preview is
 *  served from a `*.vercel.app` host but must still declare the production
 *  canonical, so comparing against `baseURL` would make the assertion vacuous
 *  in exactly the environment it is used to sign off. */
const CANONICAL_ORIGIN = "https://www.overtaxed-il.com";

/**
 * What may not appear on a governed surface, in body copy or in metadata.
 *
 * These are the claims the 2026-08-24 remediation removed. They are kept here
 * rather than added to `__tests__/lexicon/banned-claims.test.ts` on purpose:
 * that lexicon is bound byte-for-byte to a frozen controller document
 * (`04-CANONICAL-COPY-AND-BANNED-CLAIMS.md`), and promoting a row into it is a
 * controller decision, not an implementer one.
 *
 * PC-7 is written to catch a refund promised on a decision the *county* makes,
 * and deliberately not to catch the Terms of Service §7 rule, which conditions
 * refund review on an OverTaxed IL procedural error in the materials we
 * prepared. The two read similarly and mean opposite things; §7 is an owner
 * policy term and must survive this sweep unchanged.
 */
const PROHIBITED: Array<{ id: string; pattern: RegExp }> = [
  { id: "PC-1 held $97 tier", pattern: /\$\s?97\b/ },
  { id: "PC-2 done-for-you", pattern: /done[\s\-_]?for[\s\-_]?you/i },
  { id: "PC-3 contingency offer", pattern: /\bcontingency\b/i },
  { id: "PC-4 percentage fee", pattern: /\b22\s?%/ },
  { id: "PC-5 we file/handle/submit", pattern: /\bwe\s+(?:will\s+)?(?:file|handle|submit)\b/i },
  {
    id: "PC-6 outcome-contingent fee",
    pattern: /only if we win|no win[,\s]*no fee|if we don'?t (?:reduce|win)|you pay \$?0\b/i,
  },
  {
    id: "PC-7 refund on a county decision",
    pattern:
      /procedural refund|\b(?:township|county|assessor|board of review)\b[^.]{0,80}\b(?:denies|denied|rejects|rejected)\b[^.]{0,80}\brefund\b/i,
  },
];

/** The purchase path plus the page it starts from. `/` is here because that is
 *  where the client-rendered leak was, and it is the only route in the set
 *  whose body a served-HTML check cannot see. */
const GOVERNED = [
  { route: "/", canonical: [CANONICAL_ORIGIN, `${CANONICAL_ORIGIN}/`] },
  { route: "/checkout", canonical: [`${CANONICAL_ORIGIN}/checkout`] },
  { route: "/pricing", canonical: [`${CANONICAL_ORIGIN}/pricing`] },
  { route: "/terms", canonical: [`${CANONICAL_ORIGIN}/terms`] },
] as const;

/** Stale deep links into the withdrawn tiers. They are not redirected to an
 *  error — any unrecognised plan resolves to the one offered plan — so the
 *  assertion is that they land somewhere truthful, not that they 404. */
const STALE_PLAN_QUERIES = ["?plan=dfy", "?plan=done-for-you", "?plan=contingency", "?plan=T3"];

/** Text as a reader sees it: script and style dropped, tags stripped, entities
 *  folded, whitespace collapsed. Mirrors `readable()` in the lexicon suite. */
function readable(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

type Head = {
  title: string | null;
  description: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogUrl: string | null;
  raw: string;
};

/** Parse the served `<head>`. This reads the response, not the DOM, because a
 *  crawler reads the response. */
function parseHead(html: string): Head {
  const head = html.split(/<\/head>/i)[0] ?? "";
  const attr = (tag: string, name: string): string | null => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
    return m ? m[1] : null;
  };
  let title: string | null = null;
  let description: string | null = null;
  let canonical: string | null = null;
  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogUrl: string | null = null;

  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = readable(titleMatch[1]);

  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = attr(tag, "name");
    const property = attr(tag, "property");
    const content = attr(tag, "content");
    if (name === "description") description = content;
    if (property === "og:title") ogTitle = content;
    if (property === "og:description") ogDescription = content;
    if (property === "og:url") ogUrl = content;
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    if ((attr(tag, "rel") ?? "").toLowerCase() === "canonical") canonical = attr(tag, "href");
  }
  return { title, description, canonical, ogTitle, ogDescription, ogUrl, raw: readable(head) };
}

async function servedHtml(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(path);
  expect(response.status(), `${path} served status`).toBeLessThan(400);
  return response.text();
}

/** The DOM after hydration — what the homeowner reads. */
async function renderedText(page: Page, path: string): Promise<string> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  return (await page.innerText("body")).replace(/\s+/g, " ").trim();
}

function expectClean(text: string, where: string): void {
  for (const { id, pattern } of PROHIBITED) {
    const match = text.match(pattern);
    expect(
      { where, id, found: match ? text.slice(Math.max(0, match.index! - 90), match.index! + 150) : null },
      `${where} must not carry ${id}`,
    ).toEqual({ where, id, found: null });
  }
}

test.describe("governed surfaces carry no withdrawn claim", () => {
  for (const { route, canonical } of GOVERNED) {
    test(`${route} — served response is clean in body and metadata`, async ({ request }) => {
      const html = await servedHtml(request, route);
      const head = parseHead(html);

      // Metadata first: it is what a search result and a link preview keep
      // showing after the page itself is corrected.
      expectClean(head.raw, `${route} <head>`);
      // Then the whole response, which for a server-rendered route is also the
      // body. For a client-rendered route this is a shell — layer 2 covers it.
      expectClean(readable(html), `${route} served response`);
    });

    test(`${route} — metadata is route-appropriate, not inherited`, async ({ request }) => {
      const head = parseHead(await servedHtml(request, route));

      expect(head.title, `${route} declares a title`).toBeTruthy();
      expect(head.description, `${route} declares its own description`).toBeTruthy();

      // A canonical and an og:url that disagree point a crawler and a share
      // card at two different pages. Both must be this route.
      expect(canonical, `${route} canonical`).toContain(head.canonical);
      expect(canonical, `${route} og:url`).toContain(head.ogUrl);

      // Every field here fell through to the root layout before this suite
      // existed, so `/pricing` and `/terms` shared the home page's card.
      expect(head.ogTitle, `${route} declares its own og:title`).toBeTruthy();
      expect(head.ogDescription, `${route} declares its own og:description`).toBeTruthy();
      if (route !== "/") {
        expect(head.ogTitle, `${route} og:title is not the home default`).not.toBe(
          "OverTaxed IL - Cook County Property Tax Appeals",
        );
        expect(head.ogDescription, `${route} og:description is not the home default`).not.toMatch(
          /^Check whether your Cook County assessment is out of line/,
        );
      }
    });

    test(`${route} — rendered DOM is clean after hydration`, async ({ page }) => {
      const text = await renderedText(page, route);

      // Guard the guard. If this ever drops to a shell, the sweep below would
      // pass on an empty string and report GREEN for a page full of claims —
      // which is the exact failure mode that let the badge live on `/`.
      expect(text.length, `${route} rendered body is substantive`).toBeGreaterThan(500);

      expectClean(text, `${route} rendered DOM`);
    });
  }

  test("stale held-tier deep links resolve to the packet and select no held tier", async ({ page, request }) => {
    for (const query of STALE_PLAN_QUERIES) {
      const path = `/checkout${query}`;

      const html = await servedHtml(request, path);
      // The query string itself is echoed into the RSC flight payload as part
      // of the URL, which `readable()` drops with the script tags. What must
      // be clean is the copy — so assert on the readable response and on the
      // DOM, not on the raw bytes.
      expectClean(readable(html), `${path} served response`);

      const text = await renderedText(page, path);
      expect(text.length, `${path} rendered body is substantive`).toBeGreaterThan(500);
      expectClean(text, `${path} rendered DOM`);

      // Resolving to the one offered plan is the contract, not just "no held
      // tier is named": a stale link from an old email has to land on a real
      // offer.
      await expect(page.locator(".ot-checkout-plan"), `${path} offers one plan`).toHaveCount(1);
      expect(text, `${path} shows the packet price`).toContain("$69");
    }
  });

  test("the Terms keep their own procedural-error refund rule", async ({ page }) => {
    // The inverse assertion, and the reason PC-7 is written narrowly. Removing
    // the badge must not have removed the policy it contradicted: §7 conditions
    // refund review on an OverTaxed IL procedural error, and it is the only
    // place that rule is stated. A broader PC-7 would delete it to go green.
    const text = await renderedText(page, "/terms");
    expect(text).toMatch(/OverTaxed IL procedural error/i);
    expect(text).toMatch(/Refund review does not apply when the county denies an appeal on the merits/i);
  });
});
