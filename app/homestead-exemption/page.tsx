import type { Metadata } from "next"
import Link from "next/link"
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import "../ot-design.css"

export const metadata: Metadata = {
  title: "Illinois Homestead Exemption Guide — Free Download | OverTaxed IL",
  description:
    "Many Illinois homeowners miss the General Homestead Exemption. Free guide shows how to check in 5 minutes — for informational purposes only, not legal or tax advice.",
}

export default function HomesteadExemptionPage() {
  const sections = [
    {
      heading: "What the Homestead Exemption is",
      body:
        "If you own and live in your Illinois home, you may be entitled to a reduction in your assessed value. The exemption is administered by your county assessor — see your county for the current reduction amount.",
    },
    {
      heading: "How much it can be worth",
      body:
        "Savings depend on your county tax rate and the reduction amount in effect that year. Cook County publishes the current General Homestead Exemption amount and how it applies; see cookcountyassessor.com/exemptions for the figures that apply to your bill.",
    },
    {
      heading: "How to check in 5 minutes",
      body:
        "Look up your property on your county assessor's website. If \"General Homestead Exemption\" isn't listed on your property record, you may be eligible and need to apply.",
    },
    {
      heading: "How to apply",
      body:
        "Online, by mail, or in person. The guide walks you through every Illinois county with direct links and what documents you need.",
    },
    {
      heading: "Other exemptions you may be missing",
      body:
        "Senior, Senior Freeze, Persons with Disabilities, Veterans. The guide covers each and how they may stack.",
    },
    {
      heading: "How to claim back years",
      body:
        "In Cook County you may be able to recover up to 3 prior years of missed exemptions through a Certificate of Error process. Check cookcountyassessor.com for current eligibility rules.",
    },
  ]

  return (
    <div className="ot-root">
      <SiteHeader />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-10 text-center bg-white">
        <div className="inline-block bg-green-100 text-green-800 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
          FREE GUIDE — No email required
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 leading-tight">
          Are you missing the Illinois<br className="hidden sm:block" />
          <span className="text-green-600"> Homestead Exemption?</span>
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          The General Homestead Exemption reduces your assessed value if you own and live in your Illinois home. Many homeowners never claim it. Takes about 5 minutes to check.
        </p>
        <a
          href="/downloads/homestead-exemption/homestead-exemption-guide.md"
          download
          className="inline-block bg-green-600 hover:bg-green-700 text-white font-bold text-lg px-10 py-4 rounded-xl shadow-lg transition-colors"
        >
          Download free guide
        </a>
        <p className="mt-3 text-sm text-gray-500">
          Instant download · No signup · Informational only — not legal or tax advice
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-white">
        <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">What&apos;s in the guide</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {sections.map((s) => (
            <div key={s.heading} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="font-bold text-gray-900 mb-2">{s.heading}</h3>
              <p className="text-gray-600 text-sm leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-gray-50 border-y border-gray-200 py-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Verify your exemption against your county source</h2>
          <p className="text-gray-600 mb-6">
            Exemption amounts change. Check your current property record at the official county assessor site:
          </p>
          <ul className="text-sm text-gray-700 inline-block text-left space-y-1">
            <li>
              Cook County —{" "}
              <a
                href="https://www.cookcountyassessor.com/exemptions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                cookcountyassessor.com/exemptions
              </a>
            </li>
            <li>DuPage, Lake, Will, Kane, McHenry — see your local county assessor site</li>
          </ul>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-14 text-center bg-white">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">Already have the exemption?</h2>
        <p className="text-gray-600 mb-6">
          Your assessed value can still be too high relative to comparable properties. A property tax appeal addresses that separately from any exemption.
        </p>
        <Link
          href="/check"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3 rounded-xl transition-colors"
        >
          Run my free check →
        </Link>
        <p className="mt-3 text-xs text-gray-500">
          OverTaxed IL is not a law firm. We do not guarantee a reduction — county decisions are final.
        </p>
      </section>

      <SiteFooter />
    </div>
  )
}
