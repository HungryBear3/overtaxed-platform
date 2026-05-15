import Link from "next/link"
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import { TownshipAlertForm } from "@/components/townships/TownshipAlertForm"
import {
  TOWNSHIPS,
  TOWNSHIP_STATUS_COUNTS,
  type Township,
  type TownshipDistrict,
  type TownshipStatus,
} from "@/lib/townships"
import "../ot-design.css"

export const metadata = {
  title: "Cook County Township Appeal Deadlines 2026 | OverTaxed IL",
  description:
    "Check appeal windows for all 38 Cook County townships using the same deadline data as OverTaxed IL's deadlines page. See open, opening-soon, and future-cycle townships.",
}

const statusConfig: Record<
  TownshipStatus,
  { label: string; badge: string; row: string; dot: string; action: string }
> = {
  open: {
    label: "Open now",
    badge: "bg-green-100 text-green-800 border border-green-200",
    row: "bg-green-50/40",
    dot: "bg-green-500",
    action: "Run free check",
  },
  "opening-soon": {
    label: "Opening soon",
    badge: "bg-yellow-100 text-yellow-800 border border-yellow-200",
    row: "bg-yellow-50/30",
    dot: "bg-yellow-400",
    action: "Get notified",
  },
  closed: {
    label: "Future cycle",
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

function formatWindow(t: Township): string {
  return `${t.openDateShort} – ${t.closeDateShort}, ${t.cycleYear}`
}

function alertFormTownships() {
  return TOWNSHIPS.map((t) => ({
    name: t.name,
    district: districtMeta[t.district].label,
    status:
      t.status === "open"
        ? ("OPEN" as const)
        : t.status === "opening-soon"
          ? ("UPCOMING" as const)
          : ("FUTURE" as const),
    openDate: t.openDateShort,
    closeDate: t.closeDateShort,
    cities: t.neighbors.map((slug) => slug.replace(/-/g, " ")).join(", "),
  }))
}

export default function TownshipsPage() {
  const grouped = districtOrder.reduce<Record<TownshipDistrict, Township[]>>(
    (acc, district) => {
      acc[district] = TOWNSHIPS.filter((t) => t.district === district)
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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 text-blue-800 text-sm font-medium mb-4">
            Same canonical deadline data as /deadlines
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Cook County Township Appeal Deadlines
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            All 38 Cook County townships are listed below using one shared source of truth:
            2026 South & West Suburbs, 2027 North Suburbs, and 2028 City of Chicago.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <p className="text-3xl font-bold text-green-700">{TOWNSHIP_STATUS_COUNTS.open}</p>
            <p className="text-sm font-medium text-green-800 mt-1">Townships open now</p>
            <p className="text-xs text-green-600 mt-1">Matches the /deadlines count</p>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
            <p className="text-3xl font-bold text-yellow-700">{TOWNSHIP_STATUS_COUNTS["opening-soon"]}</p>
            <p className="text-sm font-medium text-yellow-800 mt-1">Opening soon</p>
            <p className="text-xs text-yellow-600 mt-1">Get notified before the window opens</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
            <p className="text-3xl font-bold text-gray-700">{TOWNSHIP_STATUS_COUNTS.closed}</p>
            <p className="text-sm font-medium text-gray-800 mt-1">Future-cycle / closed</p>
            <p className="text-xs text-gray-600 mt-1">North Suburbs and Chicago follow later</p>
          </div>
        </div>

        <div className="bg-blue-900 text-white rounded-xl p-6 mb-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-blue-300 uppercase tracking-wide mb-1">
                Why the cycle matters
              </p>
              <h2 className="text-xl font-bold">
                The deadline page and township index now render from the same data.
              </h2>
              <p className="text-blue-200 mt-2 text-sm">
                If a township is open on /deadlines, it is open here too. Dates are still
                public-record estimates and should be verified against the official Cook County
                assessment calendar before filing.
              </p>
            </div>
            <div className="shrink-0">
              <Link
                href="/deadlines"
                className="inline-block bg-white text-blue-900 font-semibold px-6 py-3 rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap"
              >
                Compare deadline view →
              </Link>
            </div>
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
                      <th className="hidden sm:table-cell px-3 py-3 text-left font-semibold">Window</th>
                      <th className="hidden md:table-cell px-3 py-3 text-left font-semibold">Nearby townships</th>
                      <th className="px-3 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((t) => {
                      const cfg = statusConfig[t.status]
                      return (
                        <tr key={t.slug} className={`${cfg.row} hover:bg-gray-50 transition-colors`}>
                          <td className="py-3.5 pl-4 pr-3 font-medium text-gray-900">
                            <Link href={`/township/${t.slug}`} className="hover:text-blue-700 hover:underline">
                              {t.name}
                            </Link>
                          </td>
                          <td className="px-3 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {cfg.label}
                            </span>
                          </td>
                          <td className="hidden sm:table-cell px-3 py-3.5 text-gray-600">
                            {formatWindow(t)}
                          </td>
                          <td className="hidden md:table-cell px-3 py-3.5 text-gray-500 text-xs max-w-[240px] leading-relaxed capitalize">
                            {t.neighbors.map((slug) => slug.replace(/-/g, " ")).join(", ")}
                          </td>
                          <td className="px-3 py-3.5 text-right">
                            {t.status === "open" ? (
                              <div className="inline-flex flex-col items-end gap-1.5">
                                <Link
                                  href="/check"
                                  className="inline-block bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                  {cfg.action}
                                </Link>
                                <Link
                                  href={`/township/${t.slug}`}
                                  className="text-xs text-blue-700 font-medium hover:underline"
                                >
                                  {t.name} details →
                                </Link>
                              </div>
                            ) : t.status === "opening-soon" ? (
                              <div className="inline-flex flex-col items-end gap-1.5">
                                <a
                                  href="#township-alert"
                                  className="inline-block text-xs font-medium text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                                >
                                  {cfg.action}
                                </a>
                                <Link
                                  href={`/township/${t.slug}`}
                                  className="text-xs text-blue-700 font-medium hover:underline"
                                >
                                  Opens {t.openDateShort} →
                                </Link>
                              </div>
                            ) : (
                              <Link
                                href={`/township/${t.slug}`}
                                className="text-xs text-gray-500 hover:text-blue-700 hover:underline"
                              >
                                Opens {t.cycleYear} →
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

        <div id="township-alert" className="mt-8 mb-10">
          <TownshipAlertForm townships={alertFormTownships()} />
        </div>

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
                Submit through the Cook County Assessor or Board of Review portal before your
                township window closes. Filing is free.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">
          Deadline dates are approximate. Always verify current open/close dates at the official{" "}
          <a
            href="https://www.cookcountyassessor.com/assessment-calendar-and-deadlines"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-600"
          >
            Cook County Assessor assessment calendar
          </a>
          . OverTaxed IL is not affiliated with the Cook County Assessor&apos;s Office.
        </p>
      </main>

      <SiteFooter />
    </div>
  )
}
