import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Download Your Appeal Packet | OverTaxed IL",
  description: "Thank you for your purchase. Download your Illinois Property Tax Appeal Packet below.",
}

const downloads = [
  {
    filename: "cover-letter-template.md",
    label: "📄 Appeal Cover Letter Template",
    desc: "Customize and use this as the first page of your appeal submission",
  },
  {
    filename: "evidence-checklist.md",
    label: "✅ Evidence Checklist",
    desc: "Everything you need to gather before filing",
  },
  {
    filename: "filing-instructions.md",
    label: "📋 Filing Instructions",
    desc: "Step-by-step guide for Cook County, collar counties, and PTAB",
  },
  {
    filename: "county-deadline-calendar.md",
    label: "📅 County Deadline Calendar",
    desc: "Appeal windows by county — don't miss your deadline",
  },
  {
    filename: "faq.md",
    label: "❓ Frequently Asked Questions",
    desc: "Answers to the 10 most common homeowner questions",
  },
]

export default function AppealPacketSuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      <header className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Link href="/" className="text-xl font-bold text-blue-700">
          OverTaxed IL
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        {/* Success Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            You&apos;re all set!
          </h1>
          <p className="text-gray-600 text-lg">
            Your Illinois Property Tax Appeal Packet is ready to download.
            Click each file below to access your documents.
          </p>
          <p className="text-gray-400 text-sm mt-2">
            Check your email for a copy of these download links.
          </p>
        </div>

        {/* Download Links */}
        <div className="space-y-3 mb-10">
          {downloads.map((item) => (
            <a
              key={item.filename}
              href={`/downloads/${item.filename}`}
              download
              className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:border-blue-300 hover:shadow-md transition-all group"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 group-hover:text-blue-700">
                  {item.label}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">{item.desc}</p>
              </div>
              <span className="text-blue-600 font-semibold text-sm flex-shrink-0">
                Download ↓
              </span>
            </a>
          ))}
        </div>

        {/* Tips */}
        <div className="bg-blue-50 rounded-xl p-6 mb-8">
          <h2 className="font-semibold text-gray-900 mb-3">Quick Start Tips</h2>
          <ol className="space-y-2 text-sm text-gray-700 list-decimal list-inside">
            <li>Check your county&apos;s appeal window in the Deadline Calendar first</li>
            <li>Look up your assessed value at your county assessor&apos;s website</li>
            <li>Gather evidence using the Checklist (comps are the most important)</li>
            <li>Fill in the Cover Letter Template with your property details</li>
            <li>Follow the Filing Instructions to submit your appeal</li>
          </ol>
        </div>

        {/* Upsell nudge */}
        <div className="text-center border border-gray-200 rounded-xl p-6 bg-white">
          <p className="text-gray-600 mb-3 text-sm">
            Want us to handle the whole thing for you?
          </p>
          <Link
            href="/#pricing"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors inline-block"
          >
            See Full-Service Plans →
          </Link>
        </div>
      </main>

      <footer className="text-center py-8 text-gray-400 text-sm">
        <p>© {new Date().getFullYear()} OverTaxed IL</p>
      </footer>
    </div>
  )
}
