"use client"

import { useEffect, useRef, useState } from "react"
import { useSharedIntent } from "./SharedIntent"
import { adoptFactualCompletion } from "@/lib/analytics/factual-completion"
import {
  decodeFactualResultJson,
  LookupReceiptSchema,
  type FactualResult,
  type LookupReceipt,
} from "@/lib/evidence/public-factual-contract"
import { presentFactualResult } from "@/lib/evidence/evidence-presentation"

type Bound = { key: string; state: { kind: "ready"; result: FactualResult } | { kind: "refused" } }

function receiptKey(r: LookupReceipt | null): string {
  return r ? `${r.resultId}|${r.snapshotId}|${r.subject.pin}|${r.subject.township}|${r.subject.taxYear}` : "invalid"
}

/**
 * Fetches the server result for a lookup receipt and binds it at render time:
 * a result is shown only while it belongs to the receipt currently rendered,
 * so an earlier request can neither display as the new one nor paint over it.
 */
export function useBoundFactualResult(receipt: unknown) {
  const intent = useSharedIntent()
  const accepted = intent.accepts(receipt)
  const parsed = LookupReceiptSchema.safeParse(receipt)
  const current = parsed.success ? parsed.data : null
  // A reacquired identical receipt must not reuse an earlier GET or ready state.
  const version = intent.version(receipt)
  const key = `${receiptKey(current)}|${version}`
  const [bound, setBound] = useState<Bound | null>(null)
  useEffect(() => {
    if (!current || !accepted) return
    let live = true
    fetch(`/api/free-check?id=${encodeURIComponent(current.resultId)}`)
      .then(async (res) => {
        const decoded = res.ok ? decodeFactualResultJson(await res.text()) : null
        const v = decoded?.ok ? decoded.value : null
        const matches =
          v !== null &&
          v.resultId === current.resultId &&
          v.snapshotId === current.snapshotId &&
          v.subject.pin === current.subject.pin &&
          v.subject.township === current.subject.township &&
          v.subject.taxYear === current.subject.taxYear
        if (live && intent.accepts(receipt) && intent.version(receipt) === version) setBound({ key, state: matches ? { kind: "ready", result: v! } : { kind: "refused" } })
      })
      .catch(() => live && intent.accepts(receipt) && intent.version(receipt) === version && setBound({ key, state: { kind: "refused" } }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, accepted, intent])
  useEffect(() => {
    if (intent.accepts(receipt) && bound?.key === key && bound.state.kind === "ready") adoptFactualCompletion(receipt, bound.state.result)
  }, [bound, key, receipt])
  if (!accepted) return { kind: "loading" as const }
  if (!current) return { kind: "refused" as const }
  if (!bound || bound.key !== key) return { kind: "loading" as const }
  return bound.state
}

type SharedMetric = NonNullable<FactualResult["acquisitionSnapshot"]>["sharedMetric"]
const perSqft = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** Screen-only brief of the saved shared metric (never recomputed); the paid report carries the detail. */
export function SharedMetricBrief({ metric }: { metric: SharedMetric }) {
  const median = metric.comparableMedian
  return (
    <div data-testid="shared-metric-brief" className="text-sm space-y-1">
      <p>Your assessed value per building sq ft: {perSqft(metric.subjectAssessedCentsPerBuildingSqft)}</p>
      <p>{median.status === "COMPUTED" ? `Comparable median (${median.count} properties, you excluded): ${perSqft(median.value)}` : "Comparable median: unavailable"}</p>
      <p className="text-xs">Sample adequacy: {metric.sampleAdequacy === "NOT_QUALIFIED" ? "NOT QUALIFIED" : metric.sampleAdequacy}. Assessed values only, not market value or savings.</p>
    </div>
  )
}

export function SharedEvidenceSummary({ result }: { result: FactualResult }) {
  const p = presentFactualResult(result)
  return (
    <section style={{ contain: "inline-size", maxWidth: "min(100%, calc(100vw - 64px))" }} data-testid="factual-summary" data-result-id={p.identity.resultId} className="min-w-0 max-w-full space-y-4 break-words">
      <h3 className="font-semibold">{p.heading}</h3>
      <p className="text-sm">
        PIN {p.identity.pin} · {p.identity.township} · tax year {p.identity.taxYear}
      </p>
      <p>{p.findingText}</p>
      <p className="font-medium">{p.windowText}</p>
      {result.acquisitionSnapshot?.sharedMetric ? <SharedMetricBrief metric={result.acquisitionSnapshot.sharedMetric} /> : null}
      <div role="region" aria-label="Raw parcel records" tabIndex={0} className="max-w-full overflow-x-auto rounded border focus:outline-2">
      <table className="text-sm w-full min-w-[760px] text-left [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:whitespace-nowrap">
        <thead>
          <tr><th>PIN</th><th>Role</th><th>Assessed</th><th>Land</th><th>Building</th><th>Class</th><th>Date</th></tr>
        </thead>
        <tbody>
          {p.rows.map((r) => (
            <tr key={r.pin}>
              <td>{r.pin}</td><td>{r.role}</td><td>{r.assessed}</td><td>{r.land}</td><td>{r.building}</td><td>{r.propertyClass}</td><td>{r.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <ul className="text-xs">
        {p.limitations.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <ul className="text-xs">
        {p.sources.map((s) => (
          <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a></li>
        ))}
      </ul>
      <p className="text-xs">Result {p.identity.resultId} · snapshot {p.identity.snapshotId} v{p.identity.snapshotVersion}</p>
    </section>
  )
}

/** The single bound free result view used by /check and the homepage. */
export function BoundFactualResult({ receipt }: { receipt: unknown }) {
  const state = useBoundFactualResult(receipt)
  if (state.kind === "loading") return <p data-testid="factual-loading">Loading the stored record…</p>
  if (state.kind === "refused")
    return (
      <p data-testid="factual-refused">
        This result could not be verified against the record we issued, so nothing is shown. Look the property up on the{" "}
        <a href="https://www.cookcountyassessoril.gov/address-search">Assessor&apos;s site</a>.
      </p>
    )
  return (
    <>
      <SharedEvidenceSummary result={state.result} />
      <FreeReportAction resultId={state.result.resultId} />
    </>
  )
}

type ReportState = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string }

/**
 * No-money download of the same stored record as a PDF. The server renders it
 * from the persisted result this browser was issued; nothing here is sent but
 * the result ID.
 */
export function FreeReportAction({ resultId }: { resultId: string }) {
  const [state, setState] = useState<ReportState>({ kind: "idle" })
  const generation = useRef(0)
  const inFlight = useRef(false)
  useEffect(() => {
    generation.current++
    inFlight.current = false
    setState({ kind: "idle" })
    return () => { generation.current++; inFlight.current = false }
  }, [resultId])
  const download = async () => {
    if (inFlight.current) return
    inFlight.current = true
    const owner = generation.current
    const current = () => owner === generation.current
    setState({ kind: "busy" })
    try {
      const res = await fetch(`/api/free-check/report?id=${encodeURIComponent(resultId)}`, { credentials: "same-origin", cache: "no-store" })
      if (!current()) return
      if (!res.ok || res.headers.get("content-type") !== "application/pdf") throw new Error("refused")
      const blob = await res.blob()
      if (!current()) return
      const url = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }))
      try {
        const a = document.createElement("a")
        a.href = url
        a.download = `overtaxed-factual-record-${resultId}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
      } finally {
        URL.revokeObjectURL(url)
      }
      setState({ kind: "done" })
    } catch {
      if (current()) setState({ kind: "error", message: "The PDF could not be produced for this result. The record shown above is unchanged; try the check again." })
    } finally {
      if (current()) inFlight.current = false
    }
  }
  return (
    <div data-testid="factual-report-action" className="mt-4 space-y-2">
      <button type="button" onClick={download} disabled={state.kind === "busy"} aria-busy={state.kind === "busy"} className="rounded border px-3 py-2 text-sm font-medium">
        Download factual record (PDF)
      </button>
      <p data-testid="factual-report-status" role={state.kind === "error" ? "alert" : "status"} className="text-xs">
        {state.kind === "busy" ? "Preparing the PDF from the stored record…" : state.kind === "done" ? "PDF download started. Check your browser downloads. Summary plus detail for the subject and at most 100 cohort parcels; all records remain shown above." : state.kind === "error" ? state.message : "Free. Summary plus detail for the subject and at most 100 cohort parcels; all records remain shown above. Filing window UNKNOWN."}
      </p>
    </div>
  )
}
