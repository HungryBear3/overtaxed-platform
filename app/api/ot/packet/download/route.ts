// POST /api/ot/packet/download
//
// The customer-facing access boundary for an immutable T2 evidence packet.
//
// Why POST, and why a body: the capability is the entire authorization, so it
// must never appear in a URL. A URL-borne value lands in the access log, the
// `Referer` of every outbound link on the page it decorates, browser history,
// and any proxy or CDN cache in between. A request body lands in none of those.
// The GET handler exists purely to make that refusal explicit and testable.
//
// Nothing on this path reads a session, an email, or any other ownership claim:
// `ot_order` is anonymous and its email is an unverified checkout field, so
// there is no ownership here that could be trusted. (The account-owned legacy
// invoice packet download is a different product and is unrelated.)
//
// Default-off: with OT_T2_PACKET_DOWNLOAD_ENABLED absent — which is every
// environment — this route is indistinguishable from one that does not exist.
//
// The implementation lives in lib/fulfillment-runtime/packet-download-handler.ts.
// This route binds it with NO arguments: fixed native defaults, nothing injected.
import { createPacketDownloadHandlers } from "@/lib/fulfillment-runtime/packet-download-handler"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const handlers = createPacketDownloadHandlers()

export const POST = handlers.POST
export const GET = handlers.GET
