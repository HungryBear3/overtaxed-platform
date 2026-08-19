// POST /api/drip/send — WITHDRAWN.
//
// The marketing drip sequence is a held product. Its message bodies also
// carried averaged-savings and "we handle filing" claims that are banned by the
// canonical lexicon, so the templates are removed rather than left dormant
// where a future caller could resurrect them. Nothing is queued, read, or sent.
import { NextRequest } from "next/server"

import { heldProductResponse } from "@/lib/products/held-response"

export async function POST(_request: NextRequest) {
  return heldProductResponse("MARKETING_DRIP", "api/drip/send", {
    sent: 0,
    failed: 0,
    total: 0,
  })
}
