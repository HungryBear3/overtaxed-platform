import type { Metadata } from "next";
import { NEUTRAL_REPORT_LIMITS, NEUTRAL_REPORT_NAME, NEUTRAL_REPORT_PRICE, neutralReportCopyEnabled } from "@/lib/copy/neutral-report";

/**
 * `/pricing` is a `"use client"` page, so it cannot export `metadata` itself.
 * This layout is its server metadata boundary, and it has to carry the whole
 * set rather than the canonical alone: anything it leaves unset is inherited
 * from `app/layout.tsx`, and what was inherited was the *home page's* card —
 * og:title "OverTaxed IL - Cook County Property Tax Appeals", the home
 * description, and og:url pointing at the apex. A shared link to the pricing
 * page previewed as the home page, and the OG URL contradicted the canonical
 * declared three lines above it.
 *
 * The canonical and og:url are written as literals, not built from
 * `NEXT_PUBLIC_APP_URL`: `__tests__/public-seo-metadata.test.ts` asserts the
 * exact self-canonical string for this route, and a canonical that varies
 * with an env var is a canonical that can be wrong in one environment.
 *
 * BL-F3 requires CC-10 wherever $69 appears. A meta description is a truncated
 * surface and cannot reliably carry the full sentence, so the price is stated
 * with the preparation-service qualifier inline — the same treatment
 * `app/page.tsx` uses — and CC-10 itself is rendered twice in the page body.
 */
const PRICING_DESCRIPTION =
  "The $69 DIY Appeal Packet is the only paid offer. It is a preparation service: we prepare it, and you review it, sign it, and file it with the county yourself. OverTaxed IL is not a law firm and does not guarantee a reduction.";

const legacyMetadata: Metadata = {
  title: "Cook County Property Tax Appeal Pricing",
  description: PRICING_DESCRIPTION,
  alternates: { canonical: "https://www.overtaxed-il.com/pricing" },
  openGraph: {
    type: "website",
    url: "https://www.overtaxed-il.com/pricing",
    title: "Cook County property tax appeal pricing",
    description: PRICING_DESCRIPTION,
    siteName: "OverTaxed IL",
    // og:image inherited from app/opengraph-image.tsx (home OG)
  },
  twitter: {
    card: "summary_large_image",
    title: "Cook County property tax appeal pricing",
    description: PRICING_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export function generateMetadata(): Metadata {
  if (!neutralReportCopyEnabled()) return legacyMetadata
  const description = `${NEUTRAL_REPORT_NAME} for ${NEUTRAL_REPORT_PRICE}. ${NEUTRAL_REPORT_LIMITS}`
  return {
    ...legacyMetadata,
    title: `${NEUTRAL_REPORT_NAME} Pricing`,
    description,
    openGraph: { ...legacyMetadata.openGraph, title: `${NEUTRAL_REPORT_NAME} Pricing`, description },
    twitter: { ...legacyMetadata.twitter, title: `${NEUTRAL_REPORT_NAME} Pricing`, description },
  }
}

export default function PricingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
