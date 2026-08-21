import type { MetadataRoute } from "next"
import { getAllPosts } from "@/lib/blog"
import { getTownshipSlugs } from "@/lib/townships"
import {
  ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS,
  getActiveTownshipCampaign,
} from "@/lib/marketing/active-township-campaigns"

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com"
export const revalidate = 43200

// Township slugs always come from the canonical data source in
// `lib/townships.ts` so the sitemap can never drift from the routes the
// app actually serves. Hardcoding a list here previously produced two
// SEO bugs: (1) it shipped 26 slugs while the data source held 38, and
// (2) it included a "chicago" slug that has no corresponding township
// record (no /township/chicago page exists).

// Blog slugs come from `lib/blog`, the same loader `app/blog/[slug]` and
// `app/blog` render from and `app/rss.xml` feeds. This used to read
// `content/blog` with its own `readdirSync`, which made the sitemap a second,
// independent source of truth for what the site publishes.
//
// That is not a hypothetical drift. A post's served slug is its frontmatter
// `slug` when one is present, and this function derived the slug from the
// *filename* — so a post whose frontmatter disagreed with its filename would be
// served at one URL and advertised to crawlers at another. It also meant a file
// dropped into `content/blog` was indexed without ever passing through the
// loader every other consumer uses.
//
// One source. See [[getAllPosts]].
function getBlogSlugs(): string[] {
  return getAllPosts().map((post) => post.slug)
}

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/check`, changeFrequency: "monthly", priority: 0.95 },
    { url: `${baseUrl}/blog`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/townships`, changeFrequency: "weekly", priority: 0.85 },
    { url: `${baseUrl}/hoa`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${baseUrl}/faq`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/contact`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/terms`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${baseUrl}/privacy`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${baseUrl}/disclaimer`, changeFrequency: "yearly", priority: 0.5 },
  ]

  const blogSlugs = getBlogSlugs()
  const blogPages: MetadataRoute.Sitemap = blogSlugs.map((slug) => ({
    url: `${baseUrl}/blog/${slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }))

  // Canonical detail route is /township/[slug] (singular). The legacy
  // /townships/[slug] route exists for back-compat redirects; emitting it
  // in the sitemap would advertise a redirecting URL to crawlers.
  const townshipPages: MetadataRoute.Sitemap = getTownshipSlugs().map((slug) => ({
    url: `${baseUrl}/township/${slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }))

  const townshipCampaignPages: MetadataRoute.Sitemap =
    ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS.map((slug) =>
      getActiveTownshipCampaign(slug),
    )
      .filter((campaign) => campaign?.phase === "active")
      .map((campaign) => ({
        url: `${baseUrl}/appeal-deadline/${campaign!.slug}`,
        changeFrequency: "daily" as const,
        priority: 0.95,
      }))

  return [
    ...staticPages,
    ...blogPages,
    ...townshipPages,
    ...townshipCampaignPages,
  ]
}
