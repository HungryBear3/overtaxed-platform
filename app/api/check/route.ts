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
  township: "Cicero",
  windowStatus: "open" as const,
  windowCloses: "Cicero Township appeal window open through Jul 31, 2026",
  windowDaysRemaining: 17,
  yourAssessed: 42500,
  compsAvg: 35100,
  assessmentLevel: 12.1,
  overpayPerYear: 1420,
  overpay3Year: 4260,
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
