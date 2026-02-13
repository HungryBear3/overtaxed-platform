import Link from "next/link"
import { Mail, Clock, MessageSquare } from "lucide-react"
import { ContactForm } from "@/components/contact/ContactForm"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export const metadata = {
  title: "Contact Us | OverTaxed",
  description: "Contact OverTaxed for support, questions about property tax appeals, or billing.",
}

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-bold text-blue-900">
              Over<span className="text-blue-600">Taxed</span>
            </Link>
            <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              Back to home
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8 text-center">
          <Mail className="h-12 w-12 text-blue-600 mx-auto mb-4" />
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Contact Us</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Have questions or need help? Fill out the form below or email us and we&apos;ll get back to you within 2-3 business days.
          </p>
        </div>

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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader>
              <Clock className="h-8 w-8 text-blue-600 mb-2" />
              <CardTitle>Response Time</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 font-medium">Within 2-3 business days</p>
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
                We offer a 30-day satisfaction guarantee. See our{" "}
                <Link href="/terms" className="text-blue-600 hover:underline">
                  Terms of Service
                </Link>{" "}
                for details.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
