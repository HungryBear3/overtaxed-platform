import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Lock } from "lucide-react";

import {
  loadOtDeadlineApprovalCards,
  getFixtureReferenceNow,
  type OtDeadlineDisplayRow,
} from "@/lib/social/ot-deadline-fixtures";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "OT Deadline Approval (read-only) | OverTaxed IL",
  description:
    "Internal read-only view of OT deadline social approval cards and their source-verification state. Not a posting tool.",
  robots: { index: false, follow: false },
};

const TONE_CLASSES: Record<OtDeadlineDisplayRow["badge"]["tone"], string> = {
  green: "bg-green-100 text-green-800 border-green-200",
  red: "bg-red-100 text-red-800 border-red-200",
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  gray: "bg-gray-100 text-gray-700 border-gray-200",
};

function CardRow({ row }: { row: OtDeadlineDisplayRow }) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-sm font-semibold text-gray-900">{row.content_id}</h2>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${TONE_CLASSES[row.badge.tone]}`}>
          {row.badge.label}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Platform scope</dt>
          <dd className="text-gray-900">{row.platform_scope.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Approved for (read-only)</dt>
          <dd className="text-gray-900">{row.approved_platforms.join(", ") || "none"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Public action status</dt>
          <dd className="text-gray-900">{row.public_action_status}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Expires at</dt>
          <dd className="text-gray-900">{row.expires_at ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-gray-500">Source</dt>
          <dd className="text-gray-900">
            {row.source_name ?? "—"}
            {row.source_url ? (
              <>
                {" · "}
                <a
                  href={row.source_url}
                  className="text-blue-700 underline"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  official calendar
                </a>
              </>
            ) : null}
            {row.source_checked_at ? <span className="text-gray-500"> · checked {row.source_checked_at}</span> : null}
          </dd>
        </div>
      </dl>

      {row.verified_deadlines.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Verified deadlines</p>
          <ul className="mt-1 space-y-1 text-sm text-gray-800">
            {row.verified_deadlines.map((d) => (
              <li key={`${d.township}-${d.deadline_date}`}>
                {d.township} — {d.deadline_date} <span className="text-gray-500">({d.status})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.closed_townships_mentioned.length > 0 && (
        <p className="mt-3 text-sm text-gray-600">
          <span className="font-semibold">Closed (must not appear as open):</span>{" "}
          {row.closed_townships_mentioned.join(", ")}
        </p>
      )}

      {row.reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
          {row.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      )}

      <p className="mt-4 flex items-center gap-1 text-xs text-gray-400">
        <Lock className="h-3.5 w-3.5" />
        post_allowed: false · this screen cannot post, boost, or schedule anything.
      </p>
    </article>
  );
}

export default function OtDeadlineApprovalPage() {
  const referenceNow = getFixtureReferenceNow();
  const loaded = loadOtDeadlineApprovalCards(referenceNow);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin" className="mb-6 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold text-gray-900">
        <ShieldCheck className="h-6 w-6" />
        OT Deadline Approval — read-only
      </h1>
      <p className="mb-6 text-gray-600">
        Internal review of OT deadline social cards and their source-verification state. Illustrative demo fixtures,
        pinned to {referenceNow.toISOString().slice(0, 10)}. This surface displays state only — there is no posting,
        boosting, Buffer, or Meta action anywhere on it.
      </p>

      <div className="space-y-4">
        {loaded.map(({ row }) => (
          <CardRow key={row.content_id} row={row} />
        ))}
      </div>
    </div>
  );
}
