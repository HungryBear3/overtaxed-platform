/**
 * Meta Pixel activation is on HOLD. Phase A loaded the Pixel without consent
 * whenever NEXT_PUBLIC_META_PIXEL_ID was set. This code mounts no Pixel: the
 * consent-gated candidate (components/analytics/meta-pixel.tsx) is unmounted,
 * and nothing can grant it consent yet. A build with the variable set would
 * therefore silently stop Meta collection, so it refuses to build and the
 * current deployment keeps serving until the owner decides. Any non-empty
 * value counts, because Phase A mounted the Pixel for any truthy id. The value
 * is never echoed. See docs/analytics/OT-ANALYTICS-PHASE-B.md.
 */
const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID
if (metaPixelId !== undefined && metaPixelId !== "") {
  throw new Error(
    "META_PIXEL_ACTIVATION_HOLD: NEXT_PUBLIC_META_PIXEL_ID is set, but this build mounts no Meta Pixel and " +
      "nothing can grant the consent-gated candidate consent, so deploying it would silently stop Meta " +
      "collection. Keep the current deployment, or unset NEXT_PUBLIC_META_PIXEL_ID for this environment as an " +
      "explicit owner decision to stop the Pixel. See docs/analytics/OT-ANALYTICS-PHASE-B.md.",
  )
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: "/index",
        destination: "/",
        permanent: true,
      },
    ]
  },
}

export default nextConfig
