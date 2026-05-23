import type { Metadata } from "next";
import HomePage from "@/components/ot-design/HomePage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "./ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com";

export const metadata: Metadata = {
  title:
    "OverTaxed IL — Cook County property tax appeals, from $69",
  description:
    "Free check tells you if your Cook County assessment is out of line with comparable properties. DIY packet ($69) or done-for-you filing ($97). Not a law firm.",
  alternates: { canonical: siteUrl + "/" },
  openGraph: {
    type: "website",
    url: siteUrl + "/",
    title: "OverTaxed IL — Cook County property tax appeals",
    description:
      "Free check, $69 DIY packet, $97 done-for-you filing. Not a law firm.",
    siteName: "OverTaxed IL",
    // og:image auto-wired by app/opengraph-image.tsx
  },
  twitter: {
    card: "summary_large_image",
    title: "OverTaxed IL — Cook County property tax appeals",
    description: "Free check, $69 DIY packet, $97 done-for-you filing.",
    // twitter:image auto-wired by app/opengraph-image.tsx
  },
  robots: { index: true, follow: true },
};

export default function Page() {
  return (
    <div className="ot-root">
      <SiteHeader active="home" />
      <HomePage />
      <SiteFooter />
    </div>
  );
}
