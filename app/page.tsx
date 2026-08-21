import type { Metadata } from "next";
import HomePage from "@/components/ot-design/HomePage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "./ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com";

// "from $69" is dropped from the title along with the tiers it was counting
// from: with one price there is no range to start at, and "from" invites a
// reader to expect a cheaper entry point.
//
// BL-F3 requires CC-10 wherever $69 appears. A meta description is a truncated
// surface and cannot reliably carry the full sentence, so the price is stated
// with the preparation-service qualifier inline and CC-10 is rendered in the
// page body by HomePage.
const HOME_DESCRIPTION =
  "Free check tells you if your Cook County assessment is out of line with comparable properties. The $69 packet is a preparation service — we prepare it, you file it yourself. OverTaxed IL is not a law firm.";

export const metadata: Metadata = {
  // This title is final, not template-wrapped: `title.template` in
  // app/layout.tsx applies to child segments, and app/page.tsx shares the root
  // segment. So it must carry the brand itself, exactly once (BL-F6).
  title: "OverTaxed IL — Cook County property tax appeals",
  description: HOME_DESCRIPTION,
  alternates: { canonical: siteUrl + "/" },
  openGraph: {
    type: "website",
    url: siteUrl + "/",
    title: "OverTaxed IL — Cook County property tax appeals",
    description: HOME_DESCRIPTION,
    siteName: "OverTaxed IL",
    // og:image auto-wired by app/opengraph-image.tsx
  },
  twitter: {
    card: "summary_large_image",
    title: "OverTaxed IL — Cook County property tax appeals",
    description: HOME_DESCRIPTION,
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
