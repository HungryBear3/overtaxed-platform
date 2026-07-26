import { FreeCheckFormWrapper } from "@/components/check/FreeCheckFormWrapper"
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import "../ot-design.css"

export const metadata = {
  title: "Free Property Tax Assessment Check",
  description:
    "See how your Cook County assessed value compares to nearby properties. Free check — no signup. Built around Cook County Assessor and Board of Review public records.",
}

export default function CheckPage() {
  return (
    <div className="ot-root">
      <SiteHeader />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10 bg-white">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 text-green-800 text-sm font-medium mb-4">
            Free · No signup required
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Is Cook County over-assessing your property?
          </h1>
          <p className="text-lg text-gray-600">
            Enter your PIN or address. We&apos;ll compare your assessed value to nearby
            comparable properties and show the assessment-level gap against Cook County&apos;s
            10% target, and your township&apos;s appeal-window status. No account, no card.
          </p>
        </div>

        <FreeCheckFormWrapper />

        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-500 text-center">
            Don&apos;t know your PIN?{" "}
            <a
              href="https://www.cookcountyassessor.com/address-search"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Look it up by address at cookcountyassessor.com
            </a>
            .
          </p>
          <p className="text-xs text-gray-400 text-center mt-4">
            OverTaxed IL is not a law firm and does not provide legal or tax advice. We do
            not guarantee a reduction — county decisions are final.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
