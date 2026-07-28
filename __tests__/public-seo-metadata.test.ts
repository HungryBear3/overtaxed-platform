/**
 * @jest-environment node
 *
 * Regression guard for Google Search Console exclusions observed 2026-07-27.
 * Source checks lock the route metadata declarations; production-build and
 * rendered-head verification prove Next.js emits them correctly.
 */

import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import sitemap from "../app/sitemap";

const SITE_URL = "https://www.overtaxed-il.com";
const STATIC_ROUTES: Array<[string, string]> = [
  ["app/check/page.tsx", "/check"],
  ["app/blog/page.tsx", "/blog"],
  ["app/townships/page.tsx", "/townships"],
  ["app/faq/page.tsx", "/faq"],
  ["app/contact/page.tsx", "/contact"],
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
  const source = routeSource(relativePath);
  const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(source).toMatch(
    new RegExp(`alternates\\s*:\\s*\\{\\s*canonical\\s*:\\s*["']${escaped}["']`),
  );
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
});
