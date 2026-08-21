import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Suspense } from "react";
import { ReferralCapture } from "@/components/ReferralCapture";
import { AnalyticsProviderWithSuspense } from "@/components/analytics";
import { GoogleAnalytics } from "@/components/analytics";
import { UtmFirstTouchCapture } from "@/components/analytics/utm-first-touch";
import { isProductionMarketingRuntime } from "@/lib/marketing/preview-gate";
import "./globals.css";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com";

// These are the shared metadata *defaults* every page inherits when it does
// not set its own, so a banned claim here is a banned claim on all 52 paths at
// once. Three defects were carried by all three descriptions:
//
//   - "save an average of $1,200+/year" is BL-B3 (a dollar savings figure) and
//     BL-B6 (it equates an assessment change with a bill change one-to-one).
//   - "South district townships are in the 2026 reassessment cycle" is a
//     hard-coded window status with no source and no retrieval timestamp
//     (BL-D2/BL-D4), asserted site-wide and never refreshed.
//   - "in minutes" describes the county appeal, not our packet, as fast.
//
// The replacement describes what the free check does, which is verifiable
// without a claim about the county's decision.
const DEFAULT_DESCRIPTION =
  "Check whether your Cook County assessment is out of line with comparable properties, and see your township's current official appeal window. OverTaxed IL is not a law firm and does not guarantee a reduction.";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "OverTaxed IL - Cook County Property Tax Appeals",
    template: "%s | OverTaxed IL",
  },
  description: DEFAULT_DESCRIPTION,
  // "Cook County Board of Review" is dropped. It is a site-wide named mention
  // of the one stage OverTaxed IL cannot serve, and BL-F5 would require CC-11
  // to answer it on all 52 paths — a disclosure carried everywhere to support a
  // keyword no consumer reads and no engine weighs.
  keywords: ["Cook County property tax appeal", "property tax appeal Illinois", "Cook County Assessor appeal", "property tax assessment appeal"],
  authors: [{ name: "OverTaxed IL" }],
  openGraph: {
    title: "OverTaxed IL - Cook County Property Tax Appeals",
    description: DEFAULT_DESCRIPTION,
    url: baseUrl,
    siteName: "OverTaxed IL",
    type: "website",
    images: [`${baseUrl}/og-image.png`],
  },
  twitter: {
    card: "summary_large_image",
    title: "OverTaxed IL - Cook County Property Tax Appeals",
    description: DEFAULT_DESCRIPTION,
    images: [`${baseUrl}/twitter-image.png`],
  },
  alternates: {
    types: { "application/rss+xml": `${baseUrl}/rss.xml` },
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Preview/dev/test must not mount Vercel Analytics or the ?ref= referral
  // capture. Both are gated through the marketing preview gate so that
  // production builds on overtaxed-il.com keep their existing behavior.
  const liveMarketing = isProductionMarketingRuntime();
  return (
    <html lang="en">
      <body>
        {/* First-touch UTM capture (localStorage only — no cookies/network/PII),
            so campaign attribution survives from the landing page through the
            funnel. Safe in preview/dev, hence not behind the marketing gate. */}
        <Suspense fallback={null}>
          <UtmFirstTouchCapture />
        </Suspense>
        {liveMarketing && (
          <Suspense fallback={null}>
            <ReferralCapture />
          </Suspense>
        )}
        {liveMarketing && <GoogleAnalytics measurementId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />}
        <AnalyticsProviderWithSuspense>{children}</AnalyticsProviderWithSuspense>
        {liveMarketing && <Analytics />}
      </body>
    </html>
  );
}
