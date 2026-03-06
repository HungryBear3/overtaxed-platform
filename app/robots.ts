import type { MetadataRoute } from "next"

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/properties", "/appeals", "/account", "/admin", "/auth"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
