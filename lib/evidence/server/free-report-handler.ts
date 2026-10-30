import "server-only"
/**
 * Free factual PDF for the result this browser was issued. No money: no order,
 * payment or delivery is touched. Reads only the persisted server result via
 * produceFactualPreviewPdf; the only accepted input is the result ID.
 */
import type { AnalysisStore } from "./analysis-store"
import { produceFactualPreviewPdf } from "./factual-document"
import { isSameOrigin, type FreeResultAccess } from "./free-result-access"

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } })

export const RESULT_REFUSED = () => json({ error: "Result not found.", code: "RESULT_NOT_FOUND" }, 404)
export const ACCESS_UNAVAILABLE = () => json({ error: "Stored results are temporarily unavailable.", code: "ACCESS_UNAVAILABLE" }, 503)
export const STORAGE_UNAVAILABLE = () => json({ error: "Stored result temporarily unavailable.", code: "STORAGE_UNAVAILABLE" }, 503)
export const RENDER_UNAVAILABLE = () => json({ error: "This stored result could not be rendered as a PDF.", code: "RENDER_UNAVAILABLE" }, 500)
export const CROSS_ORIGIN = () => json({ error: "Request refused.", code: "CROSS_ORIGIN_REJECTED" }, 403)

const FREE_PRESENTATION = {
  title: "OverTaxed IL - Free Factual Record",
  heading: { synthetic: "SYNTHETIC PREVIEW  |  FREE FACTUAL RECORD", county: "OVERTAXED IL  |  FREE FACTUAL RECORD" },
  disclaimer: "Raw records only. Unvalidated. Not legal or tax advice. Filing window UNKNOWN.",
}

/**
 * Resolves the persisted result for `id` only when this request carries the
 * capability issued for it. Every non-authorised outcome is the same refusal,
 * and storage is consulted only after the signature has verified.
 */
export async function loadAuthorizedResult(store: AnalysisStore, access: FreeResultAccess, req: Request, id: string) {
  if (!access.configured) return { ok: false as const, response: ACCESS_UNAVAILABLE() }
  const binding = /^res_[a-z0-9]{24}$/.test(id) ? access.readBinding(req, id) : null
  if (!binding) return { ok: false as const, response: RESULT_REFUSED() }
  let result
  try { result = await store.getResult(id) } catch { return { ok: false as const, response: STORAGE_UNAVAILABLE() } }
  if (!result || !access.matches(binding, result)) return { ok: false as const, response: RESULT_REFUSED() }
  return { ok: true as const, result }
}

export function createFreeReportRoute(deps: { store: AnalysisStore; access: FreeResultAccess; now?: () => string }) {
  return {
    async GET(req: Request): Promise<Response> {
      if (!isSameOrigin(req)) return CROSS_ORIGIN()
      const params = new URL(req.url).searchParams
      if ([...params.keys()].some((k) => k !== "id") || params.getAll("id").length > 1)
        return json({ error: "Only a result ID may be submitted.", code: "CLIENT_BODY_REJECTED" }, 400)
      const id = params.get("id") ?? ""
      const authorized = await loadAuthorizedResult(deps.store, deps.access, req, id)
      if (!authorized.ok) return authorized.response
      let pdf
      try {
        // Render the exact persisted value whose capability was checked above.
        // A second backend read must not substitute another snapshot after access.
        const pinnedStore: AnalysisStore = { ...deps.store, getResult: async (requestedId) => requestedId === id ? authorized.result : undefined }
        pdf = await produceFactualPreviewPdf(pinnedStore, id, { generatedAt: deps.now?.() ?? new Date().toISOString(), presentation: FREE_PRESENTATION, detail: "bounded" })
      } catch {
        // The authorized result is already loaded and pinned; no storage call
        // occurs in this block. Do not mislabel rendering failure as an outage.
        return RENDER_UNAVAILABLE()
      }
      if (pdf.resultId !== authorized.result.resultId) return RESULT_REFUSED()
      return new Response(new Uint8Array(pdf.bytes), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="overtaxed-factual-record-${pdf.resultId}.pdf"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      })
    },
  }
}
