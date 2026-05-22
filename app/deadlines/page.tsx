import type { Metadata } from "next";
import DeadlinesPage from "@/components/ot-design/DeadlinesPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import { TOWNSHIP_STATUS_COUNTS, TOWNSHIPS } from "@/lib/townships";
import "../ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com";

export const metadata: Metadata = {
  title:
    "Cook County Property Tax Appeal Deadlines 2026 — Township Calendar",
  description: `See which Cook County township appeal windows are open. ${TOWNSHIP_STATUS_COUNTS.open} open right now, with 2026 South & West Suburbs in active reassessment. Free deadline reminders by email.`,
  alternates: { canonical: siteUrl + "/deadlines" },
  openGraph: {
    type: "website",
    url: siteUrl + "/deadlines",
    title: "Cook County Property Tax Appeal Deadlines — Public Records Tracked",
    description:
      "See which Cook County township appeal windows are open. Free deadline reminders by email.",
    siteName: "OverTaxed IL",
    // og:image auto-wired by app/deadlines/opengraph-image.tsx
  },
  twitter: {
    card: "summary_large_image",
    title: "Cook County Property Tax Appeal Deadlines — Public Records Tracked",
    description: `${TOWNSHIP_STATUS_COUNTS.open} Cook County township appeal windows are open right now. See which one is yours.`,
    // twitter:image auto-wired by app/deadlines/opengraph-image.tsx
  },
  robots: { index: true, follow: true },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": TOWNSHIPS.filter(
    (t) => t.status === "open" || t.status === "opening-soon",
  ).map((t) => ({
    "@type": "Event",
    name: `${t.name} Township Property Tax Appeal Window`,
    startDate: t.openDate,
    endDate: t.closeDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: `${t.name} Township, Cook County, Illinois`,
      address: {
        "@type": "PostalAddress",
        addressRegion: "IL",
        addressCountry: "US",
      },
    },
    organizer: {
      "@type": "Organization",
      name: "Cook County Board of Review",
    },
    url: `${siteUrl}/township/${t.slug}`,
  })),
};

export default function Page() {
  return (
    <div className="ot-root">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader active="deadlines" />
      <DeadlinesPage />
      <SiteFooter />
    </div>
  );
}
