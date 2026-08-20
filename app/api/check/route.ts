/**
 * `/api/check` — retired preview stub, kept reachable and non-actionable.
 *
 * This route used to answer every request with a fixed `SAMPLE_RESULT`:
 * `windowStatus: "open"`, `windowCloses: "Cicero Township appeal window open
 * through Jul 31, 2026"`, `windowDaysRemaining: 17`, `assessmentLevel: 12.1`,
 * `overpayPerYear: 1420`, `overpay3Year: 4260`. That is a hard-coded open
 * window, a filing date, a countdown, and an annual overpayment figure, served
 * unauthenticated, with no canonical state behind any of it — the exact
 * combination the rest of this work exists to suppress. It was authority by
 * accident: nothing on the site renders it today, but the home page's result
 * normalizer still reads those field names, so repointing one `fetch` would
 * have put the whole payload back on screen.
 *
 * The route is neutered rather than deleted. The frozen contract does not
 * authorize removing a route, and a 404 would silently change the shape of an
 * endpoint an external caller may still hit. It now answers with an explicit
 * refusal: no status, no date, no countdown, no figure, no merits
 * characterization, and `actionable: false`.
 *
 * The real check is `/api/free-check`, which resolves the four-state contract
 * against the canonical evaluated state.
 */
import { NextResponse } from "next/server"

import { CC_02 } from "@/lib/copy/canonical"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  let body: { address?: string; pin?: string; mode?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* tolerate empty body */
  }

  // Lengths only. The address and PIN are not echoed, logged, or retained.
  // eslint-disable-next-line no-console
  console.log("[api/check][retired] payload:", {
    addressLen: (body.address || "").length,
    pinLen: (body.pin || "").length,
    mode: body.mode || "address",
  })

  return NextResponse.json({
    ok: true,
    preview: true,
    actionable: false,
    reason: "preview_sample_withdrawn",
    result: null,
    disclosure: CC_02,
    message:
      "This preview endpoint no longer returns a sample result. Use /api/free-check.",
  })
}
