import type { MetadataRoute } from "next"

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // `/packet` is a private transactional surface: a customer redeems a
      // one-time code there. It publishes no prose worth crawling and must not
      // appear in a search result.
      disallow: ["/dashboard", "/properties", "/appeals", "/account", "/admin", "/auth", "/packet"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
