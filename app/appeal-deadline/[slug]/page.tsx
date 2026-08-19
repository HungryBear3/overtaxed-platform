/**
 * /appeal-deadline/[slug] — the four township campaign landing pages.
 *
 * These are the highest-intent pages on the site: a reader arrives from a
 * search or an ad for a filing deadline, and everything above the fold is a
 * date. That makes the freshness rules load-bearing rather than decorative.
 *
 * Two things changed structurally.
 *
 * `revalidate = 43200` is gone. Twelve-hour ISR meant a rendered date could be
 * served for half a day after the source behind it expired, and the same-day
 * retrieval rule for an active window cannot be satisfied by a page built
 * yesterday — the cache would keep saying "the Assessor currently lists
 * August 12" long after the projection had stopped being willing to say it.
 *
 * The pending state renders instead of 404ing. `getActiveTownshipCampaign`
 * now returns a dateless pending campaign rather than `null`, so an
 * unverified window produces a page with no date, no countdown, and no
 * free-check CTA — rather than a 404 on an advertised URL.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/ot-design/SiteChrome";
import {
  ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS,
  buildCampaignFreeCheckHref,
  formatCampaignDate,
  getActiveTownshipCampaign,
  type ActiveTownshipCampaign,
} from "@/lib/marketing/active-township-campaigns";
import { DEADLINE_PENDING_NOTICE } from "@/lib/deadline-sources";
import { cc08, cc16, CC_11 } from "@/lib/copy/canonical";
import "../../ot-design.css";

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com";

const SOURCE = "the Cook County Assessor";
const STAGE = "Cook County Assessor";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS.map((slug) => ({ slug }));
}

/**
 * The provenance sentence for whatever state the campaign is in.
 *
 * An expired window gets CC-16, which carries the source, the retrieval, and
 * the "we are not selling a packet for a closed window" position in one
 * mandated string.
 */
function provenanceLine(campaign: ActiveTownshipCampaign): string {
  if (!campaign.official) return DEADLINE_PENDING_NOTICE;
  if (campaign.phase === "expired") {
    return cc16({
      stage: STAGE,
      township: `${campaign.name} Township`,
      source: SOURCE,
      timestamp: campaign.retrievedAt,
    });
  }
  return cc08({ source: SOURCE, timestamp: campaign.retrievedAt });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const campaign = getActiveTownshipCampaign(slug);
  if (!campaign) return { title: "Township deadline not found" };

  const active = campaign.official && campaign.phase === "active";
  const description = !campaign.official
    ? `${campaign.name} Township, Cook County. We have not verified this township's Assessor filing deadline against the county's published calendar, so this page does not show one.`
    : active
      ? `The Cook County Assessor lists ${formatCampaignDate(campaign.lastFileDate)} as the ${campaign.name} Township last-file date. Run a free public-record property check.`
      : `${campaign.name} Township's 2026 Assessor window is ${campaign.phase}. Run a free property check and review the official calendar.`;

  return {
    title: `${campaign.name} Township Property Tax Appeal Deadline 2026`,
    description,
    alternates: {
      canonical: `${siteUrl}/appeal-deadline/${campaign.slug}`,
    },
    // Only an active, verified window is worth indexing. A pending page has
    // nothing to rank for and would compete with the township page that does.
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

  const active = campaign.official && campaign.phase === "active";
  const openDate = campaign.official
    ? formatCampaignDate(campaign.noticeDate)
    : null;
  const deadline = campaign.official
    ? formatCampaignDate(campaign.lastFileDate)
    : null;

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
                <div className="ot-eyebrow">
                  {campaign.official
                    ? "Official Assessor window"
                    : "Cook County Assessor appeals"}
                </div>
                <h1 className="ot-tp-h1">
                  <span className="ot-tp-h1-name">
                    {campaign.name} Township
                  </span>
                  <span className="ot-tp-h1-sub">
                    {!campaign.official
                      ? "property tax appeals"
                      : campaign.phase === "active"
                        ? `property tax appeal deadline: ${deadline}`
                        : campaign.phase === "upcoming"
                          ? `Assessor window opens ${openDate}`
                          : "2026 Assessor window has closed"}
                  </span>
                </h1>
                <p className="ot-tp-sub">
                  {campaign.localContext}{" "}
                  {!campaign.official
                    ? "We are not showing a filing deadline for this township, because we have not verified one."
                    : campaign.phase === "active"
                      ? `The Cook County Assessor currently lists ${deadline} as the last-file date.`
                      : campaign.phase === "expired"
                        ? "The first-level Assessor window is no longer open. The Board of Review is a separate later opportunity."
                        : `The published window opens ${openDate}.`}
                </p>
                {/* The expired branch above points a homeowner at the Board of
                    Review as "a separate later opportunity" — at the exact
                    moment they have missed the Assessor window and are most
                    likely to act on it. BL-F5 requires CC-11 wherever the Board
                    is named, and here it is also the substantive answer: the
                    opportunity is real, but it is not one we can take for them. */}
                {campaign.official && campaign.phase === "expired" && (
                  <p className="ot-tp-sub">{CC_11}</p>
                )}
                <p className="ot-tp-sub">{provenanceLine(campaign)}</p>
                <div className="ot-tp-hero-cta-row">
                  {/* The free-check CTA is bound to the same projection as the
                      date beside it. It previously rendered in every phase,
                      including expired — inviting a homeowner to start a check
                      whose only next step was a window that had already shut.
                      Suppressing the CTA and the date together is the rule;
                      keeping one without the other is the defect. */}
                  {active ? (
                    <Link
                      href={buildCampaignFreeCheckHref(campaign, "hero")}
                      className="ot-cta"
                      data-campaign-id={campaign.campaignId}
                      data-campaign-phase={campaign.phase}
                    >
                      Run my free property check{" "}
                      <span className="ot-cta-arrow">→</span>
                    </Link>
                  ) : (
                    <a
                      href={campaign.calendarUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ot-cta"
                      data-campaign-id={campaign.campaignId}
                      data-campaign-phase={campaign.phase}
                    >
                      Check the county calendar{" "}
                      <span className="ot-cta-arrow">→</span>
                    </a>
                  )}
                </div>
              </div>
              <aside className="ot-tp-hero-card">
                <dl className="ot-tp-card-dl">
                  {campaign.official ? (
                    <>
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
                        {/* `daysRemaining` is null on the informational tier,
                            which is every reader of this page. The old template
                            interpolated it unconditionally and would have
                            printed "null days remaining". */}
                        <dd>
                          {campaign.daysRemaining !== null
                            ? `${campaign.daysRemaining} days remaining`
                            : campaign.phase}
                        </dd>
                      </div>
                    </>
                  ) : (
                    <div>
                      <dt>Filing deadline</dt>
                      <dd>Not verified — see the county calendar</dd>
                    </div>
                  )}
                  <div>
                    <dt>Official source</dt>
                    <dd>
                      <a
                        href={campaign.calendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
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
            {active ? (
              <Link
                href={buildCampaignFreeCheckHref(campaign, "body")}
                className="ot-cta"
                data-campaign-id={campaign.campaignId}
                data-campaign-phase={campaign.phase}
              >
                Check my property <span className="ot-cta-arrow">→</span>
              </Link>
            ) : (
              <p className="ot-tp-check-sub">{provenanceLine(campaign)}</p>
            )}
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
