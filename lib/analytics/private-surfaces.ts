/**
 * Paths where no analytics, attribution, referral or error-reporting
 * instrumentation may run — the single source both the client mount gate and
 * the server-side scrubbing read.
 *
 * ## Why this exists
 *
 * `/packet` is where a customer pastes the one-time code that IS the entire
 * authorization for their evidence packet. Its form is written around keeping
 * that value in as few places as possible: React state only, no storage, no
 * URL, no navigation, cleared in every branch.
 *
 * The root layout undid part of that by construction. Every route in this app
 * inherits one root layout, and that layout mounts UTM first-touch capture,
 * approved-code capture, and the analytics route tracker unconditionally — plus
 * the referral capture, Google Analytics and Vercel Analytics on the production
 * marketing host. None of those is a token logger, and the specific leak is not
 * the point: a page whose whole job is to hold a bearer credential in memory
 * should not also be running third-party script, writing first-touch
 * localStorage, or reporting page views, because every one of those is a
 * surface whose behaviour we do not control and would have to re-audit on every
 * upgrade.
 *
 * ## Why a path list rather than a route group
 *
 * Next.js can give a segment its own root layout via route groups, which would
 * be the structural answer. It would also mean moving all 50-odd existing
 * routes into a sibling group in one change, for one page. The gate is instead
 * applied where the instrumentation is mounted, so the isolation is one
 * decision in one place and the thing being isolated is named right here.
 *
 * ## Matching rule
 *
 * Exact path or path-prefixed-by-`/`. `/packet` and `/packet/anything` match;
 * `/packets` and `/packet-status` deliberately do not, because a prefix match
 * on a bare string would silently capture future unrelated routes. Query
 * strings and fragments are not part of a Next.js pathname and are never
 * considered here.
 *
 * Pure: no React, no framework, no I/O, so both a client component and a
 * Node-side Sentry hook can use it.
 */

/** Route prefixes that must run no instrumentation of any kind. */
export const PRIVATE_SURFACE_PREFIXES: readonly string[] = ["/packet"];

/**
 * API routes whose request bodies carry a bearer credential or provider
 * payload, and must never be captured by an error reporter.
 *
 * `/api/ot/packet/download` receives the capability itself in its POST body.
 * `/api/ot/webhooks/resend` receives a provider callback body which, before
 * this system's own sanitization, still contains the recipient's address.
 */
export const PRIVATE_API_PREFIXES: readonly string[] = [
  "/api/ot/packet/download",
  "/api/ot/webhooks/resend",
];

function matches(pathname: string, prefixes: readonly string[]): boolean {
  if (typeof pathname !== "string" || pathname === "") return false;
  // Defensive: a caller may hand us a full URL or a value with a query string.
  // Neither is a Next.js pathname, but truncating is cheaper than trusting.
  const path = pathname.split("?")[0]!.split("#")[0]!;
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** True for a page that must mount no analytics, attribution or referral code. */
export function isPrivateSurfacePath(pathname: string | null): boolean {
  return matches(pathname ?? "", PRIVATE_SURFACE_PREFIXES);
}

/** True for a request whose body or URL must never reach an error reporter. */
export function isPrivateRequestPath(pathname: string | null): boolean {
  const path = pathname ?? "";
  return (
    matches(path, PRIVATE_SURFACE_PREFIXES) ||
    matches(path, PRIVATE_API_PREFIXES)
  );
}

/**
 * The pathname of a URL-ish string, or "" when there isn't one.
 *
 * Sentry events carry absolute URLs; this pulls the path out without throwing
 * on a value that is not a URL at all.
 */
export function pathnameOf(url: unknown): string {
  if (typeof url !== "string" || url === "") return "";
  if (url.startsWith("/")) return url.split("?")[0]!.split("#")[0]!;
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
