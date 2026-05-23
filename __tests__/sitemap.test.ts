/**
 * @jest-environment node
 *
 * Sitemap guards. Locks the township SEO fixes:
 *   - township URLs use the canonical singular route (/township/[slug]),
 *     never the redirecting plural form (/townships/[slug]).
 *   - township slugs come from the canonical data source in lib/townships.ts,
 *     so the count tracks reality (the previous hardcoded list shipped 26
 *     of 38 slugs and a bogus "chicago" entry).
 *   - no slug appears in the sitemap that lacks a township record.
 */

import sitemap from "../app/sitemap";
import { getTownshipSlugs, TOWNSHIPS_BY_SLUG } from "../lib/townships";

describe("app/sitemap.ts — township URLs", () => {
  const entries = sitemap();

  const townshipUrlRe = /\/township\/([a-z0-9-]+)$/;
  const pluralTownshipDetailRe = /\/townships\/[a-z0-9-]+$/;

  const townshipDetailEntries = entries.filter((e) =>
    townshipUrlRe.test(e.url),
  );
  const sitemapSlugs = townshipDetailEntries
    .map((e) => e.url.match(townshipUrlRe)?.[1])
    .filter((s): s is string => Boolean(s));

  test("emits township detail URLs under the canonical singular route", () => {
    expect(townshipDetailEntries.length).toBeGreaterThan(0);
  });

  test("never emits the legacy plural detail route /townships/[slug]", () => {
    const offenders = entries
      .map((e) => e.url)
      .filter((url) => pluralTownshipDetailRe.test(url));
    expect(offenders).toEqual([]);
  });

  test("township slug set matches the canonical lib/townships.ts source", () => {
    const canonical = [...getTownshipSlugs()].sort();
    const fromSitemap = [...sitemapSlugs].sort();
    expect(fromSitemap).toEqual(canonical);
  });

  test("every sitemap township slug resolves to a real township record", () => {
    for (const slug of sitemapSlugs) {
      expect(TOWNSHIPS_BY_SLUG[slug]).toBeDefined();
    }
  });

  test("bogus 'chicago' slug is not advertised (no /township/chicago page)", () => {
    expect(sitemapSlugs).not.toContain("chicago");
  });
});
