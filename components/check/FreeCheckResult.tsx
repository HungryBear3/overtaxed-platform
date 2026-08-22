"use client"

import { useState } from "react"
import Link from "next/link"

import { CC_02, CC_05, CC_12 } from "@/lib/copy/canonical"
import {
  isCanonicalFreeCheckOutcome,
  type FreeCheckOutcome as SharedResultOutcome,
} from "@/lib/free-check-outcome-contract"

/** The canonical Assessor calendar host. See the controller ruling of 2026-08-19. */
const ASSESSOR_SITE_URL = "https://www.cookcountyassessoril.gov"

export type CompDetail = {
  pin: string
  address: string
  city: string
  assessedValue: number
  marketValue: number | null
  squareFeet: number | null
  yearBuilt: number | null
  propertyClass: string | null
}

export type AppealWindowStatus = {
  township: string
  status: "open" | "closed" | "upcoming" | "unknown"
  openDate: string | null
  closeDate: string | null
  filingUrl: string
  note: string | null
  pendingReason?: string | null
  allowCheckout?: boolean
  showDates?: boolean
  showCountdown?: boolean
  allowDeadlineCta?: boolean
  allowReminderSignup?: boolean
}

export type PropertyCharacteristics = {
  squareFeet: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  propertyClass: string | null
  exterior: string | null
  basement: string | null
  garage: string | null
  note: string
}

export type Result = {
  subject: {
    pin: string
    address: string
    city: string
    zipCode: string
    township: string | null
    neighborhoodCode: string | null
    taxYear: number | null
    assessedTotalValue: number | null
    marketValue: number | null
  }
  compCount: number
  comps: CompDetail[]
  avgComparableAssessedValue: number | null
  equityRatio: number | null
  targetEquityRatio: number
  avgCompEquityRatio: number | null
  assessmentGap: number | null
  /**
   * Always null. Retained so a stale cached response still type-checks; the
   * route no longer computes either figure. See the free-check route.
   */
  potentialOverpaymentPerYear: number | null
  potentialOverpayment3Year: number | null
  appealArgumentText: string | null
  appealWindowStatus: AppealWindowStatus | null
  propertyCharacteristics: PropertyCharacteristics | null
  noAssessedValue?: boolean
  message?: string
  /**
   * How the route actually chose the comparables. Absent on a payload written
   * by an older build, in which case the surface says nothing about selection
   * rather than inventing a rule for it.
   */
  compSelection?: {
    basis?: string | null
    distanceRanked?: boolean | null
    label?: string | null
  } | null
  source: string
  /** CC-02, mandated verbatim above the result on every state. */
  disclosure?: string | null
  /** CC-07 limitations. */
  sourceCaveat?: string | null
  /** The route's single evaluated outcome — the four-state contract. */
  outcome?: ResultOutcome | null
}

/**
 * The four-state free-check result, decided by the route and never here.
 *
 * This component previously drew its own conclusion from a hard-coded
 * `MEANINGFUL_SAVINGS_THRESHOLD = 100`: a dollar gap above it rendered
 * "Estimated savings" and a "Start Your Appeal" CTA, below it rendered
 * "fairly assessed". That is a merits characterization of the reader's
 * property from an unsigned threshold — exactly what OD-2/OD-3 have not
 * authorized — so the decision now arrives already made.
 */
export type ResultOutcome = SharedResultOutcome

/**
 * Runtime trust boundary for route responses and sessionStorage payloads.
 * TypeScript types do not protect JSON restored by a browser. Every outcome
 * capability must be present and consistent with one of the evaluator's exact
 * four-state variants before any figure or offer may render.
 */
export function isCanonicalResultOutcome(value: unknown): value is ResultOutcome {
  return isCanonicalFreeCheckOutcome(value)
}

interface Props {
  result: Result
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

export function FreeCheckResult({ result }: Props) {
  const [email, setEmail] = useState("")
  const [township, setTownship] = useState(
    result.subject.township?.replace(/\s*Township$/i, "").trim() || "Free Check"
  )
  const [saveStatus, setSaveStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [saveError, setSaveError] = useState("")
  const [showComps, setShowComps] = useState(false)
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle")

  // The response may still carry `disclosure`, but only so drift is
  // *detectable* — CC-02 is rendered from the canonical module below either
  // way. A payload that carries the field and disagrees with the frozen text
  // did not come from a build that agrees with the copy contract, so nothing
  // else it asserts is trusted either: its outcome is dropped and the result
  // resolves to CC-05 with no figures and no offer. Absent is not drift; the
  // previous build sent no disclosure at all, and that path is already covered
  // by the missing-outcome rule.
  const disclosureTrusted = result.disclosure == null || result.disclosure === CC_02

  // The route's single evaluated outcome. A response that carries none is one
  // we cannot draw a conclusion from, and the contract's resolution for an
  // absent policy is CC-05 with checkout closed — never an optimistic default.
  const outcome = disclosureTrusted && isCanonicalResultOutcome(result.outcome)
    ? result.outcome
    : null
  const headline = outcome?.headline ?? CC_05
  const showFigures = outcome?.showFigures ?? false
  // The assessed-value comparison. Separate from `showFigures` because a
  // missing market value withholds the assessment *level*, not the published
  // assessed values the level would have been computed against. This card used
  // to disappear entirely when the county carried no market value for the
  // subject or for any comparable, which is the common case for a recently
  // transferred parcel and for most of the equity comps.
  const showRecordComparison = outcome?.showRecordComparison ?? false
  const canOffer = outcome?.allowCheckout === true

  // The generated appeal argument, and only when the route released figures.
  //
  // This card used to render on the mere presence of `appealArgumentText`. The
  // string the previous build generated ends "...resulting in an estimated
  // overpayment of $1,420/year", so any payload still carrying one — a cached
  // response, a replayed body — put a savings claim on this page underneath a
  // CC-05 headline, with every paid CTA correctly hidden around it. Presence of
  // a field is not permission to render it; the outcome is.
  const appealArgumentText = showFigures ? result.appealArgumentText : null

  // Whether the public record shows the subject above the comparable average.
  // This is a description of two published numbers, not a conclusion about the
  // reader, and it is shown only when the route released the figures.
  const hasGap =
    showRecordComparison &&
    result.avgComparableAssessedValue != null &&
    (result.subject.assessedTotalValue ?? 0) > result.avgComparableAssessedValue

  async function handleSaveResults(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSaveStatus("loading")
    setSaveError("")
    try {
      const res = await fetch("/api/township-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Subscription intent only. The street address and the savings
        // projection were both sent here and neither is needed to record that
        // someone wants to hear when a township opens — one is a homeowner
        // identifier riding along on a mailing-list write, the other a figure
        // this product no longer produces.
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          township: township.trim() || "Free Check",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to save")
      setSaveStatus("success")
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Something went wrong")
      setSaveStatus("error")
    }
  }

  async function handleCopyArgument() {
    if (!appealArgumentText) return
    try {
      await navigator.clipboard.writeText(appealArgumentText)
      setCopyStatus("copied")
      setTimeout(() => setCopyStatus("idle"), 2000)
    } catch {
      // fallback: select all text in textarea
    }
  }

  const aw = result.appealWindowStatus
  // Capability flags come from the canonical render-time projection. Missing
  // flags (including an older sessionStorage payload) are denied rather than
  // inferred from a status string or from dates carried in the payload.
  const windowVerified = aw?.pendingReason === null && aw?.showDates === true
  const mayFile = windowVerified && aw?.allowDeadlineCta === true
  const mayTakeReminder = windowVerified && aw?.allowReminderSignup === true

  return (
    <div className="space-y-6">

      {/* ── Appeal Window Banner ────────────────────────────────────────── */}
      {aw && (
        <div className={`rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${
          aw.status === "open"
            ? "bg-green-50 border border-green-200"
            : aw.status === "closed"
            ? "bg-gray-50 border border-gray-200"
            : "bg-blue-50 border border-blue-200"
        }`}>
          {windowVerified && aw.status === "open" && (
            <>
              <div>
                <span className="inline-block bg-green-600 text-white text-xs font-bold px-2 py-0.5 rounded mr-2">OPEN NOW</span>
                <span className="text-sm font-semibold text-green-900">{aw.township} appeal window is open</span>
                {aw.showDates && aw.closeDate && (
                  <span className="text-sm text-green-800 ml-1">· Deadline: {formatDate(aw.closeDate)}</span>
                )}
              </div>
              {mayFile && (
                <a href={aw.filingUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-block bg-green-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap">
                  File your appeal now →
                </a>
              )}
            </>
          )}
          {windowVerified && aw.status === "closed" && (
            <div>
              <span className="text-sm font-semibold text-gray-700">{aw.township} appeal window is currently closed</span>
              {aw.showDates && aw.openDate && (
                <span className="text-sm text-gray-600 ml-1">· Opens around {formatDate(aw.openDate)}</span>
              )}
              <p className="text-xs text-gray-500 mt-0.5">Sign up below to be notified when your window opens.</p>
            </div>
          )}
          {windowVerified && aw.status === "upcoming" && (
            <div>
              <span className="text-sm font-semibold text-blue-900">{aw.township} filing window is not yet open</span>
              {aw.showDates && aw.openDate && (
                <span className="text-sm text-blue-800 ml-1">· Opens {formatDate(aw.openDate)}</span>
              )}
            </div>
          )}
          {!windowVerified && (
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-0.5">Appeal window dates not confirmed for <strong>{aw.township}</strong></p>
              <p className="text-sm text-blue-800">Cook County opens townships on a rolling schedule and we have not verified dates for this result. The Cook County Assessor publishes the official calendar.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Main Result Card ────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-2">Your free check result</h2>

        {/* Address + property metadata chips */}
        <p className="text-sm text-gray-600 mb-1">
          {result.subject.address}, {result.subject.city} IL {result.subject.zipCode}
          {result.subject.pin && (
            <span className="block text-gray-500 mt-0.5">PIN {result.subject.pin}</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2 mb-4 text-xs text-gray-500">
          {result.subject.township && (
            <span className="bg-gray-100 rounded px-2 py-0.5">Township: {result.subject.township}</span>
          )}
          {result.subject.neighborhoodCode && (
            <span className="bg-gray-100 rounded px-2 py-0.5">Neighborhood code: {result.subject.neighborhoodCode}</span>
          )}
          {result.subject.taxYear && (
            <span className="bg-gray-100 rounded px-2 py-0.5">Tax year: {result.subject.taxYear}</span>
          )}
        </div>

        {/* No assessed value state */}
        {result.noAssessedValue && (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-4 mb-6">
            <p className="text-sm font-semibold text-yellow-900 mb-1">Assessment not yet published</p>
            <p className="text-sm text-yellow-800">
              {result.message ?? "We found your property but the Cook County Assessor hasn't published an assessed value for this PIN yet. Visit cookcountyassessoril.gov to check your assessment status."}
            </p>
            <a href={`${ASSESSOR_SITE_URL}/address-search`} target="_blank" rel="noopener noreferrer"
              className="inline-block mt-3 text-sm font-semibold text-blue-700 hover:underline">
              Check your assessment at cookcountyassessoril.gov →
            </a>
          </div>
        )}

        {/* ── The result state ───────────────────────────────────────────────
            CC-02 sits immediately above the outcome on all four states, byte
            exact and in one element — never split across nodes, never
            summarized. The headline beneath it is CC-03…CC-06 as the route
            decided it. Nothing here recomputes or re-words either one.

            CC-02 is rendered from the canonical module, not from the response.
            It used to be `{result.disclosure && <p>{result.disclosure}</p>}`,
            which had two ways to fail open at once: a response that omitted the
            field rendered a result state with no disclosure above it at all —
            and every response written by the previous build omits it — while a
            response that carried a drifted or truncated string rendered that
            string verbatim. The wire copy is now checked, not trusted, and any
            mismatch is surfaced rather than shown. */}
        <p className="text-sm text-gray-600 mb-3" role="note">{CC_02}</p>
        <p className="text-2xl font-bold text-gray-900 mb-2">{headline}</p>
        {result.sourceCaveat && (
          <p className="text-sm text-gray-500 mb-6">{result.sourceCaveat}</p>
        )}

        {/* Value cards.
            Gated, not merely fed. These three read straight off `result` and
            rendered whatever the payload carried — safe only because the route
            blanks those fields itself when the comparison is withheld. This
            component is also fed from `sessionStorage`, where a stale or
            hand-edited entry can carry populated figures beside a withholding
            outcome, and the capability is the thing with standing to decide. */}
        {showRecordComparison && (
        <div className="flex flex-wrap gap-4 justify-center mb-4">
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex-1 min-w-[10rem] max-w-xs">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Your assessed value</p>
            <p className="text-xl font-bold text-gray-900">
              {result.subject.assessedTotalValue != null ? formatCurrency(result.subject.assessedTotalValue) : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 flex-1 min-w-[10rem] max-w-xs">
            {/* "nearby" was a distance claim and nothing computes a distance.
                `getComparableSales` matches the subject's CCAO neighbourhood
                code and building class and orders by sale date, widening to a
                three-year window and then to the whole township when the cohort
                is thin — a parcel from the far side of the township outranks the
                house next door if it sold more recently. The label now says what
                the selection is, and the count is the number that survived
                validation rather than a promised three. */}
            <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide mb-2">
              Avg of {result.compCount} comparable{result.compCount !== 1 ? "s" : ""} on record
            </p>
            <p className="text-xl font-bold text-blue-900">
              {result.avgComparableAssessedValue != null ? formatCurrency(result.avgComparableAssessedValue) : "—"}
            </p>
          </div>
          {/* The difference between two published assessed values. The card
              that stood here read "Est. overpayment ~$X/year": the same gap
              multiplied by a tax rate and an equalizer and relabelled as money
              the reader was losing. The subtraction is public record; the
              multiplication was a savings claim. */}
          <div className={`rounded-xl border p-4 flex-1 min-w-[10rem] max-w-xs ${hasGap ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}>
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Difference in assessed value</p>
            <p className={`text-xl font-bold ${hasGap ? "text-amber-800" : "text-gray-700"}`}>
              {hasGap && result.assessmentGap != null ? formatCurrency(result.assessmentGap) : "—"}
            </p>
          </div>
        </div>
        )}

        {/* ── Standing disclosure ────────────────────────────────────────────
            Three mutually exclusive verdicts stood here — "An appeal could
            lower your taxes — and a win in 2026 locks in savings through
            2029", "below our confidence threshold", and "Your property appears
            fairly assessed … unlikely to succeed". Each told the reader what
            their case was worth, from a threshold nobody signed, and the first
            asserted that a lower assessment produces an equally lower bill.
            The result state above is the only verdict this product renders;
            what belongs here is the standing limit on all of them. */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 mb-6">
          <p className="text-sm text-gray-700">{CC_12}</p>
          <a
            href={`${ASSESSOR_SITE_URL}/assessment-calendar-and-deadlines`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 text-sm font-semibold text-blue-700 hover:underline"
          >
            Confirm your filing deadline with the Cook County Assessor →
          </a>
        </div>
      </div>

      {/* ── Equity Analysis ─────────────────────────────────────────────── */}
      {/* Gated on the assessed-value comparison, not on the assessment level.
          The two rows that need a market value carry their own null checks
          below, so a subject the county has no market value for still gets the
          assessed-value rows it does have. */}
      {showRecordComparison && !result.noAssessedValue && result.subject.assessedTotalValue != null && result.avgComparableAssessedValue != null && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-gray-900 mb-1">Equity analysis</h3>
          <p className="text-sm text-gray-500 mb-4">
            Cook County&apos;s target assessment ratio is <strong>10% of market value</strong>.
            This is the county's published uniformity target, not a prediction about any individual appeal.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                  <th className="text-left pb-2 pr-4 font-semibold"></th>
                  <th className="text-right pb-2 pr-4 font-semibold">Your Property</th>
                  <th className="text-right pb-2 font-semibold">Comparable avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                <tr>
                  <td className="py-2 pr-4 text-gray-600">Assessed value</td>
                  <td className="py-2 pr-4 text-right font-medium text-gray-900">
                    {formatCurrency(result.subject.assessedTotalValue)}
                  </td>
                  <td className="py-2 text-right font-medium text-gray-700">
                    {formatCurrency(result.avgComparableAssessedValue)}
                  </td>
                </tr>
                {result.subject.marketValue != null && (
                  <tr>
                    <td className="py-2 pr-4 text-gray-600">Market value</td>
                    <td className="py-2 pr-4 text-right font-medium text-gray-900">
                      {formatCurrency(result.subject.marketValue)}
                    </td>
                    <td className="py-2 text-right font-medium text-gray-700">—</td>
                  </tr>
                )}
                {result.equityRatio != null && (
                  <tr>
                    <td className="py-2 pr-4 text-gray-600">Equity ratio</td>
                    <td className="py-2 pr-4 text-right font-medium">
                      {/* The ratio is a published figure and stays. The
                          "Over-assessed" / "Borderline" / "Fairly assessed"
                          badges that sat beside it, and the red/amber/green
                          they were rendered in, were a three-grade verdict on
                          the reader's property — an ordinal rendering of the
                          result states, which the contract forbids alongside
                          the four canonical ones. */}
                      <span className="inline-flex items-center gap-1 font-bold text-gray-900">
                        {result.equityRatio.toFixed(1)}%
                      </span>
                    </td>
                    {/* An em dash, not "10.0% (target)". The county's statutory
                        target is a policy number; printing it in the column
                        headed with the comparables reported it as what the
                        comparables measured, for a subject where no comparable
                        carried a market value at all. The target is stated in
                        the caption above, where it belongs. */}
                    <td className="py-2 text-right font-medium text-gray-700">
                      {result.avgCompEquityRatio != null ? `${result.avgCompEquityRatio.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                )}
                {result.assessmentGap != null && result.assessmentGap > 0 && (
                  <tr>
                    <td className="py-2 pr-4 text-gray-600">Assessment gap</td>
                    <td className="py-2 pr-4 text-right font-bold text-amber-800" colSpan={2}>
                      +{formatCurrency(result.assessmentGap)} above the comparable average
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Comparable Properties ────────────────────────────────────────── */}
      {showRecordComparison && result.comps && result.comps.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <button
            onClick={() => setShowComps(!showComps)}
            className="w-full flex items-center justify-between text-left"
          >
            <h3 className="text-base font-bold text-gray-900">
              Comparable properties ({result.comps.length})
            </h3>
            <span className="text-sm text-blue-600 font-semibold">{showComps ? "Hide ↑" : "Show ↓"}</span>
          </button>
          <p className="text-sm text-gray-500 mt-1">
            {result.compSelection?.label ??
              "These are the comparable properties used in the comparison above."}
          </p>

          {showComps && (
            <div className="mt-4 space-y-3">
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                      <th className="text-left pb-2 pr-3 font-semibold">PIN</th>
                      <th className="text-left pb-2 pr-3 font-semibold">Address</th>
                      <th className="text-right pb-2 pr-3 font-semibold">Assessed Value</th>
                      <th className="text-right pb-2 pr-3 font-semibold">Sq Ft</th>
                      <th className="text-right pb-2 font-semibold">Year Built</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {result.comps.map((c, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-3 font-mono text-xs text-gray-600">{c.pin}</td>
                        <td className="py-2 pr-3 text-gray-700">{c.address ? `${c.address}${c.city ? `, ${c.city}` : ""}` : c.city || <span className="text-gray-400 italic">Address not on file</span>}</td>
                        <td className="py-2 pr-3 text-right font-medium text-gray-900">{formatCurrency(c.assessedValue)}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{c.squareFeet ? c.squareFeet.toLocaleString() : "—"}</td>
                        <td className="py-2 text-right text-gray-600">{c.yearBuilt ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="sm:hidden space-y-3">
                {result.comps.map((c, i) => (
                  <div key={i} className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm">
                    <p className="font-mono text-xs text-gray-500 mb-1">{c.pin}</p>
                    <p className="font-medium text-gray-900">{c.address ? `${c.address}${c.city ? `, ${c.city}` : ""}` : c.city || <span className="text-gray-400 italic text-xs">Address not on file</span>}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-gray-600 text-xs">
                      <span>Assessed: <strong className="text-gray-900">{formatCurrency(c.assessedValue)}</strong></span>
                      {c.squareFeet && <span>{c.squareFeet.toLocaleString()} sq ft</span>}
                      {c.yearBuilt && <span>Built {c.yearBuilt}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Pre-Written Appeal Argument ──────────────────────────────────── */}
      {appealArgumentText && (
        <div className="bg-white border border-blue-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-gray-900">Your appeal argument</h3>
            <button
              onClick={handleCopyArgument}
              className={`text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                copyStatus === "copied"
                  ? "bg-green-100 text-green-700"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              {copyStatus === "copied" ? "✓ Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Generated from your assessment level and comps
            {result.equityRatio != null ? ` (${result.equityRatio.toFixed(1)}%)` : ""} and{" "}
            {result.compCount} comparable {result.compCount === 1 ? "property" : "properties"}.
            Copy and paste when you file.
          </p>
          <textarea
            readOnly
            value={appealArgumentText}
            className="w-full rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-800 p-3 min-h-[160px] resize-none font-mono leading-relaxed"
          />
          {/* The paid entry points are gated on the route's `allowCheckout`,
              which requires a supportive outcome, a canonical window verified
              open, and a signed eligibility policy. The county's own filing
              link is not gated — it is free and it is theirs. */}
          <div className="mt-3 flex flex-wrap gap-3">
            {canOffer && (
              <>
                <Link href="/auth/signup?plan=diy"
                  className="inline-flex items-center justify-center bg-blue-600 text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm">
                  Start Your Appeal
                </Link>
                <Link href="/pricing"
                  className="inline-flex items-center justify-center border border-gray-300 bg-white text-gray-700 font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  View Appeal Options
                </Link>
              </>
            )}
            {mayFile && (
              <a href={aw.filingUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center border border-green-300 bg-green-50 text-green-700 font-semibold px-5 py-2.5 rounded-lg hover:bg-green-100 transition-colors text-sm">
                File at CCAO →
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── What Happens Next (fallback CTA when no argument) ────────────── */}
      {!appealArgumentText && !result.noAssessedValue && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <p className="text-center font-medium text-gray-900 text-lg mb-4">What happens next</p>
          <ol className="list-decimal list-inside space-y-3 text-gray-700 max-w-lg mx-auto mb-6">
            <li>Review the public-record comparison above.</li>
            <li>Confirm your own filing deadline with the Cook County Assessor.</li>
            <li>Decide for yourself whether to file — the county's filing route is free.</li>
          </ol>
          {canOffer && (
            <div className="flex flex-wrap gap-3">
              <Link href="/auth/signup?plan=diy"
                className="inline-flex items-center justify-center bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors text-sm">
                Start Your Appeal
              </Link>
              <Link href="/pricing"
                className="inline-flex items-center justify-center border border-gray-300 bg-white text-gray-700 font-semibold px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                View Appeal Options
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── Property Characteristics on File ────────────────────────────── */}
      {result.propertyCharacteristics && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-gray-900 mb-1">Property details on file</h3>
          <p className="text-sm text-gray-500 mb-4">{result.propertyCharacteristics.note}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {result.propertyCharacteristics.squareFeet && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Square footage</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.squareFeet.toLocaleString()} sq ft</p>
              </div>
            )}
            {result.propertyCharacteristics.yearBuilt && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Year built</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.yearBuilt}</p>
              </div>
            )}
            {result.propertyCharacteristics.bedrooms && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Bedrooms</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.bedrooms}</p>
              </div>
            )}
            {result.propertyCharacteristics.bathrooms && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Bathrooms</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.bathrooms}</p>
              </div>
            )}
            {result.propertyCharacteristics.propertyClass && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Property class</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.propertyClass}</p>
              </div>
            )}
            {result.propertyCharacteristics.exterior && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Exterior</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.exterior}</p>
              </div>
            )}
            {result.propertyCharacteristics.basement && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Basement</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.basement}</p>
              </div>
            )}
            {result.propertyCharacteristics.garage && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Garage</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.garage}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Email capture ────────────────────────────────────────────────── */}
      {mayTakeReminder && (
      <div className="bg-white border border-blue-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Save your results and get notified when your appeal window opens
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Free. We&apos;ll email you when your township&apos;s appeal window opens and remind you 7 days before it closes.{" "}
          <span className="text-gray-400">No spam. Unsubscribe anytime.</span>
        </p>
        {saveStatus === "success" ? (
          <p className="text-sm font-medium text-green-700">You&apos;re on the list. We&apos;ll email you when your window opens.</p>
        ) : (
          <form onSubmit={handleSaveResults} className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              value={township}
              onChange={(e) => setTownship(e.target.value)}
              placeholder="Township (optional)"
              className="sm:w-40 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={saveStatus === "loading" || !email.trim()}
              className="bg-gray-900 text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 text-sm"
            >
              {saveStatus === "loading" ? "Saving…" : "Notify me"}
            </button>
          </form>
        )}
        {saveStatus === "error" && <p className="text-sm text-red-600 mt-2">{saveError}</p>}
      </div>
      )}

      {/* ── Source attribution ───────────────────────────────────────────── */}
      <p className="text-xs text-gray-400 text-center">
        Data source: {result.source}. Assessment data reflects public Cook County Assessor records.
      </p>
    </div>
  )
}
