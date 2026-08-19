import Link from "next/link"
import { HelpCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import { CC_01, CC_10, CC_11, CC_12 } from "@/lib/copy/canonical"
import "../ot-design.css"

export const metadata = {
  title: "FAQ",
  description: "Frequently asked questions about Cook County property tax appeals, DIY comp packets, and OverTaxed IL services.",
  alternates: { canonical: "https://www.overtaxed-il.com/faq" },
}

const faqs = [
  {
    q: "What is a property tax appeal?",
    // "An approved appeal can reduce your assessment and lower your tax bill"
    // is the one-to-one assessment-to-bill equivalence BL-B6 bans; CC-12,
    // rendered on this page, explicitly denies it.
    a: "A property tax appeal is a formal request to lower your property's assessed value. In Illinois, your property taxes are based on the assessed value set by the county assessor. If you believe your assessment is too high compared to similar properties, you can file an appeal with the Cook County Assessor. Decisions are made by the county, and a change in assessed value does not produce an equal change in a tax bill.",
  },
  {
    q: "What is a PIN?",
    a: "A PIN (Property Identification Number) is a unique 14-digit number assigned to each property by the county assessor. In Cook County, you can find your PIN on your property tax bill or by searching the Cook County Assessor website. We use your PIN to look up your property, pull assessment data, and generate comparable sales for your appeal.",
  },
  {
    q: "What is the Cook County appeal deadline?",
    // "typically you have 30 days from when your township's new assessments
    // are published" was a filing rule stated with no source, on the page
    // homeowners read precisely because they do not know the rule. The answer
    // points at the surface that carries a source and a retrieval time.
    a: "Cook County uses a township-based calendar, and each township has its own appeal window. We publish each township's status exactly as the county publishes it, with the source we read and the time we retrieved it, on the deadlines page. Confirm your filing deadline with the county before you file.",
  },
  // The "DIY packet vs. done-for-you" entry is removed rather than trimmed to
  // one tier: its whole subject was a choice between an offered product and
  // two held ones.
  {
    q: "Do you file the appeal for me?",
    a: `${CC_01} ${CC_10}`,
  },
  {
    q: "How many comparable properties (comps) do I need?",
    a: "For a residential assessment appeal, comparable assessments are usually more informative than raw sales alone: you are looking for similar nearby properties assessed lower than yours. Our packet is built from public-record comparable properties for an Assessor-stage appeal and explains what each piece of evidence is doing.",
  },
  {
    q: "What is Board of Review Rule 15?",
    // The old answer told a reader what "the packet should emphasize" at the
    // Board of Review, which describes our materials as serving a stage we
    // cannot serve. It is answered as general information about the Board's
    // own rules, and the page-level CC-11 notice states our position.
    a: "Board of Review Rule 15 governs what documents the Board requires with an appeal filed there — for example copies of Assessor submissions, briefs, and supporting evidence. It is a Board rule, published by the Board, and it applies to filings made at that stage rather than at the Assessor.",
  },
  {
    q: "What happens after I file?",
    a: "After you submit at the Cook County Assessor portal, you'll receive a Filing ID and Docket Number by email — keep them for your records. The Assessor reviews your appeal and issues a decision. You can check status at the Cook County portal.",
  },
  {
    q: "What if my appeal is denied?",
    // "improve your odds" is a success-likelihood claim about a decision we do
    // not make. CC-12 states the position without it.
    a: `The Cook County Assessor decides appeals, and denials happen for many reasons. ${CC_12} You can appeal again in a future year if your assessment changes.`,
  },
  {
    q: "How do I get a refund?",
    // The refund rule itself is unchanged: it is a term of the Terms of
    // Service and an owner policy decision (OD-5, unsigned), not something to
    // restate differently here. Only the reference to the held Done-For-You
    // service is removed, and the answer now points at the single place the
    // rule lives so the two cannot drift apart.
    a: "If your filing is rejected or denied solely because of an OverTaxed IL procedural error in the materials we prepared, contact support@overtaxed-il.com within 30 days of the notice so we can review the issue under our Terms of Service. This does not cover county denials on the merits.",
  },
  {
    q: "Are you a law firm?",
    a: `${CC_12} We organize public Cook County records into an Assessor-stage appeal packet. For legal advice, consult a licensed Illinois attorney.`,
  },
  {
    q: "Do you support HOA or condo associations?",
    // "We're rolling out HOA / condo board support for the 2026 cycle" is a
    // dated commitment we have not made and cannot date. The answer says what
    // is true today.
    a: "Not today. If your association manages multiple PINs and wants to be told when bulk support exists, use the HOA section on the homepage or email support@overtaxed-il.com. OverTaxed IL is not a law firm and does not provide legal representation.",
  },
]

export default function FAQPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="faq" />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-white">
        <div className="flex items-center gap-3 mb-2">
          <HelpCircle className="h-8 w-8 text-blue-600 flex-shrink-0" />
          <h1 className="text-3xl font-bold text-gray-900">Frequently asked questions</h1>
        </div>
        <p className="text-gray-500 mb-6">
          Common questions about property tax appeals, Cook County, and OverTaxed IL.
        </p>

        {/* Several answers below name the Board of Review. BL-F5 requires
            CC-11 wherever it is named, and a standing notice at the top of the
            page is where a reader meets it before the answers, rather than
            repeated verbatim inside each one. */}
        <p className="text-sm text-gray-700 border border-amber-300 bg-amber-50 rounded-xl p-4 mb-8">
          {CC_11}
        </p>

        <div className="space-y-6">
          {faqs.map((faq, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{faq.q}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{faq.a}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-12 text-gray-600">
          Still have questions? <Link href="/contact" className="text-blue-600 hover:underline">Contact us</Link>.
        </p>
      </main>

      <SiteFooter />
    </div>
  )
}
