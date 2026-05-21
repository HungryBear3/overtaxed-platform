import type { Metadata } from "next";
import CheckoutPage from "@/components/ot-design/CheckoutPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "../ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com";

export const metadata: Metadata = {
  title: "Checkout — OverTaxed IL",
  description:
    "Start your Cook County property tax appeal. DIY Appeal Packet at $69, Done-For-You at $97, or contingency ($0 upfront, 22% of first-year savings only if we win).",
  alternates: { canonical: siteUrl + "/checkout" },
  openGraph: {
    type: "website",
    url: siteUrl + "/checkout",
    title: "Start your Cook County property tax appeal",
    description:
      "DIY Packet $69, Done-For-You $97, or contingency. Procedural refund policy on township procedural denial.",
    siteName: "OverTaxed IL",
    // Checkout inherits og:image from app/opengraph-image.tsx (home OG)
  },
  twitter: {
    card: "summary_large_image",
    title: "Start your Cook County property tax appeal",
    description:
      "DIY $69, DFY $97, or contingency. Money-back on procedural denial.",
  },
  robots: { index: true, follow: true },
};

export default function Page() {
  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <CheckoutPage />
      <SiteFooter />
    </div>
  );
}
