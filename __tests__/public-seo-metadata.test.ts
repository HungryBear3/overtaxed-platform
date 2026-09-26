/**
 * @jest-environment node
 *
 * Regression guard for Google Search Console exclusions observed 2026-07-27.
 * Source checks lock the route metadata declarations; production-build and
 * rendered-head verification prove Next.js emits them correctly.
 */

import fs from "fs";
import path from "path";
import sitemap from "../app/sitemap";
import { metadata as checkMetadata } from "../app/check/page";
import { metadata as townshipsMetadata } from "../app/townships/page";
import { metadata as faqMetadata } from "../app/faq/page";
import { metadata as contactMetadata } from "../app/contact/page";
import { metadata as aboutMetadata } from "../app/about/page";
import { generateMetadata as generateCheckoutMetadata } from "../app/checkout/page";

const SITE_URL = "https://www.overtaxed-il.com";
const SOCIAL_IMAGE = "/opengraph-image";
const STATIC_ROUTES: Array<[string, string]> = [
  ["app/check/page.tsx", "/check"],
  ["app/blog/page.tsx", "/blog"],
  ["app/townships/page.tsx", "/townships"],
  ["app/faq/page.tsx", "/faq"],
  ["app/contact/page.tsx", "/contact"],
  ["app/about/page.tsx", "/about"],
  ["app/terms/page.tsx", "/terms"],
  ["app/privacy/page.tsx", "/privacy"],
  ["app/disclaimer/page.tsx", "/disclaimer"],
];

const CANONICAL_HOST_SOURCES = [
  "app/page.tsx",
  "app/deadlines/page.tsx",
  "app/hoa/page.tsx",
  "app/hoa/hoa-client.tsx",
  "app/township/[slug]/page.tsx",
  "app/checkout/page.tsx",
  "app/rss.xml/route.ts",
];

function routeSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function expectExactCanonical(relativePath: string, canonical: string): void {
  const runtimeMetadata = new Map<string, unknown>([
    ["app/check/page.tsx", checkMetadata.alternates?.canonical],
    ["app/townships/page.tsx", townshipsMetadata.alternates?.canonical],
    ["app/faq/page.tsx", faqMetadata.alternates?.canonical],
    ["app/contact/page.tsx", contactMetadata.alternates?.canonical],
    ["app/about/page.tsx", aboutMetadata.alternates?.canonical],
  ]);
  if (runtimeMetadata.has(relativePath)) {
    expect(runtimeMetadata.get(relativePath)).toBe(canonical);
    return;
  }

  const source = routeSource(relativePath);
  const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literalCanonical = new RegExp(
    `alternates\\s*:\\s*\\{\\s*canonical\\s*:\\s*["']${escaped}["']`,
  );
  expect(source).toMatch(literalCanonical);
}

describe("public sitemap canonical metadata", () => {
  test.each(STATIC_ROUTES)("%s declares its exact self-canonical", (relativePath, route) => {
    expectExactCanonical(relativePath, `${SITE_URL}${route}`);
  });

  test("/pricing declares its exact self-canonical from a server metadata boundary", () => {
    const relativePath = "app/pricing/layout.tsx";
    expect(fs.existsSync(path.join(process.cwd(), relativePath))).toBe(true);
    if (fs.existsSync(path.join(process.cwd(), relativePath))) {
      expectExactCanonical(relativePath, `${SITE_URL}/pricing`);
    }
  });

  test("dynamic blog metadata declares a slug-specific absolute canonical", () => {
    const source = routeSource("app/blog/[slug]/page.tsx");
    expect(source).toMatch(/alternates\s*:\s*\{\s*canonical\s*:/);
    expect(source).toContain("https://www.overtaxed-il.com/blog/${post.slug}");
  });

  test("dynamic blog metadata and page await Next 16 route params", () => {
    const source = routeSource("app/blog/[slug]/page.tsx");
    expect(source).toContain("params: Promise<{ slug: string }>");
    expect(source.match(/await params/g)).toHaveLength(2);
  });

  test.each(CANONICAL_HOST_SOURCES)("%s never falls back to the non-www host", (relativePath) => {
    expect(routeSource(relativePath)).not.toMatch(/https:\/\/overtaxed-il\.com["']/);
  });

  test("does not publish request-time lastModified values for every sitemap URL", () => {
    const entriesWithLastModified = sitemap().filter(
      (entry) => entry.lastModified !== undefined,
    );
    expect(entriesWithLastModified).toEqual([]);
  });

  test("root defaults are neutral and do not reference missing social images", () => {
    const source = routeSource("app/layout.tsx");
    expect(source).toContain("Cook County Assessment Records");
    expect(source).not.toContain("/og-image.png");
    expect(source).not.toContain("/twitter-image.png");
  });

  test.each([
    ["app/check/page.tsx", "/check"],
    ["app/townships/page.tsx", "/townships"],
    ["app/contact/page.tsx", "/contact"],
    ["app/faq/page.tsx", "/faq"],
    ["app/about/page.tsx", "/about"],
  ])("%s owns route-specific social metadata", (relativePath, route) => {
    const source = routeSource(relativePath);
    expect(source).toMatch(/openGraph\s*:/);
    expect(source).toMatch(/twitter\s*:/);
    expect(source).toContain(`${SITE_URL}${route}`);
  });

  test("route-specific social metadata preserves the generated share image", () => {
    const routeMetadata = [
      checkMetadata,
      townshipsMetadata,
      contactMetadata,
      faqMetadata,
      aboutMetadata,
      generateCheckoutMetadata(),
    ];

    for (const metadata of routeMetadata) {
      expect(metadata.openGraph?.images).toEqual([
        { url: SOCIAL_IMAGE, alt: "OverTaxed IL" },
      ]);
      expect(metadata.twitter?.images).toEqual([SOCIAL_IMAGE]);
    }
  });

  test("checkout uses neutral metadata and stays out of search results", () => {
    const source = routeSource("app/checkout/page.tsx");
    expect(source).toContain("export function generateMetadata");
    expect(source).toContain("NEUTRAL_REPORT_NAME");
    expect(source).toMatch(/robots\s*:\s*\{\s*index\s*:\s*false\s*,\s*follow\s*:\s*true/);
  });
});
