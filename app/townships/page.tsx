import Link from "next/link"
import { Logo } from "@/components/navigation/Logo"
import { TownshipAlertForm } from "@/components/townships/TownshipAlertForm"

export const metadata = {
  title: "Cook County Township Appeal Deadlines 2026 | OverTaxed IL",
  description:
    "Check which Cook County townships are open for property tax appeals in 2026. South district reassessment cycle. Find your deadline and start your appeal.",
}

// Township data — updated for the 2026 south district reassessment cycle.
// Status: OPEN | UPCOMING | CLOSED | FUTURE
// Source: Cook County Assessor assessment calendar (cookcountyassessor.com/assessment-calendar-and-deadlines)
// Update this data each year after the CCAO publishes the new calendar (typically Nov–Jan).
const townships = [
  // South district — 2026 reassessment cycle
  {
    name: "Bloom",
    district: "South",
    status: "OPEN" as const,
    openDate: "Jan 2026",
    closeDate: "Mar 2026",
    cities: "Chicago Heights, Flossmoor, Glenwood, Homewood, Lansing, Lynwood, Sauk Village, South Chicago Heights, Thornton",
  },
  {
    name: "Bremen",
    district: "South",
    status: "OPEN" as const,
    openDate: "Jan 2026",
    closeDate: "Mar 2026",
    cities: "Alsip, Blue Island, Crestwood, Evergreen Park, Merrionette Park, Midlothian, Oak Forest, Posen, Robbins",
  },
  {
    name: "Calumet",
    district: "South",
    status: "OPEN" as const,
    openDate: "Feb 2026",
    closeDate: "Apr 2026",
    cities: "Burnham, Calumet City, Dolton, Riverdale, South Holland, Thornton",
  },
  {
    name: "Rich",
    district: "South",
    status: "OPEN" as const,
    openDate: "Feb 2026",
    closeDate: "Apr 2026",
    cities: "Country Club Hills, Flossmoor, Matteson, Olympia Fields, Park Forest, Richton Park, Steger",
  },
  {
    name: "Thornton",
    district: "South",
    status: "OPEN" as const,
    openDate: "Feb 2026",
    closeDate: "Apr 2026",
    cities: "Blue Island, Harvey, Hazel Crest, Markham, Phoenix, Posen, Riverdale, South Holland",
  },
  {
    name: "Worth",
    district: "South",
    status: "OPEN" as const,
    openDate: "Jan 2026",
    closeDate: "Mar 2026",
    cities: "Bridgeview, Chicago Ridge, Hickory Hills, Justice, Oak Lawn, Palos Hills, Palos Park, Willow Springs",
  },
  {
    name: "Lemont",
    district: "South",
    status: "UPCOMING" as const,
    openDate: "Mar 2026",
    closeDate: "May 2026",
    cities: "Lemont, Homer Glen, Lockport (partial)",
  },
  {
    name: "Lyons",
    district: "South",
    status: "UPCOMING" as const,
    openDate: "Mar 2026",
    closeDate: "May 2026",
    cities: "Berwyn, Brookfield, Countryside, LaGrange, LaGrange Park, Stickney, Western Springs",
  },
  {
    name: "Orland",
    district: "South",
    status: "UPCOMING" as const,
    openDate: "Mar 2026",
    closeDate: "May 2026",
    cities: "Orland Hills, Orland Park, Tinley Park (partial)",
  },
  {
    name: "Palos",
    district: "South",
    status: "UPCOMING" as const,
    openDate: "Mar 2026",
    closeDate: "May 2026",
    cities: "Palos Heights, Palos Hills, Palos Park, Willow Springs",
  },
  {
    name: "Stickney",
    district: "South",
    status: "UPCOMING" as const,
    openDate: "Apr 2026",
    closeDate: "Jun 2026",
    cities: "Bedford Park, Burbank, Forest View, Oak Lawn (partial), Stickney, Summit",
  },
  // North district — future reassessment cycle
  {
    name: "Barrington",
    district: "North",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "Barrington, Barrington Hills, Lake Barrington, North Barrington, South Barrington",
  },
  {
    name: "Elk Grove",
    district: "North",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "Elk Grove Village, Schaumburg (partial)",
  },
  {
    name: "Evanston",
    district: "North",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "Evanston",
  },
  {
    name: "Maine",
    district: "North",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "Des Plaines, Glenview, Morton Grove, Niles, Park Ridge",
  },
  {
    name: "Niles",
    district: "North",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "Lincolnwood, Morton Grove, Niles, Skokie (partial)",
  },
  {
    name: "New Trier",
    district: "North",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "Glencoe, Kenilworth, Northfield, Wilmette, Winnetka",
  },
  {
    name: "Northfield",
    district: "North",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "Glenview, Northbrook, Northfield, Prospect Heights, Wheeling",
  },
  {
    name: "Palatine",
    district: "North",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "Arlington Heights (partial), Palatine, Rolling Meadows, Schaumburg (partial)",
  },
  {
    name: "Wheeling",
    district: "North",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "Buffalo Grove, Prospect Heights, Wheeling",
  },
  // City of Chicago — triennial reassessment
  {
    name: "Chicago (City)",
    district: "City",
    status: "FUTURE" as const,
    openDate: "2027",
    closeDate: "2027",
    cities: "All Chicago neighborhoods",
  },
  // Northwest district — future
  {
    name: "Berwyn",
    district: "Northwest",
    status: "FUTURE" as const,
    openDate: "2028",
    closeDate: "2028",
    cities: "Berwyn, Cicero, Stickney (partial)",
  },
  {
    name: "Hanover",
    district: "Northwest",
    status: "FUTURE" as const,
    openDate: "2028",
    closeDate: "2028",
    cities: "Bartlett, Bloomingdale, Hanover Park, Streamwood",
  },
  {
    name: "Oak Park",
    district: "Northwest",
    status: "FUTURE" as const,
    openDate: "2028",
    closeDate: "2028",
    cities: "Forest Park, Oak Park, River Forest, River Grove",
  },
  {
    name: "River Forest",
    district: "Northwest",
    status: "FUTURE" as const,
    openDate: "2028",
    closeDate: "2028",
    cities: "Elmwood Park, Franklin Park, River Forest, River Grove, Rosemont",
  },
  {
    name: "Schaumburg",
    district: "Northwest",
    status: "FUTURE" as const,
    openDate: "2028",
    closeDate: "2028",
    cities: "Hoffman Estates, Roselle, Schaumburg, Streamwood",
  },
]

const statusConfig = {
  OPEN: {
    label: "Open Now",
    badge: "bg-green-100 text-green-800 border border-green-200",
    row: "bg-green-50/40",
    dot: "bg-green-500",
  },
  UPCOMING: {
    label: "Opening Soon",
    badge: "bg-yellow-100 text-yellow-800 border border-yellow-200",
    row: "bg-yellow-50/30",
    dot: "bg-yellow-400",
  },
  CLOSED: {
    label: "Closed",
    badge: "bg-gray-100 text-gray-600 border border-gray-200",
    row: "",
    dot: "bg-gray-300",
  },
  FUTURE: {
    label: "Future cycle",
    badge: "bg-gray-100 text-gray-500 border border-gray-200",
    row: "",
    dot: "bg-gray-200",
  },
}

const districtOrder = ["South", "City", "North", "Northwest"]

export default function TownshipsPage() {
  const grouped = districtOrder.reduce<Record<string, typeof townships>>(
    (acc, d) => {
      acc[d] = townships.filter((t) => t.district === d)
      return acc
    },
    {}
  )

  const openCount = townships.filter((t) => t.status === "OPEN").length
  const upcomingCount = townships.filter((t) => t.status === "UPCOMING").length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Logo href="/" />
          <div className="flex items-center gap-4">
            <Link href="/auth/signin" className="text-sm text-gray-600 hover:text-gray-900 font-medium">
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium text-sm"
            >
              Start Your Appeal
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Page header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 text-blue-800 text-sm font-medium mb-4">
            2026 South District Reassessment Cycle
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Cook County Township Appeal Deadlines
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            Each Cook County township has its own appeal window. Find yours below, check your
            deadline, and start your appeal before the window closes.
          </p>
        </div>

        {/* Status summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <p className="text-3xl font-bold text-green-700">{openCount}</p>
            <p className="text-sm font-medium text-green-800 mt-1">Townships open now</p>
            <p className="text-xs text-green-600 mt-1">File before your deadline</p>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
            <p className="text-3xl font-bold text-yellow-700">{upcomingCount}</p>
            <p className="text-sm font-medium text-yellow-800 mt-1">Opening soon</p>
            <p className="text-xs text-yellow-600 mt-1">Get notified when your window opens</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <p className="text-3xl font-bold text-blue-700">3 yrs</p>
            <p className="text-sm font-medium text-blue-800 mt-1">Savings locked in</p>
            <p className="text-xs text-blue-600 mt-1">A 2026 win saves you through 2029</p>
          </div>
        </div>

        {/* 3-year savings callout */}
        <div className="bg-blue-900 text-white rounded-xl p-6 mb-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-blue-300 uppercase tracking-wide mb-1">
                Why 2026 matters
              </p>
              <h2 className="text-xl font-bold">
                A win in 2026 saves you money through 2029.
              </h2>
              <p className="text-blue-200 mt-2 text-sm">
                Cook County reassesses on a 3-year cycle. South district townships are up this
                year. A successful appeal locks in your reduced assessment — $500–$1,500/year
                savings for up to 3 years.
              </p>
              <p className="text-blue-100 mt-2 text-sm font-semibold">
                $500–$1,500/year × 3 years = $1,500–$4,500 from one appeal.
              </p>
            </div>
            <div className="shrink-0">
              <Link
                href="/auth/signup"
                className="inline-block bg-white text-blue-900 font-semibold px-6 py-3 rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap"
              >
                Start my appeal →
              </Link>
            </div>
          </div>
        </div>

        {/* Township tables by district */}
        {districtOrder.map((district) => {
          const rows = grouped[district]
          if (!rows || rows.length === 0) return null
          return (
            <div key={district} className="mb-10">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                {district === "South" && (
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                )}
                {district === "City" && (
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
                )}
                {(district === "North" || district === "Northwest") && (
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />
                )}
                {district} District
                {district === "South" && (
                  <span className="ml-2 text-xs font-normal text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                    2026 reassessment cycle
                  </span>
                )}
                {(district === "North" || district === "City") && (
                  <span className="ml-2 text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    next cycle 2027
                  </span>
                )}
                {district === "Northwest" && (
                  <span className="ml-2 text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    next cycle 2028
                  </span>
                )}
              </h2>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="py-3 pl-4 pr-3 text-left font-semibold">Township</th>
                      <th className="px-3 py-3 text-left font-semibold">Status</th>
                      <th className="hidden sm:table-cell px-3 py-3 text-left font-semibold">Open</th>
                      <th className="hidden sm:table-cell px-3 py-3 text-left font-semibold">Deadline</th>
                      <th className="hidden md:table-cell px-3 py-3 text-left font-semibold">Includes</th>
                      <th className="px-3 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((t) => {
                      const cfg = statusConfig[t.status]
                      return (
                        <tr key={t.name} className={`${cfg.row} hover:bg-gray-50 transition-colors`}>
                          <td className="py-3.5 pl-4 pr-3 font-medium text-gray-900">
                            {t.name}
                          </td>
                          <td className="px-3 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {cfg.label}
                            </span>
                          </td>
                          <td className="hidden sm:table-cell px-3 py-3.5 text-gray-600">
                            {t.openDate}
                          </td>
                          <td className="hidden sm:table-cell px-3 py-3.5 text-gray-600">
                            {t.status === "FUTURE" ? "—" : t.closeDate}
                          </td>
                          <td className="hidden md:table-cell px-3 py-3.5 text-gray-500 text-xs max-w-[240px] leading-relaxed">
                            {t.cities}
                          </td>
                          <td className="px-3 py-3.5 text-right">
                            {t.status === "OPEN" ? (
                              <div className="inline-flex flex-col items-end gap-1.5">
                                <Link
                                  href="/auth/signup"
                                  className="inline-block bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                  Appeal now
                                </Link>
                                <a
                                  href="https://www.cookcountyassessor.com/online-appeals"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-green-700 font-medium hover:underline"
                                >
                                  File at CCAO →
                                </a>
                              </div>
                            ) : t.status === "UPCOMING" ? (
                              <a
                                href="#township-alert"
                                className="inline-block text-xs font-medium text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                              >
                                Get notified
                              </a>
                            ) : (
                              <span className="text-xs text-gray-400">Opens {t.openDate}</span>
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

        {/* Email alert sign-up */}
        <div id="township-alert" className="mt-8 mb-10">
          <TownshipAlertForm townships={townships} />
        </div>

        {/* How appeals work — brief */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">How the appeal process works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-sm font-semibold text-blue-700 mb-1">1. Check your assessment</p>
              <p className="text-sm text-gray-600">
                Look up your current assessed value at{" "}
                <a
                  href="https://www.cookcountyassessor.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  cookcountyassessor.com
                </a>{" "}
                using your address or PIN.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-700 mb-1">2. Get comparable properties</p>
              <p className="text-sm text-gray-600">
                You need at least 3 sales comps — similar homes that sold recently in your area.
                OverTaxed IL pulls these automatically from Cook County data.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-700 mb-1">3. File before your deadline</p>
              <p className="text-sm text-gray-600">
                Submit your appeal online at{" "}
                <a
                  href="https://www.cookcountyassessor.com/online-appeals"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  cookcountyassessor.com/online-appeals
                </a>
                . Filing is free.
              </p>
            </div>
          </div>
        </div>

        {/* Official source note */}
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

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-500">
          <p>© {new Date().getFullYear()} OverTaxed IL. Cook County property tax appeals.</p>
          <div className="flex gap-6">
            <Link href="/terms" className="hover:text-gray-700">Terms</Link>
            <Link href="/privacy" className="hover:text-gray-700">Privacy</Link>
            <Link href="/contact" className="hover:text-gray-700">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
