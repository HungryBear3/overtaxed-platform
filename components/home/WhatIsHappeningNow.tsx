import Link from "next/link"

/**
 * "What's Happening Right Now" homepage section.
 * Keeps the homepage current for homeowners arriving from social content.
 * Update LAST_UPDATED and the bullet points as the 2026 cycle progresses.
 */

const LAST_UPDATED = "March 2026"

const updates = [
  {
    icon: "🏠",
    text: (
      <>
        <strong>South district townships are in the 2026 reassessment cycle.</strong>{" "}
        Bloom, Bremen, Calumet, Rich, Thornton, Worth — and more opening soon.
      </>
    ),
    urgent: true,
  },
  {
    icon: "📈",
    text: (
      <>
        Cook County property taxes <strong>spiked at the close of 2025</strong> as commercial
        values fell, shifting more of the tax burden to residential homeowners.
      </>
    ),
    urgent: false,
  },
  {
    icon: "⚖️",
    text: (
      <>
        The CCAO, Board of Review, and County Treasurer have been publicly at odds over who
        is responsible. <strong>No relief has been offered to homeowners.</strong>
      </>
    ),
    urgent: false,
  },
  {
    icon: "🗓️",
    text: (
      <>
        <strong>A successful appeal in 2026 locks in savings through 2029.</strong>{" "}
        The 3-year cycle means one filing can be worth $1,500–$4,500 in total savings.
      </>
    ),
    urgent: false,
  },
]

export function WhatIsHappeningNow() {
  return (
    <section className="mt-20 rounded-2xl border border-blue-100 bg-blue-50/60 px-6 py-8 sm:px-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <span className="inline-block px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold uppercase tracking-wide mb-2">
            What&apos;s happening right now
          </span>
          <h2 className="text-lg font-bold text-gray-900">Cook County 2026 — Why this year matters</h2>
        </div>
        <Link
          href="/townships"
          className="shrink-0 text-sm text-blue-600 font-semibold hover:text-blue-700 flex items-center gap-1"
        >
          Check your township deadline →
        </Link>
      </div>

      <ul className="space-y-3">
        {updates.map((u, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="text-lg leading-tight shrink-0">{u.icon}</span>
            <p
              className={`text-sm leading-relaxed ${
                u.urgent ? "text-gray-900" : "text-gray-700"
              }`}
            >
              {u.text}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-xs text-gray-400">Updated {LAST_UPDATED}</p>
    </section>
  )
}
