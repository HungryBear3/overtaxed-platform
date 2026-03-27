import type { Metadata } from "next"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/navigation/Logo"
import { DollarSign, Search, FileText, Bell } from "lucide-react"

export const metadata: Metadata = {
  title: "About OverTaxed IL | Cook County Property Tax Appeals",
  description: "OverTaxed IL helps Illinois homeowners appeal their property taxes and lower their tax bill. Learn who we are and how we work.",
}

const howItWorks = [
  {
    icon: Search,
    title: "We find your assessment",
    description:
      "Enter your PIN and we pull your current assessed value, tax history, and comparable sales from Cook County records automatically.",
  },
  {
    icon: FileText,
    title: "We build your appeal packet",
    description:
      "We generate a comp report using recent sales of similar properties — the strongest evidence in any Cook County appeal.",
  },
  {
    icon: Bell,
    title: "We track your deadlines",
    description:
      "Cook County appeal windows vary by township. We monitor your township's calendar and notify you before your window closes.",
  },
  {
    icon: DollarSign,
    title: "You save money",
    description:
      "Illinois homeowners who appeal and win save an average of $1,200+ per year. Most appeals take less than 30 minutes to file.",
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Logo href="/" />
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            Back to home
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">About OverTaxed IL</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            We help Cook County homeowners fight back against over-assessed property taxes — with data, not guesswork.
          </p>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Mission */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Why We Built This</h2>
          <p className="text-gray-700 text-lg leading-relaxed mb-4">
            Most Cook County homeowners don&apos;t know they can appeal their property tax assessment — and those who do often don&apos;t know where to start. The appeal process is time-sensitive, data-heavy, and easy to get wrong without the right tools.
          </p>
          <p className="text-gray-700 text-lg leading-relaxed">
            OverTaxed IL was built to fix that. We pull your assessment data, generate a comparable sales packet, and give you everything you need to file a strong appeal — in minutes, not weeks.
          </p>
        </div>

        {/* How it works */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {howItWorks.map((item, i) => (
              <Card key={item.title} className="border border-gray-200">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <item.icon className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-blue-600 bg-blue-50 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      <CardTitle className="text-base">{item.title}</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-12">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> OverTaxed IL is a document preparation and information tool — not a law firm. We help you prepare your appeal packet and understand the process, but we do not provide legal advice. For complex situations, consult a licensed Illinois attorney or property tax consultant.
          </p>
        </div>

        {/* CTA */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Start Your Appeal Today</h2>
          <p className="text-gray-600 mb-6">
            Check if your property is over-assessed — free, no account required.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/check">
              <Button size="lg">Check My Property Free</Button>
            </Link>
            <Link href="/appeal-packet">
              <Button size="lg" variant="outline">Get the DIY Appeal Packet</Button>
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center">
          <p className="text-sm text-gray-400">© {new Date().getFullYear()} OverTaxed IL</p>
        </div>
      </footer>
    </div>
  )
}
