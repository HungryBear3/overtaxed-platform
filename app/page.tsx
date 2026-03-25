import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { Logo } from "@/components/navigation/Logo"
import {
  TestimonialsSection,
  HowItWorksSection,
  StatsBar,
  CookCountyBadge,
  WhatIsHappeningNow,
  Hero,
  TrustBar,
  HowItWorks,
} from "@/components/home"

export const metadata: Metadata = {
  title: "Cook County Property Tax Appeal | Start Free Check",
  description: "Appeal your Cook County property taxes in minutes. 2026 reassessment cycle is open for south district townships. Homeowners who appeal save $1,200+/year on average.",
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "OverTaxed IL",
  url: "https://www.overtaxed-il.com",
  description: "Automated Cook County property tax appeal service. We find comparable properties and help you file your appeal.",
  areaServed: {
    "@type": "AdministrativeArea",
    name: "Cook County, Illinois",
  },
  serviceType: "Property Tax Appeal",
}

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Navigation */}
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex justify-between items-center">
          <Logo href="/" />
          <div className="flex items-center gap-6">
            <Link
              href="/pricing"
              className="text-gray-600 hover:text-gray-900 font-medium"
            >
              Pricing
            </Link>
            <Link
              href="/check"
              className="text-gray-600 hover:text-gray-900 font-medium"
            >
              Free check
            </Link>
            <Link
              href="/townships"
              className="text-gray-600 hover:text-gray-900 font-medium"
            >
              Deadlines
            </Link>
            <Link
              href="#how-it-works"
              className="text-gray-600 hover:text-gray-900 font-medium"
            >
              How It Works
            </Link>
            <Link
              href="/auth/signin"
              className="text-blue-600 hover:text-blue-500 font-medium"
            >
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* New Hero — navy/amber conversion design */}
      <Hero />
      <TrustBar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* What's Happening Right Now */}
        <WhatIsHappeningNow />

        {/* Features */}
        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Automatic Monitoring
            </h3>
            <p className="text-gray-600">
              We monitor Cook County assessments and alert you when your property
              is overvalued.
            </p>
          </div>

          <div className="text-center p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Data-Driven Appeals
            </h3>
            <p className="text-gray-600">
              Our system finds the best comparable properties to build a
              compelling case.
            </p>
          </div>

          <div className="text-center p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Save Money
            </h3>
            <p className="text-gray-600">
              Homeowners save an average of $500-$1,500 per year on property
              taxes.
            </p>
          </div>
        </div>

        {/* How It Works */}
        <HowItWorks />

        {/* Testimonials */}
        <TestimonialsSection />

        {/* Pricing Preview */}
        <div id="pricing" className="mt-12">
          <h3 className="text-2xl font-bold text-center text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h3>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Choose the option that works for you. DIY with professional-grade
            evidence, or let us handle everything automatically.
          </p>

          {/* DIY reports only */}
          <div className="max-w-md mx-auto mb-12">
            <div className="border border-gray-200 rounded-lg p-8 bg-gray-50">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-lg font-semibold text-gray-900">
                  DIY reports only
                </h4>
                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                  Comps only
                </span>
              </div>
              <p className="text-3xl font-bold text-gray-900 mt-2">$69</p>
              <p className="text-gray-500">one-time, per property</p>
              <p className="text-sm text-gray-600 mt-4 mb-4">
                Get professional-grade comparable analysis and evidence packet.
                You file the appeal yourself for free with the county.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center text-gray-600 text-sm">
                  <svg
                    className="w-5 h-5 text-green-500 mr-2 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Comparable sales analysis
                </li>
                <li className="flex items-center text-gray-600 text-sm">
                  <svg
                    className="w-5 h-5 text-green-500 mr-2 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  PDF evidence packet ready to submit
                </li>
                <li className="flex items-center text-gray-600 text-sm">
                  <svg
                    className="w-5 h-5 text-green-500 mr-2 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Stronger evidence than most DIY appeals
                </li>
              </ul>
            </div>
          </div>

          {/* Full Automation Options */}
          <h4 className="text-xl font-semibold text-center text-gray-900 mb-6">
            Full Automation
          </h4>
          <p className="text-center text-gray-600 mb-8">
            We monitor, file, and track your appeals automatically. Never miss a
            deadline.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {/* Starter - 1-2 properties */}
            <div className="border-2 border-blue-500 rounded-lg p-6 relative">
              <div className="absolute top-0 right-0 bg-blue-500 text-white text-xs px-3 py-1 rounded-bl-lg rounded-tr-lg">
                1–2 properties
              </div>
              <h5 className="font-semibold text-gray-900 text-lg">Starter</h5>
              <p className="text-2xl font-bold text-gray-900 mt-2">$149</p>
              <p className="text-gray-500 text-sm">per property/year</p>
              <p className="text-xs text-gray-600 mt-2">
                1 = $149/yr · 2 = $298/yr
              </p>
              <p className="text-sm text-gray-600 mt-3 mb-3">
                Per property. Perfect for 1–2 properties.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start">
                  <svg
                    className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Full automation
                </li>
                <li className="flex items-start">
                  <svg
                    className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  We file for you
                </li>
              </ul>
            </div>

            {/* Growth - 3-9 properties */}
            <div className="border-2 border-emerald-500 rounded-lg p-6 bg-white relative">
              <div className="absolute top-0 right-0 bg-emerald-500 text-white text-xs px-3 py-1 rounded-bl-lg rounded-tr-lg">
                3–9 properties
              </div>
              <h5 className="font-semibold text-gray-900 text-lg">Growth</h5>
              <p className="text-2xl font-bold text-gray-900 mt-2">$124</p>
              <p className="text-gray-500 text-sm">per property/year</p>
              <p className="text-xs text-gray-600 mt-2">
                3–9 properties · 3 = $372 · 9 = $1,116/yr
              </p>
              <p className="text-sm text-gray-600 mt-3 mb-3">
                Volume discount for 3–9 properties.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start">
                  <svg
                    className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Full automation
                </li>
                <li className="flex items-start">
                  <svg
                    className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Priority support
                </li>
              </ul>
            </div>

            {/* Portfolio - 10-20 properties */}
            <div className="border-2 border-indigo-500 rounded-lg p-6 bg-white relative">
              <div className="absolute top-0 right-0 bg-indigo-500 text-white text-xs px-3 py-1 rounded-bl-lg rounded-tr-lg">
                10–20 properties
              </div>
              <h5 className="font-semibold text-gray-900 text-lg">Portfolio</h5>
              <p className="text-2xl font-bold text-gray-900 mt-2">$99</p>
              <p className="text-gray-500 text-sm">per property/year</p>
              <p className="text-xs text-gray-600 mt-2">
                10–20 properties · 10 = $990 · 20 = $1,980/yr
              </p>
              <p className="text-sm text-gray-600 mt-3 mb-3">
                Best rate for 10–20 properties.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start">
                  <svg
                    className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Full automation
                </li>
                <li className="flex items-start">
                  <svg
                    className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Priority + phone
                </li>
              </ul>
            </div>

            {/* Performance */}
            <div className="border border-gray-200 rounded-lg p-6 bg-gradient-to-br from-green-50 to-white">
              <h5 className="font-semibold text-gray-900 text-lg">Performance</h5>
              <p className="text-2xl font-bold text-gray-900 mt-2">4%</p>
              <p className="text-gray-500 text-sm">
                of 3-year savings (deferred)
              </p>
              <p className="text-sm text-gray-600 mt-3 mb-3">
                Pay only when you save. No upfront cost.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start">
                  <svg
                    className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Unlimited properties
                </li>
                <li className="flex items-start">
                  <svg
                    className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  No payment if no savings
                </li>
              </ul>
            </div>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            20+ properties?{" "}
            <Link href="/pricing" className="text-blue-600 hover:underline">
              Contact us
            </Link>{" "}
            for custom pricing.
          </p>

          <p className="text-center text-sm text-gray-500 mt-8">
            <Link href="/pricing" className="text-blue-600 hover:underline">
              View full pricing
            </Link>{" "}
            · Have questions?{" "}
            <a href="https://calendly.com/overtaxed-il-support/15min" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              Book a free 15-min call
            </a>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-200 mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex justify-between items-center">
            <p className="text-gray-500 text-sm">
              &copy; {new Date().getFullYear()} OverTaxed IL. All rights reserved.
            </p>
            <div className="flex flex-wrap gap-6">
              <Link href="/townships" className="text-gray-500 hover:text-gray-700 text-sm">
                Township Deadlines
              </Link>
              <Link href="/board-of-review" className="text-gray-500 hover:text-gray-700 text-sm">
                Board of Review
              </Link>
              <Link href="/terms" className="text-gray-500 hover:text-gray-700 text-sm">
                Terms
              </Link>
              <Link href="/privacy" className="text-gray-500 hover:text-gray-700 text-sm">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
    </>
  )
}
