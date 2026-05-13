/**
 * /api/check — free assessment check.
 *
 * Pass 1 PREVIEW STUB. Real CCAO + Board-of-Review wiring lands later.
 * - Accepts { address?, pin?, mode? }.
 * - Logs the request (without echoing back anything beyond SAMPLE_RESULT).
 * - Returns a clearly labeled sample result shape used by HeroCheckCard.
 * - No real backend, no CRM write, no payment.
 */
import { NextResponse } from "next/server";

const SAMPLE_RESULT = {
  address: "Sample result — not your submitted address",
  township: "Jefferson",
  windowStatus: "closed" as const,
  windowCloses: "Jefferson Township is closed until the 2028 cycle",
  windowDaysRemaining: 0,
  yourAssessed: 38420,
  compsAvg: 31180,
  equityRatio: 12.3,
  overpayPerYear: 1240,
  overpay3Year: 3720,
  comps: 3,
};

export async function POST(req: Request) {
  let body: { address?: string; pin?: string; mode?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* tolerate empty body in preview */
  }
  // eslint-disable-next-line no-console
  console.log("[api/check][preview] payload:", {
    addressLen: (body.address || "").length,
    pinLen: (body.pin || "").length,
    mode: body.mode || "address",
  });
  return NextResponse.json({ ok: true, preview: true, result: SAMPLE_RESULT });
}
