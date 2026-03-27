import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Illinois Homestead Exemption Guide — Free Download | OverTaxed IL",
  description:
    "Are you missing the Illinois Homestead Exemption? Thousands of homeowners overpay by $600–$1,500/year without knowing it. Free guide — check in 5 minutes.",
}

export default function HomesteadExemptionPage() {
  const sections = [
    {
      emoji: "🏠",
      heading: "What the Homestead Exemption Is",
      body: "If you own and live in your Illinois home, you're entitled to a reduction in your assessed value — automatically lowering your tax bill every single year.",
    },
    {
      emoji: "💰",
      heading: "How Much You Could Be Missing",
      body: "Cook County homeowners save $600–$1,500/year. Collar county homeowners save $200–$700/year. The exemption is free — you just have to claim it.",
    },
    {
      emoji: "✅",
      heading: "How to Check in 5 Minutes",
      body: "Look up your property on your county assessor's website. If \"General Homestead Exemption\" isn't listed — you're overpaying and need to apply.",
    },
    {
      emoji: "📋",
      heading: "How to Apply",
      body: "Online, by mail, or in person. The guide walks you through every county with direct links and what documents you need.",
    },
    {
      emoji: "🎁",
      heading: "Other Exemptions You May Be Missing",
      body: "Senior Freeze, Persons with Disabilities, Veterans (up to 100% exemption). The guide covers all of them and how they stack.",
    },
    {
      emoji: "🔄",
      heading: "How to Claim Back Years",
      body: "In Cook County you can recover up to 3 prior years of missed exemptions. That could mean a check in the mail.",
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      {/* Nav */}
      <header className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-green-700">
            OverTaxed IL
          </Link>
          <Link
            href="/"
            className="text-sm text-green-600 hover:text-green-800 underline"
          >
            ← Back to main site
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-10 text-center">
        <div className="inline-block bg-green-100 text-green-800 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
          FREE GUIDE — No Email Required
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 leading-tight">
          Are You Missing the Illinois<br className="hidden sm:block" />
          <span className="text-green-600"> Homestead Exemption?</span>
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Thousands of Illinois homeowners overpay $600–$1,500/year because they never claimed a free tax exemption they're already entitled to. Takes 5 minutes to check.
        </p>
        <a
          href="/downloads/homestead-exemption/homestead-exemption-guide.md"
          download
          className="inline-block bg-green-600 hover:bg-green-700 text-white font-bold text-lg px-10 py-4 rounded-xl shadow-lg transition-colors"
        >
          📥 Download Free Guide
        </a>
        <p className="mt-3 text-sm text-gray-500">Instant download · No signup · Works for all Illinois counties</p>
      </section>

      {/* What's Inside */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">What's in the Guide</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {sections.map((s) => (
            <div key={s.heading} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="text-3xl mb-3">{s.emoji}</div>
              <h3 className="font-bold text-gray-900 mb-2">{s.heading}</h3>
              <p className="text-gray-600 text-sm leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Savings by County */}
      <section className="bg-green-600 text-white py-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold mb-8">Estimated Annual Savings by County</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { county: "Cook", savings: "$600–$1,500" },
              { county: "DuPage", savings: "$300–$700" },
              { county: "Lake", savings: "$300–$700" },
              { county: "Will", savings: "$250–$600" },
            ].map((c) => (
              <div key={c.county} className="bg-white/10 rounded-xl p-4">
                <div className="text-lg font-bold">{c.savings}</div>
                <div className="text-sm opacity-80 mt-1">{c.county} County</div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-green-100 text-sm">Savings vary based on local tax rate. Cook County savings are typically highest.</p>
        </div>
      </section>

      {/* Download CTA */}
      <section className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-14 text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">Check Your Exemptions Now</h2>
        <p className="text-gray-600 mb-8">Takes 5 minutes. Completely free. If you're missing it, the guide tells you exactly how to apply and recover back years.</p>
        <a
          href="/downloads/homestead-exemption/homestead-exemption-guide.md"
          download
          className="inline-block bg-green-600 hover:bg-green-700 text-white font-bold text-lg px-10 py-4 rounded-xl shadow-lg transition-colors"
        >
          📥 Download Free Guide
        </a>
      </section>

      {/* Upsell to appeal packet */}
      <section className="bg-blue-50 border-t border-blue-100 py-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-3">Already Have the Exemption?</p>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Your Assessed Value Might Still Be Too High</h2>
          <p className="text-gray-600 mb-6 max-w-xl mx-auto">
            The homestead exemption reduces your bill — but if your assessment is inflated, you could be leaving hundreds more on the table. A property tax appeal fixes that.
          </p>
          <Link
            href="/appeal-packet"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3 rounded-xl transition-colors"
          >
            See the $37 Appeal Packet →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500">
          <p>© {new Date().getFullYear()} OverTaxed IL · <Link href="/disclaimer" className="underline hover:text-gray-700">Disclaimer</Link> · <Link href="/privacy" className="underline hover:text-gray-700">Privacy</Link></p>
          <p className="mt-2">This guide is for informational purposes only and does not constitute legal or tax advice.</p>
        </div>
      </footer>
    </div>
  )
}
