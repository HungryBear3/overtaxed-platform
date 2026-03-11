import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com";

export const metadata: Metadata = {
  title: "OverTaxed IL - Automated Property Tax Appeals",
  description: "Fully automated property tax appeal service for Illinois homeowners",
  openGraph: {
    title: "OverTaxed IL - Automated Property Tax Appeals",
    description: "Fully automated property tax appeal service for Illinois homeowners",
    url: baseUrl,
    siteName: "OverTaxed IL",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OverTaxed IL - Automated Property Tax Appeals",
    description: "Fully automated property tax appeal service for Illinois homeowners",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
