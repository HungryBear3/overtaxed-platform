import type { Metadata } from "next";
import CheckoutPage from "@/components/ot-design/CheckoutPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "../ot-design.css";
import {
  NEUTRAL_REPORT_NAME,
  NEUTRAL_REPORT_SUMMARY,
  neutralReportCopyEnabled,
} from "@/lib/copy/neutral-report";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com";

// The $97 and contingency offers are held, so they are absent from the title,
// description, OG and Twitter cards as well as the page body. Metadata is the
// copy most likely to outlive a change: it is what a search engine and a link
// preview keep showing after the product is gone.
const CHECKOUT_DESCRIPTION =
  "Start with the $69 DIY Appeal Packet. We prepare it; you review it, sign it, and file it with the county yourself. Eligibility is confirmed before payment.";

export function generateMetadata(): Metadata {
  const neutralReport = neutralReportCopyEnabled();
  const title = neutralReport ? `Checkout — ${NEUTRAL_REPORT_NAME}` : "Checkout";
  const description = neutralReport ? NEUTRAL_REPORT_SUMMARY : CHECKOUT_DESCRIPTION;

  return {
    title: title,
    description: description,
    alternates: { canonical: siteUrl + "/checkout" },
    openGraph: {
      type: "website",
      url: siteUrl + "/checkout",
      title,
      description,
      siteName: "OverTaxed IL",
      images: [{ url: "/opengraph-image", alt: "OverTaxed IL" }],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: ["/opengraph-image"],
    },
    robots: { index: false, follow: true },
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  // ?plan=done-for-you, ?plan=dfy and ?plan=contingency were direct URLs into
  // the held tiers. They are not honoured and they are not redirected to an
  // error either: any unrecognised plan resolves to the one offered plan, so a
  // stale link from an old email or post lands somewhere truthful.
  void plan;
  const initialPlan = "diy";
  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <CheckoutPage initialPlan={initialPlan} neutralReport={neutralReportCopyEnabled()} />
      <SiteFooter neutralReport={neutralReportCopyEnabled()} />
    </div>
  );
}
