import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/ot-design/SiteChrome";
import {
  ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS,
  buildCampaignFreeCheckHref,
  formatCampaignDate,
  getActiveTownshipCampaign,
} from "@/lib/marketing/active-township-campaigns";
import "../../ot-design.css";

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com";

export const revalidate = 43200;

export function generateStaticParams() {
  return ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const campaign = getActiveTownshipCampaign(slug);
  if (!campaign) return { title: "Township deadline not found" };
  const deadline = formatCampaignDate(campaign.lastFileDate);
  const active = campaign.phase === "active";
  return {
    title: `${campaign.name} Township Property Tax Appeal Deadline 2026`,
    description: active
      ? `The Cook County Assessor lists ${deadline} as the ${campaign.name} Township last-file date. Run a free public-record property check.`
      : `${campaign.name} Township's 2026 Assessor window is ${campaign.phase}. Run a free property check and review the official calendar.`,
    alternates: {
      canonical: `${siteUrl}/appeal-deadline/${campaign.slug}`,
    },
    robots: active
      ? { index: true, follow: true }
      : { index: false, follow: true },
  };
}

export default async function TownshipDeadlineCampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const campaign = getActiveTownshipCampaign(slug);
  if (!campaign) notFound();

  const openDate = formatCampaignDate(campaign.noticeDate);
  const deadline = formatCampaignDate(campaign.lastFileDate);

  return (
    <div className="ot-root">
      <SiteHeader active="deadlines" />
      <main>
        <section className="ot-tp-hero">
          <div className="ot-tp-hero-inner">
            <nav className="ot-tp-crumbs" aria-label="Breadcrumb">
              <Link href="/">Home</Link>
              <span>›</span>
              <Link href="/deadlines">Deadlines</Link>
              <span>›</span>
              <span>{campaign.name}</span>
            </nav>
            <div className="ot-tp-hero-grid">
              <div className="ot-tp-hero-main">
                <div className="ot-eyebrow">Official Assessor window</div>
                <h1 className="ot-tp-h1">
                  <span className="ot-tp-h1-name">
                    {campaign.name} Township
                  </span>
                  <span className="ot-tp-h1-sub">
                    {campaign.phase === "active"
                      ? `property tax appeal deadline: ${deadline}`
                      : campaign.phase === "upcoming"
                        ? `Assessor window opens ${openDate}`
                        : "2026 Assessor window has closed"}
                  </span>
                </h1>
                <p className="ot-tp-sub">
                  {campaign.localContext}{" "}
                  {campaign.phase === "active"
                    ? `The Cook County Assessor currently lists ${deadline} as the last-file date.`
                    : campaign.phase === "expired"
                      ? "The first-level Assessor window is no longer open. The Board of Review is a separate later opportunity."
                      : `The published window opens ${openDate}.`}
                </p>
                <div className="ot-tp-hero-cta-row">
                  <Link
                    href={buildCampaignFreeCheckHref(campaign, "hero")}
                    className="ot-cta"
                    data-campaign-id={campaign.campaignId}
                    data-campaign-phase={campaign.phase}
                  >
                    Run my free property check{" "}
                    <span className="ot-cta-arrow">→</span>
                  </Link>
                </div>
              </div>
              <aside className="ot-tp-hero-card">
                <dl className="ot-tp-card-dl">
                  <div>
                    <dt>Window opens</dt>
                    <dd>{openDate}</dd>
                  </div>
                  <div>
                    <dt>Last-file date</dt>
                    <dd>{deadline}</dd>
                  </div>
                  <div>
                    <dt>Current state</dt>
                    <dd>
                      {campaign.phase === "active"
                        ? `${campaign.daysRemaining} days remaining`
                        : campaign.phase}
                    </dd>
                  </div>
                  <div>
                    <dt>Official source</dt>
                    <dd>
                      <a href={campaign.calendarUrl}>
                        Cook County Assessor calendar
                      </a>
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
          </div>
        </section>
        <section className="ot-tp-check">
          <div className="ot-tp-check-inner">
            <div className="ot-tp-check-eyebrow">Start with the evidence</div>
            <h2 className="ot-tp-check-h2">
              Check whether your <em>{campaign.name}</em> assessment may deserve
              a closer look.
            </h2>
            <p className="ot-tp-check-sub">
              {campaign.evidenceContext} The check is free and does not promise
              a reduction or require you to buy a service.
            </p>
            <Link
              href={buildCampaignFreeCheckHref(campaign, "body")}
              className="ot-cta"
              data-campaign-id={campaign.campaignId}
              data-campaign-phase={campaign.phase}
            >
              Check my property <span className="ot-cta-arrow">→</span>
            </Link>
            <p className="ot-tp-check-meta">
              OverTaxed IL is not a law firm. You may file directly with the
              Cook County Assessor at no charge. Always confirm the current
              deadline with the official county source before filing.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
