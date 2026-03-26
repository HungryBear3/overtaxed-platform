import type { MetadataRoute } from "next"
import fs from "fs"
import path from "path"

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com"

const townshipSlugs = [
  "bloom", "bremen", "calumet", "rich", "thornton", "worth",
  "lemont", "lyons", "orland", "palos", "stickney",
  "barrington", "elk-grove", "evanston", "maine", "niles",
  "new-trier", "northfield", "palatine", "wheeling",
  "chicago", "berwyn", "hanover", "oak-park", "river-forest", "schaumburg",
]

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

  const townshipPages: MetadataRoute.Sitemap = townshipSlugs.map((slug) => ({
    url: `${baseUrl}/townships/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }))

  return [...staticPages, ...blogPages, ...townshipPages]
}
