/**
 * /township/[slug] — one township, one evaluated deadline state.
 *
 * The route evaluates `buildTownship2026Views()` once per request, against the
 * same published informational snapshot `/deadlines` and `/townships` read,
 * and hands the resulting projection to the body, the metadata, the FAQPage
 * JSON-LD and the neighbour cards.
 * Those three used to disagree: the body read roster seed dates through
 * `TownshipPage`, the description recomputed its own "N days left to file"
 * from `t.daysUntilClose`, and the JSON-LD was a hand-typed prose copy of the
 * visible FAQ that a later edit to either side would silently break. Three
 * renderings of a deadline, three chances to be wrong independently, and the
 * two a homeowner is most likely to act on — the search snippet and the rich
 * result — were the two nobody would notice going stale.
 *
 * `force-dynamic` is deliberate and replaces `generateStaticParams`. These 38
 * pages were statically prerendered, which meant a date was baked at build
 * time and served unchanged until the next deploy: exactly the failure mode
 * the freshness contract exists to prevent, since a window can close between
 * build and read. Rendering per request lets the projection re-derive status
 * and re-check source freshness against the current clock, and lets a
 * verified page become a pending page without a deploy.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import TownshipPage, {
  type TownshipFaqEntry,
} from "@/components/ot-design/TownshipPage";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import { TOWNSHIPS_BY_SLUG, type Township } from "@/lib/townships";
import {
  buildTownship2026Views,
  type Township2026View,
} from "@/lib/deadlines-2026";
import {
  readInformationalSnapshot,
  UNAVAILABLE_SERVER_INFORMATIONAL_SNAPSHOT,
} from "@/lib/deadlines/read-informational-snapshot";
import { DEADLINE_PENDING_NOTICE } from "@/lib/deadline-sources";
import { cc08, cc16 } from "@/lib/copy/canonical";
import "../../ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com";

const SOURCE = "the Cook County Assessor";
const STAGE = "Cook County Assessor";

export const dynamic = "force-dynamic";

/**
 * Evaluate every township once and index it. Neighbour cards need their own
 * neighbours' projections, and re-evaluating per card would let two cards on
 * one page straddle a midnight boundary.
 *
 * The source is the published informational snapshot the indexes hydrate
 * from, read at one instant per request (`cache` shares it between the page
 * and its metadata). It is never the bundled synthetic default: an
 * unavailable, stale or invalid read is passed as an explicit unavailable
 * snapshot, which renders every township pending.
 */
const evaluate = cache(async (): Promise<Map<string, Township2026View>> => {
  const now = new Date();
  const snapshot =
    (await readInformationalSnapshot(now)) ?? UNAVAILABLE_SERVER_INFORMATIONAL_SNAPSHOT;
  return new Map(buildTownship2026Views(now, snapshot).map((v) => [v.slug, v]));
});

/**
 * The FAQ, as plain text, in the exact form both the visible `<details>` list
 * and the FAQPage JSON-LD use.
 *
 * One array, two consumers. Google rejects FAQPage markup whose answers do not
 * appear on the page, and the previous arrangement — a JSX list in the
 * component and a prose list here, kept in step by a comment asking future
 * editors to mirror their edits — is the arrangement that guarantee is usually
 * lost in.
 *
 * Every answer carrying a date carries CC-08 with it, because a rich result
 * can be read entirely detached from the page the provenance line sits on.
 */
function buildTownshipFaqEntries(
  t: Township,
  view: Township2026View,
): TownshipFaqEntry[] {
  // No cycle years. The roster's `cycleYear` is not supported by the official
  // sources for every district, and the Assessor window is not evidence of
  // which year a township is reassessed in, so no year is printed at all.
  const entries: TownshipFaqEntry[] = [];

  if (view.official && view.retrievedAt) {
    const provenance =
      view.status === "closed"
        ? cc16({
            stage: STAGE,
            township: `${t.name} Township`,
            source: SOURCE,
            timestamp: view.retrievedAt,
          })
        : cc08({ source: SOURCE, timestamp: view.retrievedAt });

    entries.push({
      q: `When does the ${t.name} Township appeal window open and close?`,
      a:
        `The Cook County Assessor window opens ${view.openLabel} and closes ${view.lastFileLabel}. ` +
        `${provenance}`,
    });
    entries.push({
      // These township windows are Assessor-stage reassessment windows. Calling
      // them "the Board of Review appeal deadline" named the wrong stage — and
      // the one stage OverTaxed IL cannot serve — on 38 pages at once.
      q: `What's the deadline to file an appeal in ${t.name}?`,
      a:
        `The Cook County Assessor appeal deadline for ${t.name} Township is ${view.lastFileLabel}. ` +
        `Late filings are not accepted — there is no grace period and no appeal-by-mail postmark exception. ` +
        `${provenance}`,
    });
  } else {
    // One question, not two. Splitting an absent deadline across "when does it
    // open" and "when is it due" would print the same pending notice twice and
    // read as two facts.
    entries.push({
      q: `When can I appeal in ${t.name} Township?`,
      a:
        `${DEADLINE_PENDING_NOTICE} ` +
        `Cook County reassesses each township once every three years.`,
    });
  }

  entries.push({
    q: `What does it cost to appeal?`,
    a:
      `The Cook County Assessor charges no fee to file. You can file on your own at no cost.`,
  });
  entries.push({
    q: `What evidence do I need to appeal in ${t.name}?`,
    a:
      `The Assessor accepts comparable assessments, relevant sales evidence, ` +
      `lack-of-uniformity arguments (your assessment vs. similar properties), and condition-based evidence ` +
      `(recent photos, contractor estimates). We pull public-record comparable properties from ` +
      `${t.name} and surrounding townships automatically when you run a free check.`,
  });
  entries.push({
    q: `Will appealing increase my taxes?`,
    a:
      `The Assessor can confirm or lower your assessed value on your own appeal, but cannot raise it as a result of it. ` +
      `A change in assessed value does not produce an equal change in a tax bill.`,
  });

  return entries;
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

function buildFaqJsonLd(faq: TownshipFaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
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
  const view = (await evaluate()).get(slug);

  // No "N days left to file". A countdown in a description is a number a
  // crawler caches and a reader trusts, and neither of them re-derives it.
  const description =
    view?.official && view.lastFileLabel
      ? `${t.name} Township Cook County Assessor appeal window: ${view.openLabel} – ${view.lastFileLabel}. ` +
        `Confirm your filing deadline with the county before you file.`
      : `${t.name} Township, Cook County. We have not verified this township's Assessor filing deadline against the county's published calendar, so this page does not show one. ` +
        `Confirm your filing deadline with the county before you file.`;

  return {
    title: `${t.name} Township Property Tax Appeal Deadline`,
    description,
    alternates: { canonical: `${siteUrl}/township/${t.slug}` },
    openGraph: {
      type: "website",
      url: `${siteUrl}/township/${t.slug}`,
      title: `${t.name} Township Property Tax Appeal`,
      description,
      siteName: "OverTaxed IL",
      // og:image auto-wired by app/township/[slug]/opengraph-image.tsx
    },
    twitter: {
      card: "summary_large_image",
      title: `${t.name} Township appeal window`,
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
  const t = TOWNSHIPS_BY_SLUG[slug];
  const views = await evaluate();
  const view = views.get(slug);
  if (!t || !view) {
    notFound();
  }

  const neighbors = (t.neighbors || [])
    .map((neighborSlug) => {
      const roster = TOWNSHIPS_BY_SLUG[neighborSlug];
      const neighborView = views.get(neighborSlug);
      return roster && neighborView
        ? { township: roster, view: neighborView }
        : null;
    })
    .filter((n): n is { township: Township; view: Township2026View } => n !== null);

  const faq = buildTownshipFaqEntries(t, view);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(t);
  const faqJsonLd = buildFaqJsonLd(faq);

  return (
    <div className="ot-root">
      <SiteHeader active="deadlines" />
      <TownshipPage
        township={t}
        view={view}
        neighbors={neighbors}
        faq={faq}
      />
      {/* Informational page: CC-12 footer unconditionally, see SiteFooter. */}
      <SiteFooter informationalPage />
      <script
        type="application/ld+json"
        // Server-rendered structured data. The breadcrumb mirrors the visible
        // crumb trail; the FAQ payload is built from the same array the body
        // renders, so it cannot describe a deadline the page does not show.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </div>
  );
}
