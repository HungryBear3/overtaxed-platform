import type { Metadata } from "next";
import DeadlinesPage from "@/components/ot-design/DeadlinesPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "../ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com";

export const metadata: Metadata = {
  title:
    "Cook County Property Tax Appeal Deadlines — Township Calendar",
  description:
    "An indicative Cook County township appeal calendar with links to the official county sources. Appeal dates vary by township and change through the year — always confirm your exact deadline with the Cook County Assessor before filing.",
  alternates: { canonical: siteUrl + "/deadlines" },
  openGraph: {
    type: "website",
    url: siteUrl + "/deadlines",
    title: "Cook County Property Tax Appeal Deadlines — Township Calendar",
    description:
      "An indicative township appeal calendar with links to the official Cook County sources. Confirm your exact deadline with the county before filing.",
    siteName: "OverTaxed IL",
    // og:image auto-wired by app/deadlines/opengraph-image.tsx
  },
  twitter: {
    card: "summary_large_image",
    title: "Cook County Property Tax Appeal Deadlines — Township Calendar",
    description:
      "An indicative township appeal calendar. Dates vary by township and change through the year — confirm yours with the official Cook County source before filing.",
    // twitter:image auto-wired by app/deadlines/opengraph-image.tsx
  },
  robots: { index: true, follow: true },
};

// NOTE: We intentionally do NOT emit Event JSON-LD with specific per-township
// open/close dates. Those dates are an indicative planning aid, not a verified
// per-year county feed, so publishing them as machine-readable structured data
// would assert an official deadline we can't stand behind. The page links to
// the official Cook County sources instead.

export default function Page() {
  return (
    <div className="ot-root">
      <SiteHeader active="deadlines" />
      <DeadlinesPage />
      <SiteFooter />
    </div>
  );
}
