import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
const digest = (value: string) => createHash("sha256").update(value).digest();
const authorized = (request: Request) => {
  const configured = process.env.OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY;
  const supplied = request.headers.get("authorization");
  if (!configured || configured.length < 32 || !supplied?.startsWith("Bearer "))
    return false;
  return timingSafeEqual(digest(supplied.slice(7)), digest(configured));
};
const approvalPayload = (approval: ControlledCopyApproval) =>
  JSON.stringify([
    "ot-calendar-preview-approval-v1",
    approval.candidateId,
    approval.contentHash,
    approval.approvedStatus,
    approval.templateId,
    approval.templateVersion,
    approval.templateDefinitionHash,
    approval.approvedIntents,
    approval.approvedAt,
  ]);
const approvalAuthorized = (input: Partial<PreviewRequest>) => {
  const key = process.env.OT_OFFICIAL_CALENDAR_PREVIEW_APPROVAL_SECRET;
  const capability = process.env.OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY;
  if (!key || key.length < 32 || key === capability || !input.approval)
    return false;
  if (!/^[0-9a-f]{64}$/.test(input.approvalSignature ?? "")) return false;
  const expected = createHmac("sha256", key)
    .update(approvalPayload(input.approval))
    .digest();
  return timingSafeEqual(
    expected,
    Buffer.from(input.approvalSignature as string, "hex"),
  );
};
const readBounded = async (request: Request) => {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 50_000) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
};

type PreviewRequest = {
  townshipLabel: string;
  expectedSha256: string;
  approval: ControlledCopyApproval;
  approvalSignature: string;
  templateId: "official_dates_v1";
};

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview")
    return reply(blocked("not_found"), 404);
  if (process.env.OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED !== "true")
    return reply(blocked("not_found"), 404);
  if (!authorized(request)) return reply(blocked("unauthorized"), 401);

  try {
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 50_000)
      return reply(blocked("input_invalid"), 413);
    const raw = await readBounded(request);
    if (raw === null) return reply(blocked("input_invalid"), 413);
    const input = JSON.parse(raw) as Partial<PreviewRequest>;
    if (
      typeof input.townshipLabel !== "string" ||
      input.townshipLabel.length > 80 ||
      !/^[0-9a-f]{64}$/.test(input.expectedSha256 ?? "") ||
      !input.approval ||
      input.templateId !== "official_dates_v1"
    )
      return reply(blocked("input_invalid"), 422);
    if (!approvalAuthorized(input))
      return reply(blocked("approval_invalid"), 403);

    const readStartedAt = new Date();
    const store = await informationalSnapshotStore();
    const snapshot = await store?.read(readStartedAt);
    if (
      process.env.VERCEL_ENV !== "preview" ||
      process.env.OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED !== "true" ||
      !authorized(request)
    )
      return reply(blocked("not_found"), 404);
    if (!approvalAuthorized(input))
      return reply(blocked("approval_invalid"), 403);
    if (!snapshot) return reply(blocked("source_unavailable"), 503);
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
      return reply(
        blocked(built.rejections[0]?.reason ?? "source_unavailable"),
        422,
      );

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
