import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Illinois Property Tax Appeal Packet — DIY Toolkit | OverTaxed IL",
  description:
    "Everything you need to file your own Illinois property tax appeal. Cover letter, evidence checklist, filing instructions, deadline calendar, and FAQ. Instant download. $37.",
}

export default function AppealPacketPage() {
  const included = [
    {
      emoji: "📄",
      title: "Appeal Cover Letter Template",
      desc: "Professional letter template ready to customize — just fill in your address, PIN, and proposed value.",
    },
    {
      emoji: "✅",
      title: "Evidence Checklist",
      desc: "Know exactly what to gather: comps, appraisals, defect photos, property record card errors — with tips on where to find each.",
    },
    {
      emoji: "📋",
      title: "Step-by-Step Filing Instructions",
      desc: "Cook County Board of Review, collar counties, and PTAB escalation — plain English, no legal jargon.",
    },
    {
      emoji: "📅",
      title: "County Deadline Calendar",
      desc: "Appeal windows for Cook, DuPage, Lake, Will, Kane, McHenry, and more. Don't miss your window.",
    },
    {
      emoji: "❓",
      title: "10 Most Common Questions",
      desc: "Can my taxes go up if I appeal? Do I need a lawyer? What if I'm denied? Honest answers to what homeowners actually ask.",
    },
  ]

  const trustPoints = [
    "⚡ Instant download — access immediately after purchase",
    "🏠 Works for all Illinois counties",
    "📝 Plain English — no legal background needed",
    "🔁 Use it every appeal season, year after year",
  ]

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Nav */}
      <header className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-blue-700">
            OverTaxed IL
          </Link>
          <Link
            href="/"
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            ← Back to main site
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <span className="inline-block bg-amber-100 text-amber-800 text-sm font-semibold px-3 py-1 rounded-full mb-4">
            🏡 Illinois Homeowners
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4 leading-tight">
            Stop Overpaying Property Taxes
          </h1>
          <p className="text-xl text-gray-600 mb-6 max-w-2xl mx-auto">
            File your own Illinois property tax appeal — no attorney required.
            Get the exact documents and instructions pros use, for a fraction of
            the cost.
          </p>

          {/* Price */}
          <div className="inline-flex items-center gap-3 mb-8">
            <span className="text-gray-400 line-through text-xl">$67</span>
            <span className="text-4xl font-bold text-blue-700">$37</span>
            <span className="text-gray-500">one-time</span>
          </div>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a
              href="https://buy.stripe.com/PLACEHOLDER"
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-4 rounded-lg text-lg transition-colors w-full sm:w-auto text-center"
            >
              Get the Appeal Packet — $37
            </a>
          </div>

          {/* Trust signals */}
          <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-gray-500">
            {trustPoints.map((point) => (
              <span key={point}>{point}</span>
            ))}
          </div>
        </div>

        {/* What's Included */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
            What&apos;s in the Packet
          </h2>
          <div className="space-y-4">
            {included.map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-4 bg-white rounded-xl border border-gray-200 p-5 shadow-sm"
              >
                <span className="text-2xl flex-shrink-0">{item.emoji}</span>
                <div>
                  <h3 className="font-semibold text-gray-900">{item.title}</h3>
                  <p className="text-gray-600 text-sm mt-1">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Why This Works */}
        <section className="bg-blue-50 rounded-2xl p-8 mb-14">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Why Property Tax Appeals Work
          </h2>
          <div className="grid sm:grid-cols-3 gap-6 text-center">
            <div>
              <p className="text-3xl font-bold text-blue-700 mb-1">~65%</p>
              <p className="text-gray-600 text-sm">
                of Cook County appeals result in a reduction
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-700 mb-1">$1,200+</p>
              <p className="text-gray-600 text-sm">
                average annual savings for homeowners who appeal
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-700 mb-1">0%</p>
              <p className="text-gray-600 text-sm">
                chance your taxes go up — filing cannot raise your value
              </p>
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Ready to fight back?
          </h2>
          <p className="text-gray-600 mb-6">
            Most homeowners never appeal — and overpay for years. This packet
            gives you everything you need to change that today.
          </p>
          <a
            href="https://buy.stripe.com/PLACEHOLDER"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-4 rounded-lg text-lg transition-colors inline-block"
          >
            Get the Appeal Packet — $37
          </a>
          <p className="text-gray-400 text-sm mt-4">
            Instant download. Works for all Illinois counties.
          </p>
        </section>
      </main>

      <footer className="text-center py-8 text-gray-400 text-sm">
        <p>
          © {new Date().getFullYear()} OverTaxed IL ·{" "}
          <Link href="/disclaimer" className="hover:underline">
            Disclaimer
          </Link>
          {" · "}
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
        </p>
        <p className="mt-1">
          This packet is for informational purposes only and does not constitute
          legal advice.
        </p>
      </footer>
    </div>
  )
}
