/**
 * Response headers shared by the Slice 1 operator routes.
 *
 * An operator response is private, single-recipient, and must never be cached
 * by a browser, a proxy, or a shared CDN edge, nor indexed, nor content-sniffed
 * into something executable.
 */
export const NEUTRAL_OPERATOR_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const
