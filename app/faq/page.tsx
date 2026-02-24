import Link from "next/link"
import { HelpCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Logo } from "@/components/navigation/Logo"

export const metadata = {
  title: "FAQ | OverTaxed",
  description: "Frequently asked questions about property tax appeals, Cook County, DIY comps, and OverTaxed services.",
}

const faqs = [
  {
    q: "What is a property tax appeal?",
    a: "A property tax appeal is a formal request to lower your property's assessed value. In Illinois, your property taxes are based on the assessed value set by the county assessor. If you believe your assessment is too high compared to similar properties, you can file an appeal with the Cook County Assessor or Board of Review. A successful appeal can reduce your assessment and lower your tax bill.",
  },
  {
    q: "What is a PIN?",
    a: "A PIN (Property Identification Number) is a unique 14-digit number assigned to each property by the county assessor. In Cook County, you can find your PIN on your property tax bill or by searching the Cook County Assessor website. We use your PIN to look up your property, pull assessment data, and generate comparable sales for your appeal.",
  },
  {
    q: "What is the Cook County appeal deadline?",
    a: "Cook County uses a township-based calendar. Each township has its own appeal window—typically you have 30 days from when your township's new assessments are published to file. Deadlines vary by township and year. OverTaxed helps you track your township's deadline and reminds you before it closes.",
  },
  {
    q: "What's the difference between DIY (comps-only) and full automation?",
    a: "DIY ($69/property): We generate a comp packet (Rule 15–compliant comparables and evidence) so you can file the appeal yourself at the Cook County Assessor portal for free. Full automation (Starter, Growth, Portfolio): We monitor your assessments, alert you to increases, prepare appeals and comps, and guide you through filing. PIN monitoring and deadline notifications are included in full automation; they are not included in DIY.",
  },
  {
    q: "Do you file the appeal for me?",
    a: "Today, the Cook County Assessor has not released a public e-filing API, so we cannot submit appeals on your behalf. We prepare the packet (comps, summary, PDF) and give you clear instructions to file at cookcountyassessor.com/file-appeal. Once Cook County releases an API, we will add filing-on-behalf for Starter and above.",
  },
  {
    q: "How many comparable properties (comps) do I need?",
    a: "For a strong appeal, Cook County typically expects at least 3 sales comps (recent sales of similar properties) and 5 equity comps (similar properties with lower assessments). Our comp packet meets Rule 15 requirements. We pull data from Cook County Open Data and optionally enrich with Realie (when you have a paid plan) for better coverage.",
  },
  {
    q: "What if my appeal is denied?",
    a: "The county assessor or board of review decides appeals. Denials can happen for many reasons. OverTaxed does not guarantee a reduction—county decisions are final. We focus on building strong, evidence-backed appeals to improve your odds. You can always appeal again in a future year if your assessment changes.",
  },
  {
    q: "How do I get a refund?",
    a: "We offer a 30-day satisfaction guarantee for subscription plans. Contact us at support@overtaxed-il.com within 30 days of your initial signup to request a refund. See our Terms of Service for full details.",
  },
]

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Logo href="/" />
            <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              Back to home
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center gap-3 mb-2">
          <HelpCircle className="h-8 w-8 text-blue-600 flex-shrink-0" />
          <h1 className="text-3xl font-bold text-gray-900">Frequently Asked Questions</h1>
        </div>
        <p className="text-gray-500 mb-8">
          Common questions about property tax appeals, Cook County, and OverTaxed.
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
    </div>
  )
}
