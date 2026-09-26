import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { informationalSnapshotStore } from "@/lib/deadlines/informational-snapshot-store";
import { buildOfficialCalendarCandidates } from "@/lib/social/official-calendar-candidates";
import {
  renderOfficialCalendarCopy,
  type ControlledCopyApproval,
} from "@/lib/social/official-calendar-controlled-copy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };
const blocked = (reason: string) => ({
  verdict: "blocked" as const,
  reason,
  renderedText: null,
  binding: null,
  reviewOnly: true as const,
  postAllowed: false as const,
});
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: HEADERS });
const digest = (value: string) =>
  createHash("sha256").update(value).digest();
const authorized = (request: Request) => {
  const configured = process.env.OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY;
  const supplied = request.headers.get("authorization");
  if (!configured || configured.length < 32 || !supplied?.startsWith("Bearer "))
    return false;
  return timingSafeEqual(digest(supplied.slice(7)), digest(configured));
};

type PreviewRequest = {
  townshipLabel: string;
  expectedSha256: string;
  approval: ControlledCopyApproval;
  templateId: "official_dates_v1";
};

export async function POST(request: Request) {
  // A preview flag can never expose this route in Production.
  if (process.env.VERCEL_ENV !== "preview") return reply(blocked("not_found"), 404);
  if (process.env.OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED !== "true")
    return reply(blocked("not_found"), 404);
  if (!authorized(request)) return reply(blocked("unauthorized"), 401);

  try {
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 50_000)
      return reply(blocked("input_invalid"), 413);
    const raw = await request.text();
    if (raw.length > 50_000) return reply(blocked("input_invalid"), 413);
    const input = JSON.parse(raw) as Partial<PreviewRequest>;
    if (
      typeof input.townshipLabel !== "string" ||
      input.townshipLabel.length > 80 ||
      !/^[0-9a-f]{64}$/.test(input.expectedSha256 ?? "") ||
      !input.approval ||
      input.templateId !== "official_dates_v1"
    )
      return reply(blocked("input_invalid"), 422);

    const readStartedAt = new Date();
    const store = await informationalSnapshotStore();
    const snapshot = await store?.read(readStartedAt);
    // Recheck the environment after storage I/O; late reconfiguration cannot
    // turn a started Preview request into a Production response.
    if (
      process.env.VERCEL_ENV !== "preview" ||
      process.env.OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED !== "true"
    )
      return reply(blocked("not_found"), 404);
    if (!snapshot) return reply(blocked("source_unavailable"), 503);
    // Authority is evaluated after asynchronous storage/barrier work, so an
    // approval cannot survive a midnight or window boundary crossed in I/O.
    const draftedAt = new Date().toISOString();
    const built = buildOfficialCalendarCandidates({
      snapshot,
      evaluatedAt: draftedAt,
      townshipLabels: [input.townshipLabel],
      stages: ["assessor"],
      expectedSha256: { assessor: input.expectedSha256 },
    });
    const candidate = built.candidates[0];
    if (!candidate)
      return reply(blocked(built.rejections[0]?.reason ?? "source_unavailable"), 422);

    return reply(
      renderOfficialCalendarCopy({
        snapshot,
        candidate,
        draftedAt,
        approval: input.approval,
        templateId: input.templateId,
      }),
    );
  } catch {
    return reply(blocked("input_invalid"), 422);
  }
}
