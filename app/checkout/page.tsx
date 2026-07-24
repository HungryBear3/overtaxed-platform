import type { Metadata } from "next";
import CheckoutPage from "@/components/ot-design/CheckoutPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "../ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com";

export const metadata: Metadata = {
  title: "Checkout — OverTaxed IL",
  description:
    "Start with DIY Appeal Analysis at $69, Done-For-You at $97, or contingency. Eligibility is confirmed before payment.",
  alternates: { canonical: siteUrl + "/checkout" },
  openGraph: {
    type: "website",
    url: siteUrl + "/checkout",
    title: "Start your Cook County property tax appeal",
    description:
      "DIY Appeal Analysis $69, Done-For-You at $97, or contingency. Eligibility is confirmed before payment.",
    siteName: "OverTaxed IL",
    // Checkout inherits og:image from app/opengraph-image.tsx (home OG)
  },
  twitter: {
    card: "summary_large_image",
    title: "Start your Cook County property tax appeal",
    description:
      "DIY Appeal Analysis $69, Done-For-You at $97, or contingency. Eligibility is confirmed before payment.",
  },
  robots: { index: true, follow: true },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  const initialPlan = plan === "done-for-you" || plan === "dfy" ? "dfy" : plan === "contingency" ? "contingency" : "diy";
  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <CheckoutPage initialPlan={initialPlan} />
      <SiteFooter />
    </div>
  );
}
