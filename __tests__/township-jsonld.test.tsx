/**
 * @jest-environment node
 *
 * Structured-data guards for canonical /township/[slug] pages.
 * Sentry/parser-safe rule: each <script type="application/ld+json">
 * must contain one JSON-LD object, not an array payload.
 */
import { renderToStaticMarkup } from "react-dom/server";
import TownshipRoutePage from "../app/township/[slug]/page";

describe("/township/[slug] structured data", () => {
  it("emits separate object JSON-LD scripts for breadcrumb and FAQ", async () => {
    const element = await TownshipRoutePage({
      params: Promise.resolve({ slug: "berwyn" }),
    });
    const html = renderToStaticMarkup(element);
    const scripts = [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ].map((match) => match[1]);

    expect(scripts).toHaveLength(2);

    const payloads = scripts.map((script) => JSON.parse(script));
    expect(payloads.map((payload) => payload["@type"])).toEqual([
      "BreadcrumbList",
      "FAQPage",
    ]);
    for (const payload of payloads) {
      expect(Array.isArray(payload)).toBe(false);
      expect(payload["@context"]).toBe("https://schema.org");
    }
  });
});
