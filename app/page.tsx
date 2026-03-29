import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { Logo } from "@/components/navigation/Logo"
import { MobileStickyBar } from "@/components/MobileStickyBar"
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
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white pb-20 md:pb-0">
      <MobileStickyBar href="/check" label="Start Free Property Check →" subtext="Takes 5 minutes · No credit card" color="amber" />
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
              className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              Free Check →
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
              href="/pricing"
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
          <div className="text-center p-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)' }}>
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

          <div className="text-center p-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)' }}>
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

          <div className="text-center p-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)' }}>
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

        {/* Urgency CTA */}
        <div className="mt-10 text-center py-10 border-t border-b border-gray-100">
          <p className="text-sm font-semibold text-amber-600 uppercase tracking-wide mb-2">
            ⚡ South District Townships — Appeal Window Open Now
          </p>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Don&apos;t miss the 2026 reassessment window.
          </h2>
          <p className="text-gray-600 mb-6 max-w-lg mx-auto">
            Filing a late appeal is not an option. Run your free check now — it takes 5 minutes and tells you exactly what you could save.
          </p>
          <a
            href="/check"
            className="inline-flex items-center font-semibold py-3 px-8 rounded-lg transition-all duration-200 hover:scale-105 text-white"
            style={{ backgroundColor: '#f59e0b' }}
          >
            Run My Free Property Check →
          </a>
        </div>

        {/* DIY Appeal Packet Banner */}
        <div className="mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">New — Instant Download</p>
            <h3 className="text-lg font-bold text-gray-900">
              Want to DIY your appeal? Get the full toolkit.
            </h3>
            <p className="text-gray-600 text-sm mt-1">
              Cover letter, evidence checklist, filing instructions, deadline calendar &amp; FAQ — everything you need to appeal yourself.
            </p>
          </div>
          <Link
            href="/appeal-packet"
            className="flex-shrink-0 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors whitespace-nowrap"
          >
            DIY Appeal Toolkit — $37 →
          </Link>
        </div>

        {/* Free Resources Row */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/homestead-exemption"
            className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-5 py-4 hover:bg-green-100 transition-colors"
          >
            <span className="text-2xl">🏠</span>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Free: Homestead Exemption Guide</p>
              <p className="text-xs text-gray-500 mt-0.5">Are you missing $600–$1,500/year?</p>
            </div>
            <span className="ml-auto text-green-600 font-bold text-sm">Free →</span>
          </Link>
          <Link
            href="https://www.etsy.com/listing/4478749112"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 hover:bg-blue-100 transition-colors"
          >
            <span className="text-2xl">🚗</span>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Traffic Ticket Dispute Kit</p>
              <p className="text-xs text-gray-500 mt-0.5">Fight parking, red light &amp; speed cam tickets</p>
            </div>
            <span className="ml-auto text-blue-600 font-bold text-sm">$17 →</span>
          </Link>
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
          <p className="text-center text-gray-600 mb-8 max-w-2xl mx-auto">
            Choose the option that works for you — from DIY to done-for-you.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {/* T1 — DIY Starter */}
            <div className="border border-gray-200 rounded-xl p-6 bg-white hover:shadow-md transition-shadow">
              <h4 className="font-semibold text-gray-900 text-lg">DIY Starter</h4>
              <p className="text-3xl font-bold text-gray-900 mt-2">$37</p>
              <p className="text-gray-500 text-sm">one-time</p>
              <p className="text-sm text-gray-600 mt-3 mb-4">
                PDF packet + instructions. You find comps and file yourself.
              </p>
              <Link
                href="/pricing"
                className="block text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
              >
                Get Started →
              </Link>
            </div>

            {/* T2 — DIY Pro */}
            <div className="border-2 border-blue-500 rounded-xl p-6 bg-white relative hover:shadow-md transition-shadow">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                Most Popular
              </div>
              <h4 className="font-semibold text-gray-900 text-lg">DIY Pro</h4>
              <p className="text-3xl font-bold text-gray-900 mt-2">$69</p>
              <p className="text-gray-500 text-sm">one-time</p>
              <p className="text-sm text-gray-600 mt-3 mb-4">
                We build your comp package. You file yourself.
              </p>
              <Link
                href="/pricing"
                className="block text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
              >
                Get Started →
              </Link>
            </div>

            {/* T3 — Done-For-You */}
            <div className="border border-gray-200 rounded-xl p-6 bg-white hover:shadow-md transition-shadow">
              <h4 className="font-semibold text-gray-900 text-lg">Done-For-You</h4>
              <p className="text-3xl font-bold text-gray-900 mt-2">$97</p>
              <p className="text-gray-500 text-sm">flat, one-time</p>
              <p className="text-sm text-gray-600 mt-3 mb-4">
                We prepare everything + submit your appeal for you.
              </p>
              <Link
                href="/pricing"
                className="block text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
              >
                Get Started →
              </Link>
            </div>

            {/* T4 — Contingency */}
            <div className="border border-gray-200 rounded-xl p-6 bg-gradient-to-br from-green-50 to-white hover:shadow-md transition-shadow">
              <h4 className="font-semibold text-gray-900 text-lg">Contingency</h4>
              <p className="text-3xl font-bold text-gray-900 mt-2">22%</p>
              <p className="text-gray-500 text-sm">of first-year savings · $0 upfront</p>
              <p className="text-sm text-gray-600 mt-3 mb-4">
                We handle everything. Pay only if we win.
              </p>
              <Link
                href="/pricing"
                className="block text-center bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
              >
                Learn More →
              </Link>
            </div>
          </div>

          <p className="text-center text-sm text-gray-500 mt-8">
            <Link href="/pricing" className="text-blue-600 hover:underline font-medium">
              Compare all plans in detail →
            </Link>{" "}
            · Have questions?{" "}
            <a href="https://calendly.com/overtaxed-il-support/30min" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              Book a free call
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
