import type { Metadata } from "next";
import LiveDeadlinesPage from "@/components/ot-design/LiveDeadlinesPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "../ot-design.css";

const TOWNSHIPS_TITLE = "Cook County Township Appeal Deadlines";
const TOWNSHIPS_DESCRIPTION =
  "The filing window for each of the 38 Cook County townships, as published by the Cook County Assessor. Unverified or expired source data shows no date.";
const TOWNSHIPS_URL = "https://www.overtaxed-il.com/townships";

export const metadata: Metadata = {
  title: TOWNSHIPS_TITLE,
  description: TOWNSHIPS_DESCRIPTION,
  alternates: { canonical: TOWNSHIPS_URL },
  openGraph: { title: TOWNSHIPS_TITLE, description: TOWNSHIPS_DESCRIPTION, url: TOWNSHIPS_URL, siteName: "OverTaxed IL", type: "website", images: [{ url: "/opengraph-image", alt: "OverTaxed IL" }] },
  twitter: { card: "summary", title: TOWNSHIPS_TITLE, description: TOWNSHIPS_DESCRIPTION, images: ["/opengraph-image"] },
};

// The two informational calendar routes share the same live feed and lifecycle.
// Neither route may fall back to the bundled commerce snapshot or enable capture.
export default function TownshipsPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="deadlines" />
      <LiveDeadlinesPage />
      <SiteFooter />
    </div>
  );
}
