import Link from "next/link"
import { CalendarDays, Mail, Clock, MessageSquare, Phone } from "lucide-react"
import { ContactForm } from "@/components/contact/ContactForm"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { OT_PUBLIC_CONTACT, SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import "../ot-design.css"

export const metadata = {
  title: "Contact Us | OverTaxed IL",
  description: "Contact OverTaxed IL for support, questions about property tax appeals, or billing.",
}

export default function ContactPage() {
  return (
    <div className="ot-root">
      <SiteHeader />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-white">
        <div className="mb-8 text-center p-8 rounded-2xl bg-gradient-to-b from-blue-50/80 to-transparent">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
            <Mail className="h-8 w-8 text-blue-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Contact Us</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
Have questions or need help? Fill out the form, email us, call or text, or schedule a short call.
          </p>
        </div>


        <Card className="border-blue-200 bg-blue-50 mb-8">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl">Talk with OverTaxed IL</CardTitle>
            <CardDescription className="text-base">
              Founder-led support for homeowner questions before you buy.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-center">
            <a href={OT_PUBLIC_CONTACT.calendlyUrl}>
              <Button className="w-full justify-center">
                <CalendarDays className="h-5 w-5 mr-2" />
                Schedule a 30-minute call
              </Button>
            </a>
            <a href={OT_PUBLIC_CONTACT.phoneHref}>
              <Button variant="outline" className="w-full justify-center border-blue-600 text-blue-700 hover:bg-blue-100">
                <Phone className="h-5 w-5 mr-2" />
                Call or text {OT_PUBLIC_CONTACT.phoneDisplay}
              </Button>
            </a>
            <p className="sm:col-span-2 text-sm text-blue-900">
              9am–5pm CT · response within one business day · OverTaxed IL is not a law firm.
            </p>
          </CardContent>
        </Card>

        <div className="mb-8">
          <ContactForm />
        </div>

        <Card className="shadow-lg border border-gray-200 bg-gray-50 mb-8">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl">Prefer to Email Directly?</CardTitle>
            <CardDescription className="text-base">
              You can also reach us at
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <a
              href="mailto:support@overtaxed-il.com"
              className="inline-block text-xl font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              support@overtaxed-il.com
            </a>
            <div>
              <a href="mailto:support@overtaxed-il.com">
                <Button variant="outline" className="border-blue-600 text-blue-600 hover:bg-blue-50">
                  <Mail className="h-5 w-5 mr-2" />
                  Open Email Client
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-blue-50 mb-8">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-blue-900">HOA or condo association?</CardTitle>
            <CardDescription className="text-blue-800">
              We help associations check bulk PINs for over-assessment. Pick the &quot;HOA/condo&quot; subject in the form above (or email support@overtaxed-il.com) and tell us how many PINs you manage. We&apos;ll respond with a packet plan — no legal-representation claim, no per-unit upsell.
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader>
              <Clock className="h-8 w-8 text-blue-600 mb-2" />
              <CardTitle>Response Time</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 font-medium">Within one business day</p>
              <p className="text-sm text-gray-500 mt-3">
                For refund requests or urgent matters, include &quot;URGENT&quot; in your subject line.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <MessageSquare className="h-8 w-8 text-blue-600 mb-2" />
              <CardTitle>Before You Email</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700">
                Check our{" "}
                <Link href="/faq" className="text-blue-600 hover:underline">
                  FAQ page
                </Link>{" "}
                for answers to common questions about appeals, DIY vs full automation, and Cook County deadlines.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Mail className="h-8 w-8 text-blue-600 mb-2" />
              <CardTitle>Refund Requests</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700">
                Use the Refund Request category for billing or procedural-guarantee questions.
                Our money-back guarantee applies when an OverTaxed IL procedural error causes
                the county to reject the filing. See our{" "}
                <Link href="/terms" className="text-blue-600 hover:underline">
                  Terms of Service
                </Link>{" "}
                for details. Mark only filing errors or missed-deadline issues as URGENT.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
