import Link from "next/link"
import { HelpCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import "../ot-design.css"

export const metadata = {
  title: "FAQ | OverTaxed IL",
  description: "Frequently asked questions about Cook County property tax appeals, DIY comp packets, and OverTaxed IL services.",
}

const faqs = [
  {
    q: "What is a property tax appeal?",
    a: "A property tax appeal is a formal request to lower your property's assessed value. In Illinois, your property taxes are based on the assessed value set by the county assessor. If you believe your assessment is too high compared to similar properties, you can file an appeal with the Cook County Assessor or Board of Review. A successful appeal can reduce your assessment and lower your tax bill — though decisions are made by the county and there is no guarantee of a reduction.",
  },
  {
    q: "What is a PIN?",
    a: "A PIN (Property Identification Number) is a unique 14-digit number assigned to each property by the county assessor. In Cook County, you can find your PIN on your property tax bill or by searching the Cook County Assessor website. We use your PIN to look up your property, pull assessment data, and generate comparable sales for your appeal.",
  },
  {
    q: "What is the Cook County appeal deadline?",
    a: "Cook County uses a township-based calendar. Each township has its own appeal window — typically you have 30 days from when your township's new assessments are published to file. Deadlines vary by township and year. OverTaxed IL tracks every township's window on the deadlines page and can email you a reminder before your window closes.",
  },
  {
    q: "DIY packet vs. done-for-you — which should I pick?",
    a: "DIY ($69 one-time per property): We build the comp packet (comparable sales and supporting evidence). You file the appeal yourself at the Cook County Assessor portal — filing there is free. Done-for-you ($97 one-time per property): We prepare the packet and submit the appeal on your behalf where the county process supports it. Both options include the same comp evidence and equity-ratio analysis.",
  },
  {
    q: "Do you file the appeal for me?",
    a: "On the Done-for-you tier ($97) we submit on your behalf where the county process supports it. On the DIY tier ($69) you file yourself at the Cook County Assessor portal at cookcountyassessor.com/file-appeal — the packet is formatted so you can submit it in one focused session once your evidence is ready.",
  },
  {
    q: "How many comparable properties (comps) do I need?",
    a: "For a strong appeal, Cook County typically expects at least 3 comparable sales (recent sales of similar properties). Our comp packet includes comparable sales from Cook County Open Data. The 'at least 3 comparable sales' guidance comes from Cook County Assessor requirements; Board of Review Rule 15 is a separate document-submission rule (it governs which documents must accompany an appeal, not the comp count).",
  },
  {
    q: "What is Board of Review Rule 15?",
    a: "Board of Review (BOR) Rule 15 governs what documents to file with your appeal (e.g., copies of Assessor submissions, brief, other evidence). It does not specify how many comps you need. The 'at least 3 comparable sales' guidance comes from Cook County Assessor requirements. For class 2 residential (typical single-family homes), BOR Rule 15 exempts you from the brief and Historical Summary Form.",
  },
  {
    q: "What happens after I file?",
    a: "After you submit at the Cook County Assessor portal, you'll receive a Filing ID and Docket Number by email — keep them for your records. The Assessor reviews your appeal (typically within a few months). If approved, your assessment is reduced and your next tax bill reflects the lower value. You can also check status at the Cook County portal. If denied, you can appeal again in a future year or to the Board of Review.",
  },
  {
    q: "What if my appeal is denied?",
    a: "The county assessor or board of review decides appeals. Denials can happen for many reasons. OverTaxed IL does not guarantee a reduction — county decisions are final. We focus on building strong, evidence-backed appeals to improve your odds. You can always appeal again in a future year if your assessment changes.",
  },
  {
    q: "How do I get a refund?",
    a: "We offer a procedural money-back guarantee on the DIY and Done-for-you packets: if your township denies the filing on procedural grounds, we refund the packet. Contact us at support@overtaxed-il.com. See our Terms of Service for full details.",
  },
  {
    q: "Are you a law firm?",
    a: "No. OverTaxed IL is not a law firm and does not provide legal or tax advice. We organize public Cook County records into the format the Assessor and Board of Review accept. For complex situations or legal advice, consult a licensed Illinois attorney or property tax consultant.",
  },
  {
    q: "Do you support HOA or condo associations?",
    a: "We're rolling out HOA / condo board support for the 2026 cycle. If your association manages multiple PINs and wants a bulk packet, use the HOA section on the homepage or email support@overtaxed-il.com — no attorney referral required.",
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
        <p className="text-gray-500 mb-8">
          Common questions about property tax appeals, Cook County, and OverTaxed IL.
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
