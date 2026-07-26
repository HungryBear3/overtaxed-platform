import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TownshipPage from "@/components/ot-design/TownshipPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import {
  getTownshipBySlug,
  getTownshipSlugs,
  TOWNSHIPS_BY_SLUG,
  type Township,
} from "@/lib/townships";
import "../../ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com";

/**
 * Plain-text mirror of the visible FAQ in TownshipPage.tsx for FAQPage
 * JSON-LD. Text content must match the visible Q/A — Google rejects
 * FAQPage markup whose answers don't appear on the page. If the visible
 * FAQ in TownshipPage.tsx changes, mirror the change here.
 */
function buildTownshipFaqEntries(t: Township) {
  const nextCycle = t.cycleYear + 3;
  return [
    {
      q: `When does the ${t.name} Township appeal window open and close?`,
      a:
        `The ${t.cycleYear} window opens ${t.openDateLong} and closes ${t.closeDateLong}. ` +
        `After it closes, the next opportunity to formally appeal will be in ${nextCycle} ` +
        `(Cook County reassesses each township once every three years).`,
    },
    {
      q: `What's the deadline to file an appeal in ${t.name}?`,
      a:
        `The Board of Review appeal deadline for ${t.name} Township is ${t.closeDateLong}. ` +
        `Late filings are not accepted — there is no grace period and no appeal-by-mail postmark exception.`,
    },
    {
      q: `What does it cost to appeal?`,
      a:
        `The Cook County Board of Review charges no fee. OverTaxed IL offers a $69 DIY Appeal Packet, ` +
        `$97 Done-For-You filing after explicit authorization, and a 22% contingency option for eligible cases. ` +
        `You can also file on your own at no cost.`,
    },
    {
      q: `What evidence do I need to appeal in ${t.name}?`,
      a:
        `The Board of Review accepts comparable assessments, relevant sales evidence, ` +
        `lack-of-uniformity arguments (your assessment vs. similar properties), and condition-based evidence ` +
        `(recent photos, contractor estimates). We pull public-record comparable properties from ` +
        `${t.name} and surrounding townships automatically when you run a free check.`,
    },
    {
      q: `Will appealing increase my taxes?`,
      a:
        `No. The Board of Review can confirm or lower your assessed value but cannot raise it as a result of your appeal. ` +
        `The worst case is your assessment stays the same.`,
    },
  ];
}

function buildBreadcrumbJsonLd(t: Township) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Deadlines",
        item: `${siteUrl}/deadlines`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `${t.name} Township`,
        item: `${siteUrl}/township/${t.slug}`,
      },
    ],
  };
}

function buildFaqJsonLd(t: Township) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: buildTownshipFaqEntries(t).map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function generateStaticParams() {
  return getTownshipSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = TOWNSHIPS_BY_SLUG[slug];
  if (!t) {
    return { title: "Township not found" };
  }
  const days =
    t.status === "open"
      ? `${t.daysUntilClose} days left to file`
      : t.status === "opening-soon"
        ? `Opens ${t.openDateLong}`
        : `Next window: ${t.cycleYear}`;
  const description =
    `${t.name} Township appeal window: ${t.openDateLong} – ${t.closeDateLong}. ` +
    `${days}. Free check, deadline reminders, and $97 done-for-you filing.`;

  return {
    title: `${t.name} Township Property Tax Appeal Deadline ${t.cycleYear}`,
    description,
    alternates: { canonical: `${siteUrl}/township/${t.slug}` },
    openGraph: {
      type: "website",
      url: `${siteUrl}/township/${t.slug}`,
      title: `${t.name} Township Property Tax Appeal — ${t.cycleYear} Cycle`,
      description,
      siteName: "OverTaxed IL",
      // og:image auto-wired by app/township/[slug]/opengraph-image.tsx
    },
    twitter: {
      card: "summary_large_image",
      title: `${t.name} Township appeal window — ${t.cycleYear}`,
      description,
      // twitter:image auto-wired by app/township/[slug]/opengraph-image.tsx
    },
    robots: { index: true, follow: true },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = getTownshipBySlug(slug);
  if (!t) {
    notFound();
  }
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(t);
  const faqJsonLd = buildFaqJsonLd(t);
  return (
    <div className="ot-root">
      <SiteHeader active="deadlines" />
      <TownshipPage township={t} />
      <SiteFooter />
      <script
        type="application/ld+json"
        // Server-rendered structured data. Content mirrors the visible
        // breadcrumb + FAQ rendered by TownshipPage.tsx.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </div>
  );
}
