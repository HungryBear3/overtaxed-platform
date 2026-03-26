import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Suspense } from "react";
import { ReferralCapture } from "@/components/ReferralCapture";
import "./globals.css";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "OverTaxed IL - Cook County Property Tax Appeals",
    template: "%s | OverTaxed IL",
  },
  description: "Appeal your Cook County property taxes in minutes. South district townships are in the 2026 reassessment cycle — homeowners who appeal save an average of $1,200+/year.",
  keywords: ["Cook County property tax appeal", "property tax appeal Illinois", "2026 reassessment", "Cook County Board of Review", "lower property taxes"],
  authors: [{ name: "OverTaxed IL" }],
  openGraph: {
    title: "OverTaxed IL - Cook County Property Tax Appeals",
    description: "Appeal your Cook County property taxes in minutes. Homeowners who appeal save an average of $1,200+/year.",
    url: baseUrl,
    siteName: "OverTaxed IL",
    type: "website",
    images: [`${baseUrl}/og-image.png`],
  },
  twitter: {
    card: "summary_large_image",
    title: "OverTaxed IL - Cook County Property Tax Appeals",
    description: "Appeal your Cook County property taxes in minutes. Save an average of $1,200+/year.",
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
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <ReferralCapture />
        </Suspense>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
