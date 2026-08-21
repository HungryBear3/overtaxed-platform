import Link from "next/link"
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import { TownshipAlertForm } from "@/components/townships/TownshipAlertForm"
import {
  buildTownship2026Views,
  count2026Views,
  official2026Provenance,
  type Deadline2026Status,
  type Township2026View,
} from "@/lib/deadlines-2026"
import { TOWNSHIPS_BY_SLUG, type TownshipDistrict } from "@/lib/townships"
import { cc08 } from "@/lib/copy/canonical"
import { DEADLINE_PENDING_NOTICE, OFFICIAL_DEADLINE_SOURCES } from "@/lib/deadline-sources"
import "../ot-design.css"

/**
 * /townships — the township index.
 *
 * This page and /deadlines used to render two different calendars while telling
 * the reader, in a badge at the top, that they were "the same canonical
 * deadline data". /deadlines read the 2026 map; this page read the seed dates
 * and fixed reference date in `lib/townships.ts`. The badge was not a lie
 * anyone told on purpose — it was true of the intent and false of the code,
 * which is the failure mode a single source of truth exists to make impossible.
 *
 * Both now build from [[buildTownship2026Views]], so the claim is structural
 * rather than aspirational: there is one array, and if a township is open here
 * it is open there.
 *
 * Rendered per request. A status derived at build time and served from a cache
 * is a seed date with extra steps.
 */
export const dynamic = "force-dynamic"

export const metadata = {
  title: "Cook County Township Appeal Deadlines",
  description:
    "The filing window for each of the 38 Cook County townships, as published by the Cook County Assessor. Townships whose window we have not verified against the county's calendar show no date.",
  alternates: { canonical: "https://www.overtaxed-il.com/townships" },
}

const statusConfig: Record<
  Deadline2026Status,
  { label: string; badge: string; row: string; dot: string; action: string }
> = {
  open: {
    label: "Open now",
    badge: "bg-green-100 text-green-800 border border-green-200",
    row: "bg-green-50/40",
    dot: "bg-green-500",
    action: "Run free check",
  },
  upcoming: {
    label: "Not yet open",
    badge: "bg-yellow-100 text-yellow-800 border border-yellow-200",
    row: "bg-yellow-50/30",
    dot: "bg-yellow-400",
    action: "Get notified",
  },
  closed: {
    label: "Closed",
    badge: "bg-gray-100 text-gray-600 border border-gray-200",
    row: "",
    dot: "bg-gray-300",
    action: "View details",
  },
  // "Pending" is not a fourth kind of window. It means we have not verified this
  // township against the county's calendar, so we show no date and no status —
  // which is a statement about us, not about the township.
  pending: {
    label: "Not verified",
    badge: "bg-gray-100 text-gray-600 border border-gray-200",
    row: "",
    dot: "bg-gray-300",
    action: "View details",
  },
}

const districtOrder: TownshipDistrict[] = ["south-west-suburbs", "north-suburbs", "chicago"]

const districtMeta: Record<TownshipDistrict, { label: string; chip: string; dot: string }> = {
  "south-west-suburbs": {
    label: "South & West Suburbs",
    chip: "2026 reassessment cycle",
    dot: "bg-green-500",
  },
  "north-suburbs": {
    label: "North Suburbs",
    chip: "2027 reassessment cycle",
    dot: "bg-gray-300",
  },
  chicago: {
    label: "City of Chicago",
    chip: "2028 reassessment cycle",
    dot: "bg-blue-400",
  },
}

/** The Assessor's last file date, or an explicit absence. Never a guess. */
function formatWindow(view: Township2026View): string {
  return view.official && view.lastFileLabel
    ? `File by ${view.lastFileLabel}`
    : "Not published"
}

function neighborsOf(slug: string): string {
  const roster = TOWNSHIPS_BY_SLUG[slug]
  if (!roster) return ""
  return roster.neighbors.map((s) => s.replace(/-/g, " ")).join(", ")
}

/**
 * Options for the reminder form.
 *
 * Only townships whose projection permits a reminder signup are offered. The
 * form promises an email when a window opens and again before it closes;
 * offering a township whose calendar we have not read would be taking a signup
 * against a date we do not have. An empty list is the correct output of an
 * un-refreshed snapshot — and, because the block below is gated on the list
 * being non-empty, an empty list means no capture control renders at all.
 *
 * The status filter alone was not enough. It kept the form on the page with an
 * empty dropdown whenever nothing verified: the date column went quiet and the
 * email field beside it did not, which is the partial suppression the contract
 * is written against.
 */
function alertFormTownships(views: Township2026View[]) {
  return views
    .filter((v) => v.allowReminderSignup && v.official && (v.status === "open" || v.status === "upcoming"))
    .map((v) => ({
      name: v.name,
      district: districtMeta[v.district].label,
      status: v.status === "open" ? ("OPEN" as const) : ("UPCOMING" as const),
      closeDate: v.lastFileLabelShort,
      cities: neighborsOf(v.slug),
    }))
}

export default function TownshipsPage() {
  const views = buildTownship2026Views()
  const counts = count2026Views(views)
  const provenance = official2026Provenance(views)
  const alertTownships = alertFormTownships(views)
  const assessorSource = OFFICIAL_DEADLINE_SOURCES[0]

  const grouped = districtOrder.reduce<Record<TownshipDistrict, Township2026View[]>>(
    (acc, district) => {
      acc[district] = views.filter((v) => v.district === district)
      return acc
    },
    {
      "south-west-suburbs": [],
      "north-suburbs": [],
      chicago: [],
    },
  )

  return (
    <div className="ot-root">
      <SiteHeader active="deadlines" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-white">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Cook County Township Appeal Deadlines
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            All {views.length} Cook County townships, grouped by triennial reassessment
            cycle: 2026 South &amp; West Suburbs, 2027 North Suburbs, and 2028 City of
            Chicago. Filing windows come from the Cook County Assessor.
          </p>
          <p className="text-sm text-gray-500 max-w-2xl mt-3">
            {provenance
              ? cc08({ source: provenance.source, timestamp: provenance.retrievedAt })
              : DEADLINE_PENDING_NOTICE}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <p className="text-3xl font-bold text-green-700">{counts.open}</p>
            <p className="text-sm font-medium text-green-800 mt-1">Open now</p>
            <p className="text-xs text-green-600 mt-1">Verified against the county calendar</p>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
            <p className="text-3xl font-bold text-yellow-700">{counts.upcoming}</p>
            <p className="text-sm font-medium text-yellow-800 mt-1">Not yet open</p>
            <p className="text-xs text-yellow-600 mt-1">Get notified before the window opens</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
            <p className="text-3xl font-bold text-gray-700">{counts.pending}</p>
            <p className="text-sm font-medium text-gray-800 mt-1">Not verified</p>
            <p className="text-xs text-gray-600 mt-1">
              No date shown — confirm with the county
            </p>
          </div>
        </div>

        {districtOrder.map((district) => {
          const rows = grouped[district]
          const meta = districtMeta[district]
          if (!rows.length) return null
          return (
            <div key={district} className="mb-10">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex flex-wrap items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
                {meta.label}
                <span className="text-xs font-normal text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                  {meta.chip}
                </span>
              </h2>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="py-3 pl-4 pr-3 text-left font-semibold">Township</th>
                      <th className="px-3 py-3 text-left font-semibold">Status</th>
                      <th className="hidden sm:table-cell px-3 py-3 text-left font-semibold">Assessor deadline</th>
                      <th className="hidden md:table-cell px-3 py-3 text-left font-semibold">Nearby townships</th>
                      <th className="px-3 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((v) => {
                      const cfg = statusConfig[v.status]
                      return (
                        <tr key={v.slug} className={`${cfg.row} hover:bg-gray-50 transition-colors`}>
                          <td className="py-3.5 pl-4 pr-3 font-medium text-gray-900">
                            <Link href={`/township/${v.slug}`} className="hover:text-blue-700 hover:underline">
                              {v.name}
                            </Link>
                          </td>
                          <td className="px-3 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {cfg.label}
                            </span>
                          </td>
                          <td className="hidden sm:table-cell px-3 py-3.5 text-gray-600">
                            {formatWindow(v)}
                          </td>
                          <td className="hidden md:table-cell px-3 py-3.5 text-gray-500 text-xs max-w-[240px] leading-relaxed capitalize">
                            {neighborsOf(v.slug)}
                          </td>
                          <td className="px-3 py-3.5 text-right">
                            {v.status === "open" ? (
                              <div className="inline-flex flex-col items-end gap-1.5">
                                <Link
                                  href="/check"
                                  className="inline-block bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                  {cfg.action}
                                </Link>
                                <Link
                                  href={`/township/${v.slug}`}
                                  className="text-xs text-blue-700 font-medium hover:underline"
                                >
                                  {v.name} details →
                                </Link>
                              </div>
                            ) : v.status === "upcoming" ? (
                              <div className="inline-flex flex-col items-end gap-1.5">
                                <a
                                  href="#township-alert"
                                  className="inline-block text-xs font-medium text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                                >
                                  {cfg.action}
                                </a>
                                <Link
                                  href={`/township/${v.slug}`}
                                  className="text-xs text-blue-700 font-medium hover:underline"
                                >
                                  {v.name} details →
                                </Link>
                              </div>
                            ) : (
                              <Link
                                href={`/township/${v.slug}`}
                                className="text-xs text-gray-500 hover:text-blue-700 hover:underline"
                              >
                                {v.name} details →
                              </Link>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

        {alertTownships.length > 0 && (
          <div id="township-alert" className="mt-8 mb-10">
            <TownshipAlertForm townships={alertTownships} />
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">How the appeal process works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-sm font-semibold text-blue-700 mb-1">1. Check your assessment</p>
              <p className="text-sm text-gray-600">
                Look up your current assessed value using your address or PIN, then compare it
                with similar nearby homes.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-700 mb-1">2. Build the packet</p>
              <p className="text-sm text-gray-600">
                OverTaxed IL organizes assessment-level and uniformity evidence from Cook County
                public records into a filing-ready packet.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-700 mb-1">3. File before your deadline</p>
              <p className="text-sm text-gray-600">
                {/* The Board of Review is dropped rather than disclosed. The
                    windows listed on this page are the Assessor's, so offering
                    the Board as an alternative portal for them pointed
                    homeowners at the wrong stage — and at the one stage
                    OverTaxed IL cannot serve. */}
                Submit through the Cook County Assessor before your township window closes.
                Filing with the county is free.
              </p>
            </div>
          </div>
        </div>

        {/* The old footnote said "Deadline dates are approximate. Always verify
            current open/close dates" — a disclaimer doing the work of a source.
            A date is either verified against the county's published calendar,
            in which case it is shown with CC-08 provenance, or it is not, in
            which case the row above shows no date at all. */}
        <p className="text-xs text-gray-400 text-center mt-6">
          Filing deadlines are set by the county and change through the year. Confirm yours at the{" "}
          <a
            href={assessorSource.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-600"
          >
            {assessorSource.label}
          </a>
          . OverTaxed IL is not affiliated with the Cook County Assessor&apos;s Office.
        </p>

        {/* CC-18 is not repeated here. It is rendered once by SiteFooter, which
            is on this page and on every other consumer surface; printing it
            twice on one page is how a standing disclosure starts reading as
            page furniture. */}
      </main>

      <SiteFooter />
    </div>
  )
}
