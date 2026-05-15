import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TownshipPage from "@/components/ot-design/TownshipPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import {
  getTownshipBySlug,
  getTownshipSlugs,
  TOWNSHIPS_BY_SLUG,
} from "@/lib/townships";
import "../../ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com";

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
    return { title: "Township not found | OverTaxed IL" };
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
  return (
    <div className="ot-root">
      <SiteHeader active="deadlines" />
      <TownshipPage township={t} />
      <SiteFooter />
    </div>
  );
}
