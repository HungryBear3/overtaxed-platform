import type { MetadataRoute } from "next"
import fs from "fs"
import path from "path"
import { getTownshipSlugs } from "@/lib/townships"

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com"

// Township slugs always come from the canonical data source in
// `lib/townships.ts` so the sitemap can never drift from the routes the
// app actually serves. Hardcoding a list here previously produced two
// SEO bugs: (1) it shipped 26 slugs while the data source held 38, and
// (2) it included a "chicago" slug that has no corresponding township
// record (no /township/chicago page exists).

function getBlogSlugs(): string[] {
  try {
    const blogDir = path.join(process.cwd(), "content/blog")
    return fs
      .readdirSync(blogDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""))
  } catch {
    return []
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/pricing`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/check`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.95 },
    { url: `${baseUrl}/blog`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/townships`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.85 },
    { url: `${baseUrl}/faq`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/contact`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.5 },
    { url: `${baseUrl}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.5 },
    { url: `${baseUrl}/disclaimer`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.5 },
  ]

  const blogSlugs = getBlogSlugs()
  const blogPages: MetadataRoute.Sitemap = blogSlugs.map((slug) => ({
    url: `${baseUrl}/blog/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }))

  // Canonical detail route is /township/[slug] (singular). The legacy
  // /townships/[slug] route exists for back-compat redirects; emitting it
  // in the sitemap would advertise a redirecting URL to crawlers.
  const townshipPages: MetadataRoute.Sitemap = getTownshipSlugs().map((slug) => ({
    url: `${baseUrl}/township/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }))

  return [...staticPages, ...blogPages, ...townshipPages]
}
