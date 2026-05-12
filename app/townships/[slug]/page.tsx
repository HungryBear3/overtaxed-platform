/**
 * Plural `/townships/[slug]` is the orphan route — it shipped with only six
 * hardcoded south-district townships and a hand-rolled appeal CTA. The
 * canonical detail page is `/township/[slug]` (singular), wired through
 * `components/ot-design/TownshipPage` and `lib/townships` for all 38 Cook
 * County townships.
 *
 * This handler redirects plural to singular so existing links keep working.
 */
import { redirect } from "next/navigation"

export const dynamic = "force-static"

export async function generateStaticParams() {
  // Keep the same six entries the plural route originally pre-rendered so
  // existing static-export paths don't 404 mid-deploy.
  return [
    { slug: "bloom" },
    { slug: "bremen" },
    { slug: "calumet" },
    { slug: "rich" },
    { slug: "thornton" },
    { slug: "worth" },
  ]
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/township/${slug}`)
}
