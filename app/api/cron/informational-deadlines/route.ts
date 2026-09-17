import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectInformationalSnapshot, sourceBodyForSnapshot } from "@/lib/deadlines/collect-informational-snapshot";
import { parseInformationalAssessorHtml } from "@/lib/deadlines/assessor-calendar-parser";
import { informationalSnapshotStore } from "@/lib/deadlines/informational-snapshot-store";
import { commerceSnapshotStore } from "@/lib/deadlines/commerce-snapshot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const enabled = () => process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED === "true";
const commerceEnabled = () => process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED === "true";
const reply = (status: string, code = 200) => NextResponse.json({ status }, { status: code, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || /\s/.test(secret)) return reply("unauthorized", 401);
  const auth = request.headers.get("authorization") ?? "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(auth), hash(`Bearer ${secret}`))) return reply("unauthorized", 401);
  if (!enabled()) return reply("disabled");
  try {
    const store = await informationalSnapshotStore();
    if (!store || !enabled()) return reply("unavailable", 503);
    const attempt = await store.begin();
    if (!attempt || !enabled()) return reply("refused", 503);
    const snapshot = await collectInformationalSnapshot({ fetchSource: fetch, parseHtml: parseInformationalAssessorHtml, now: () => new Date() });
    if (!snapshot || !enabled()) return reply("refused", 503);
    // Commerce is the stricter authority. Publish it first so a public calendar
    // can never advance while checkout still relies on older evidence. An
    // identical retry is accepted by the commerce store as UNCHANGED, allowing
    // the informational side to reconcile after a partial failure.
    const commerce = await commerceSnapshotStore();
    const sourceBody = sourceBodyForSnapshot(snapshot);
    if (commerceEnabled() && (!commerce || !sourceBody)) return reply("refused", 503);
    const commerceResult = commerce && sourceBody
      ? await commerce.publish(snapshot, sourceBody, new Date())
      : null;
    if (commerceResult === "REFUSED") return reply("refused", 503);
    const result = await store.publish(JSON.stringify(snapshot));
    if (result === "REFUSED" || !enabled() || !await store.complete(attempt, JSON.stringify(snapshot))) {
      return reply(commerceResult === "PUBLISHED" ? "partial" : "refused", 503);
    }
    return enabled() ? reply(result.toLowerCase()) : reply("refused", 503);
  } catch { return reply("unavailable", 503); }
}
