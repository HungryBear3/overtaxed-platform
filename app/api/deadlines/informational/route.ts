import { NextResponse } from "next/server";
import { readInformationalSnapshot } from "@/lib/deadlines/read-informational-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  // Same read the township detail route renders from; failures are null.
  const snapshot = await readInformationalSnapshot(new Date());
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
