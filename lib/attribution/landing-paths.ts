/**
 * The closed set of landing values an attribution touch may carry.
 *
 * A pathname is text somebody else can choose. A partner link to
 * `/clients/jane-doe-123-main-st` renders the not-found page, but the root
 * layout still mounts on it, so a capture that stored "the path the visitor
 * landed on" would store a name and a street address. So a landing is never
 * the raw path: it is either one of the public marketing routes below, spelled
 * exactly, or the TEMPLATE of a public dynamic route. The dynamic segment
 * itself is discarded — `/townships/cicero` lands as `/townships/[slug]` — so
 * no visitor-chosen segment is ever kept. A campaign about one township says
 * so in its campaign name, which is where that fact belongs.
 *
 * Everything else — account, admin, appeal and property routes that carry
 * record ids, the private `/packet` surface, and any unknown path — has no
 * landing value at all.
 *
 * Pure: no framework and no I/O, so the client capture, the checkout route and
 * the experiment-registry lint all read the same list.
 */

const STATIC_LANDING_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/about",
  "/appeal-packet",
  "/blog",
  "/board-of-review",
  "/check",
  "/checkout",
  "/contact",
  "/deadlines",
  "/disclaimer",
  "/faq",
  "/hoa",
  "/homestead-exemption",
  "/how-it-works",
  "/landlord-notices",
  "/pricing",
  "/privacy",
  "/refunds",
  "/terms",
  "/townships",
])

const DYNAMIC_LANDING_TEMPLATES: ReadonlyArray<{ prefix: string; template: string }> = [
  { prefix: "/appeal-deadline/", template: "/appeal-deadline/[slug]" },
  { prefix: "/blog/", template: "/blog/[slug]" },
  { prefix: "/partner/", template: "/partner/[code]" },
  { prefix: "/township/", template: "/township/[slug]" },
  { prefix: "/townships/", template: "/townships/[slug]" },
]

const TEMPLATE_VALUES: ReadonlySet<string> = new Set(DYNAMIC_LANDING_TEMPLATES.map((entry) => entry.template))

/** One lowercase slug segment. Only its shape is checked; its value is dropped. */
const SLUG_SEGMENT = /^[a-z0-9][a-z0-9-]{0,79}$/

const MAX_PATHNAME_LENGTH = 200

/**
 * The landing value for a browser pathname, or `null` when the path is not a
 * public landing route. Query strings and fragments are never part of a
 * pathname; a value carrying either is refused rather than truncated.
 */
export function normalizeLandingPath(pathname: unknown): string | null {
  if (typeof pathname !== "string") return null
  if (pathname.length === 0 || pathname.length > MAX_PATHNAME_LENGTH) return null
  if (!pathname.startsWith("/")) return null
  if (pathname.includes("?") || pathname.includes("#")) return null

  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
  if (STATIC_LANDING_PATHS.has(path)) return path

  for (const { prefix, template } of DYNAMIC_LANDING_TEMPLATES) {
    if (!path.startsWith(prefix)) continue
    return SLUG_SEGMENT.test(path.slice(prefix.length)) ? template : null
  }
  return null
}

/** True only for a value `normalizeLandingPath` can return. */
export function isAllowlistedLanding(value: unknown): value is string {
  return typeof value === "string" && (STATIC_LANDING_PATHS.has(value) || TEMPLATE_VALUES.has(value))
}

/** Every value `normalizeLandingPath` can return, sorted. For export mapping contracts. */
export function allowlistedLandingValues(): string[] {
  return [...STATIC_LANDING_PATHS, ...TEMPLATE_VALUES].sort()
}
