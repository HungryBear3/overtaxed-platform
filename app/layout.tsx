import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AnalyticsProviderWithSuspense } from "@/components/analytics/analytics-provider";

export const metadata: Metadata = {
  title: "OverTaxed - Automated Property Tax Appeals",
  description: "Fully automated property tax appeal service for Illinois homeowners",
};

const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const googleAdsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const hasGA = !!(gaId || googleAdsId);
const primaryId = gaId || googleAdsId;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {hasGA && primaryId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${primaryId}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                ${gaId ? `gtag('config', '${gaId}', { send_page_view: true });` : ""}
                ${googleAdsId ? `gtag('config', '${googleAdsId}');` : ""}
              `}
            </Script>
          </>
        )}
        <AnalyticsProviderWithSuspense>{children}</AnalyticsProviderWithSuspense>
      </body>
    </html>
  );
}
