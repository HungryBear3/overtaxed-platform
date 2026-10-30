import "server-only"
/**
 * Free-check route orchestration as a factory, so tests and the local driver
 * can inject adapter/store. POST accepts lookup input only and returns a
 * server-issued receipt; GET returns the stored result by server ID.
 */
import { parseBoundedJson, utf8ByteLength, FACTUAL_SCHEMA_VERSION, type LookupReceipt } from "@/lib/evidence/public-factual-contract"
import type { AnalysisStore } from "./analysis-store"
import { analyzeAcquisition, type AcquisitionRequest, type FactualAcquisitionAdapter } from "./factual-analysis"

import { resolveServerAddress } from "./address-resolution"
import { isSameOrigin, type FreeResultAccess } from "./free-result-access"
import { ACCESS_UNAVAILABLE, CROSS_ORIGIN, loadAuthorizedResult } from "./free-report-handler"

const LOOKUP_KEYS = new Set(["pin", "address", "city", "selectedPin", "mode", "unit", "crossStreet", "taxYear"])
const MAX_LOOKUP_BYTES = 2_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

/**
 * Production free-check route: the lookup POST issues a result-bound capability
 * cookie and GET discloses a stored result only to the browser holding it.
 * Lookup itself stays signup-free; only the result read is bound.
 */
export function createGuardedFreeCheckRoute(deps: { adapter: FactualAcquisitionAdapter; store: AnalysisStore; access: FreeResultAccess }) {
  const inner = createFreeCheckRoute(deps)
  return {
    async POST(req: Request): Promise<Response> {
      if (!isSameOrigin(req)) return CROSS_ORIGIN()
      if (!deps.access.configured) return ACCESS_UNAVAILABLE()
      const res = await inner.POST(req)
      if (res.status !== 200) return res
      const receipt = (await res.clone().json()) as LookupReceipt
      const cookie = deps.access.issueCookie(receipt)
      if (!cookie) return ACCESS_UNAVAILABLE()
      const headers = new Headers(res.headers)
      headers.set("set-cookie", cookie)
      headers.set("cache-control", "private, no-store")
      return new Response(res.body, { status: 200, headers })
    },
    async GET(req: Request): Promise<Response> {
      const id = new URL(req.url).searchParams.get("id") ?? ""
      const authorized = await loadAuthorizedResult(deps.store, deps.access, req, id)
      return authorized.ok ? json(authorized.result) : authorized.response
    },
  }
}

/** Unguarded factory kept for fixtures and suites that inject their own access; never mounted by app routes. */
export function createFreeCheckRoute(deps: { adapter: FactualAcquisitionAdapter; store: AnalysisStore }) {
  return {
    async POST(req: Request): Promise<Response> {
      const text = await req.text().catch(() => "")
      let body: unknown
      try {
        if (utf8ByteLength(text) > MAX_LOOKUP_BYTES) throw new Error("size")
        body = parseBoundedJson(text, 2)
      } catch {
        return json({ error: "Enter a 14-digit Cook County PIN or a street address.", code: "LOOKUP_INVALID" }, 400)
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        return json({ error: "Enter a 14-digit Cook County PIN or a street address.", code: "LOOKUP_INVALID" }, 400)
      const entries = Object.entries(body as Record<string, unknown>)
      // Clients submit lookup input only: never analysis bodies, results or IDs.
      if (entries.some(([k, v]) => !LOOKUP_KEYS.has(k) || (v !== undefined && typeof v !== "string") || String(v).length > 200))
        return json({ error: "Only a PIN or address may be submitted.", code: "CLIENT_BODY_REJECTED" }, 400)
      const input = body as Record<string, string | undefined>
      const rawPin = (input.pin ?? "").trim()
      const address = (input.address ?? "").trim().replace(/\s+/g, " ")
      const mode = input.mode ?? (rawPin ? "pin" : "address")
      const validPin = (v: string) => /^(?:\d{14}|\d{2}-\d{2}-\d{3}-\d{3}-\d{4})$/.test(v)
      // Exactly one identity channel. selectedPin is only address disambiguation,
      // never an alternate primary identity. Mixed bodies fail before acquisition.
      if ((mode !== "pin" && mode !== "address") ||
          (mode === "pin" && (!validPin(rawPin) || !!address || !!input.selectedPin || !!input.city || !!input.unit || !!input.crossStreet || !!input.taxYear)) ||
          (mode === "address" && (!!rawPin || address.length < 5 || (!!input.selectedPin && !validPin(input.selectedPin)) || (!!input.taxYear && !/^(?:19|20|21)\d{2}$/.test(input.taxYear)) || (!!input.unit && !/^[A-Za-z0-9-]{1,20}$/.test(input.unit)))))
        return json({ error: "Enter one PIN or address in its declared mode.", code: "LOOKUP_INVALID" }, 400)
      const request: AcquisitionRequest = mode === "pin" ? { pin: rawPin.replace(/-/g, "") } : {
        address, ...(input.city ? { city: input.city.trim() } : {}),
        ...(input.unit ? {unit:input.unit} : {}),
        ...(input.crossStreet ? {crossStreet:input.crossStreet.trim()} : {}),
        ...(input.taxYear ? {taxYear:input.taxYear} : {}),
        ...(input.selectedPin ? { selectedPin: input.selectedPin.replace(/-/g, "") } : {}),
      }
      if (!request.pin && (request.address ?? "").length < 5)
        return json({ error: "Enter either a 14-digit Cook County PIN or a street address (at least 5 characters).", code: "LOOKUP_INVALID" }, 400)
      let context: Extract<Awaited<ReturnType<typeof resolveServerAddress>>, {ok:true}>["context"] | undefined
      if (request.address) {
        if (!deps.adapter.addressSource) return json({code:"ACQUISITION_HOLD",hold:deps.adapter.id === "cook-county-unqualified" ? "ACQUISITION_UNSUPPORTED" : "ACQUISITION_REJECTED",error:"We are not able to retrieve a complete, consistent Cook County record set for this check yet, so no figures are shown. Look the property up on the Assessor's site.",assessorAddressSearchUrl:"https://www.cookcountyassessoril.gov/address-search"},503)
        const resolution=await resolveServerAddress(deps.adapter.addressSource,request)
        if (!resolution.ok) return json(resolution.body,resolution.status)
        context=resolution.context
      }
      const acquisition = await deps.adapter.acquire(context ? {pin:context.pin} : request).catch(() => ({ok:false as const,hold:"ACQUISITION_REJECTED" as const}))
      const expectedPin = context?.pin ?? request.pin
      // A well-formed selection is not identity proof: bind the returned parcel
      // before analysis can allocate a version or store a result.
      const mismatch = acquisition.ok && ((expectedPin !== undefined && acquisition.subject.pin.replace(/-/g, "") !== expectedPin) || (context !== undefined && (acquisition.subject.taxYear !== context.taxYear || acquisition.subject.township !== context.township)))
      const analysis = await analyzeAcquisition(deps.store, mismatch ? { ok: false, hold: "ACQUISITION_REJECTED" } : acquisition)
      if (!analysis.ok)
        return json(
          {
            error:
              "We are not able to retrieve a complete, consistent Cook County record set for this check yet, so no figures are shown. Look the property up on the Assessor's site.",
            code: "ACQUISITION_HOLD",
            hold: analysis.hold,
            assessorAddressSearchUrl: "https://www.cookcountyassessoril.gov/address-search",
          },
          503,
        )
      const r = analysis.result
      const receipt: LookupReceipt = { schema: FACTUAL_SCHEMA_VERSION, resultId: r.resultId, snapshotId: r.snapshotId, subject: { ...r.subject } }
      return json(receipt)
    },
    async GET(req: Request): Promise<Response> {
      const id = new URL(req.url).searchParams.get("id") ?? ""
      let result
      try { result = /^res_[a-z0-9]{24}$/.test(id) ? await deps.store.getResult(id) : undefined }
      catch { return json({error:"Stored result temporarily unavailable.",code:"STORAGE_UNAVAILABLE"},503) }
      if (!result) return json({ error: "Result not found.", code: "RESULT_NOT_FOUND" }, 404)
      return json(result)
    },
  }
}
