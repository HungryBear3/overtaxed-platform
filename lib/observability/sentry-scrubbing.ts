/**
 * Request-data scrubbing for Sentry, applied before any event leaves the
 * process.
 *
 * ## What this is defending
 *
 * `@sentry/nextjs` attaches request context to server events. For a route
 * handler that includes the URL, the headers, and — depending on version and
 * configuration — the request body. Two of this application's routes must never
 * have theirs captured:
 *
 *   - `POST /api/ot/packet/download` takes the packet capability in its JSON
 *     body. That value IS the authorization for a customer's evidence packet.
 *     It is deliberately kept out of URLs, access logs, `Referer` headers and
 *     browser history; sending it to a third-party error aggregator instead
 *     would defeat every one of those decisions at once, and it would sit there
 *     in full text, searchable, for the retention period;
 *   - `POST /api/ot/webhooks/resend` takes a provider callback body. This
 *     system's own normalizer strips it down to an event type, an allowlisted
 *     reason code and an opaque message id — but the RAW body Sentry would
 *     attach still contains the recipient's email address and whatever the
 *     remote SMTP server said, which is exactly the free text the evidence
 *     model refuses to persist.
 *
 * `/packet` is included for the same reason its client instrumentation is
 * suppressed: it is the page holding that credential in memory.
 *
 * ## Why the body is dropped EVERYWHERE, not only there
 *
 * An allowlist of safe routes would be the wrong shape: the risk is that a
 * route added later carries something sensitive and nobody remembers this file
 * exists. So `request.data` — the body — is removed from every event, and the
 * private paths additionally lose their headers, cookies and query string. The
 * cost is that a body is never available for debugging; the benefit is that
 * "did we remember to add the new route" is not a question anyone has to answer
 * correctly.
 *
 * ## Status
 *
 * `sentry.server.config.ts` and `sentry.edge.config.ts` are present in this
 * repository but are NOT currently loaded: there is no `instrumentation.ts` and
 * `next.config.mjs` does not wrap the config with `withSentryConfig`, so no
 * Sentry initialization runs today. This is therefore defence in depth placed
 * ahead of the wiring, not a fix to live behaviour — whoever turns Sentry on
 * gets the scrubbing already attached instead of having to know to add it.
 *
 * Pure: no I/O, no framework, no Sentry import. It operates on the plain event
 * shape so it can be unit-tested without the SDK.
 */
import { isPrivateRequestPath, pathnameOf } from "@/lib/analytics/private-surfaces";

/**
 * The minimum of Sentry's event shape this touches. Deliberately structural
 * rather than imported: this module must not depend on the SDK to be testable,
 * and every field below is one Sentry has carried for many major versions.
 */
export type ScrubbableEvent = {
  request?: {
    url?: unknown;
    method?: unknown;
    data?: unknown;
    headers?: unknown;
    cookies?: unknown;
    query_string?: unknown;
    [key: string]: unknown;
  };
  breadcrumbs?: Array<{
    category?: unknown;
    data?: unknown;
    [key: string]: unknown;
  }>;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Replaces a removed value, so the absence is visible rather than ambiguous. */
export const REDACTED = "[redacted:ot-private]";

/**
 * True when this event describes a request whose URL, headers or body must not
 * be captured. Reads the URL out of the request context only — never a tag or a
 * breadcrumb, which a caller could set to anything.
 */
export function isPrivateEvent(event: object): boolean {
  const request = (event as ScrubbableEvent).request;
  return isPrivateRequestPath(pathnameOf(request?.url));
}

/**
 * Strip request data that must never leave this process.
 *
 * Returns the same event object, mutated. Sentry's `beforeSend` contract allows
 * mutation and the event is not shared, so copying it would only risk missing a
 * nested field that a later SDK version adds.
 */
export function scrubSensitiveEvent<T extends object>(event: T): T {
  // Structurally typed rather than imported from the SDK, so this module stays
  // testable without it. The cast is the one place the two shapes meet.
  const view = event as ScrubbableEvent;
  const request = view.request;
  if (request) {
    // Unconditional: a body is never worth its risk on any route here, and an
    // allowlist would silently stop covering the next route somebody adds.
    if ("data" in request) request.data = REDACTED;

    if (isPrivateEvent(view)) {
      // A capability can only reach a URL through a bug, and this is exactly
      // the moment such a bug would be exfiltrated rather than merely logged.
      // The path survives so the event is still attributable to a route.
      request.url = pathnameOf(request.url) || REDACTED;
      if ("query_string" in request) request.query_string = REDACTED;
      if ("headers" in request) request.headers = REDACTED;
      if ("cookies" in request) request.cookies = REDACTED;
    }
  }

  // Breadcrumbs carry `fetch`/`xhr` records with their own URLs and, for some
  // integrations, request bodies. Any breadcrumb naming a private path loses
  // its data payload rather than being inspected field by field.
  if (Array.isArray(view.breadcrumbs)) {
    for (const crumb of view.breadcrumbs) {
      const data = crumb?.data as { url?: unknown } | undefined;
      if (data && isPrivateRequestPath(pathnameOf(data.url)))
        crumb.data = { url: pathnameOf(data.url) || REDACTED };
    }
  }

  return event;
}

/**
 * The transaction-event form.
 *
 * A performance transaction has no exception attached but carries the same
 * request context, so it needs the same treatment. Separate export because
 * Sentry hands it to a different hook and a future divergence should be visible
 * at the call site rather than hidden behind one shared name.
 */
export function scrubSensitiveTransaction<T extends object>(event: T): T {
  return scrubSensitiveEvent(event);
}
