// POST /api/contingency-intake — WITHDRAWN.
//
// The 22% contingency service is a held product. This endpoint fails closed
// before parsing a request body, constructing Resend, or writing a lead, so no
// contingency intake can be captured or confirmed while the hold stands.
import { NextRequest } from "next/server";

import { heldProductResponse } from "@/lib/products/held-response";

export async function POST(_req: NextRequest) {
  return heldProductResponse("CONTINGENCY", "api/contingency-intake");
}
