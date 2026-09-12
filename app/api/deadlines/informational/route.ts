import { NextResponse } from "next/server";
import { informationalSnapshotStore } from "@/lib/deadlines/informational-snapshot-store";
import { decodeInformationalSnapshot } from "@/lib/deadlines/informational-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  let snapshot = null;
  try {
    if (process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED === "true") {
      const store = await informationalSnapshotStore();
      const value = await store?.read(new Date());
      // Recheck after asynchronous storage access; never renew the source receipt.
      if (value && process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED === "true") {
        snapshot = decodeInformationalSnapshot(JSON.stringify(value), new Date());
      }
    }
  } catch { /* Source and configuration failures expose only unavailable data. */ }
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
