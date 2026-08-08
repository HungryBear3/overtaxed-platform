import Link from "next/link"
import type {
  AdminEvidenceView,
  ActionView,
  Tone,
  Warning,
} from "@/lib/fulfillment/admin-read-model"

const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700 border-gray-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  progress: "bg-indigo-50 text-indigo-700 border-indigo-200",
  success: "bg-green-50 text-green-700 border-green-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-700 border-red-200",
}

const WARN_ROW: Record<Warning["severity"], string> = {
  info: "border-sky-200 bg-sky-50 text-sky-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
}

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words font-mono text-sm text-gray-900">{value ?? "—"}</dd>
    </div>
  )
}

function ActionButton({ action }: { action: ActionView }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={action.reason}
      className="inline-flex min-h-11 min-w-11 cursor-not-allowed items-center justify-center rounded-md border border-gray-300 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-400"
    >
      {action.label}
    </button>
  )
}

export function EvidenceConsolePanel({ view }: { view: AdminEvidenceView }) {
  const { summary, lease, artifact, attempts, timeline, warnings, actions } = view
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/admin/orders" className="text-sm text-gray-500 hover:text-gray-900">
          ← Orders
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-base font-semibold text-gray-900">Fulfillment evidence</h1>
      </div>

      <p className="mb-4 break-all font-mono text-xs text-gray-500">order {view.orderId}</p>

      {/* Summary */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${TONE_BADGE[summary.tone]}`}>
            {summary.label}
          </span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">{summary.kind}</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Recorded" value={summary.recordedStatus} />
          <Field label="Revision" value={summary.statusRevision} />
          <Field label="Attempts" value={summary.attemptCount} />
          <Field label="Derived" value={view.derivedDeliveryStatus} />
        </dl>
      </section>

      {/* Warnings */}
      {warnings.length > 0 && (
        <section className="mb-6" aria-label="Warnings">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Warnings</h2>
          <ul className="space-y-2">
            {warnings.map((w) => (
              <li key={w.code} className={`rounded-md border px-3 py-2 text-sm ${WARN_ROW[w.severity]}`}>
                <span className="font-mono text-xs font-semibold">{w.code}</span>
                <span className="ml-2">{w.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Lease */}
      {lease.state !== "NONE" && (
        <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Worker lease</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="State" value={lease.state} />
            <Field label="Owner" value={lease.ownerMasked} />
            <Field label="Expires" value={lease.expiresAt} />
          </dl>
        </section>
      )}

      {/* Artifact provenance */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Artifact provenance</h2>
        {artifact.present ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Version" value={artifact.version} />
            <Field label="Bytes" value={artifact.byteSize} />
            <Field label="Generator" value={artifact.generatorVersion} />
            <Field label="Template" value={artifact.templateVersion} />
            <Field label="Created" value={artifact.createdAt} />
            <div className="col-span-2 min-w-0 sm:col-span-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">SHA-256 (content address)</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-gray-900">{artifact.sha256}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-500">No artifact recorded.</p>
        )}
      </section>

      {/* Delivery attempts */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Delivery attempts</h2>
        {attempts.length === 0 ? (
          <p className="text-sm text-gray-500">No delivery attempts.</p>
        ) : (
          <ul className="space-y-3">
            {attempts.map((a) => (
              <li key={a.attemptNumber} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">Attempt {a.attemptNumber}</span>
                  <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600">{a.outcome}</span>
                  <span className="text-xs text-gray-400">via {a.provider}</span>
                </div>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Artifact v" value={a.artifactVersion} />
                  <Field label="Message id" value={a.providerMessageIdMasked} />
                  <Field label="Accepted" value={a.acceptedAt} />
                  <Field label="Delivered" value={a.deliveredAt} />
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Evidence trail */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Evidence trail</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-gray-500">No provider events.</p>
        ) : (
          <ol className="space-y-2 border-l border-gray-200 pl-4">
            {timeline.map((t) => (
              <li key={`${t.sequence}-${t.eventRefMasked}`} className="relative">
                <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-gray-300" aria-hidden />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-xs text-gray-400">#{t.sequence}</span>
                  <span className="text-sm font-medium text-gray-900">{t.eventType}</span>
                  <span className="font-mono text-xs text-gray-500">{t.occurredAt ?? "—"}</span>
                  {t.reasonCode && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{t.reasonCode}</span>}
                  <span className="text-xs text-gray-400">attempt {t.attemptNumber}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Actions — display-only, inert in this phase */}
      <section aria-label="Actions">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Actions</h2>
        <p className="mb-3 text-xs text-gray-500">
          Read-only in this phase. Every control is disabled; no retry, regeneration, send, lease, or mutation occurs here.
        </p>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <ActionButton key={a.action} action={a} />
          ))}
        </div>
        <ul className="mt-3 space-y-1">
          {actions
            .filter((a) => a.action !== "INSPECT")
            .map((a) => (
              <li key={a.action} className="text-xs text-gray-500">
                <span className="font-mono">{a.action}</span>: {a.wouldBeEligible ? "eligible" : "not eligible"} — {a.reason}
              </li>
            ))}
        </ul>
      </section>
    </div>
  )
}

export function EvidenceDisabledPanel() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Fulfillment evidence is disabled</h1>
        <p className="mx-auto mt-3 max-w-prose text-sm text-gray-600">
          The <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">OT_T2_EVIDENCE_CONSOLE_ENABLED</code> flag is off. This
          surface reads no fulfillment evidence and exposes no retry, regeneration, send, lease, provider, or mutation action while disabled.
        </p>
        <div className="mt-6">
          <Link href="/admin/orders" className="text-sm text-gray-500 hover:text-gray-900">
            ← Back to orders
          </Link>
        </div>
      </div>
    </div>
  )
}
