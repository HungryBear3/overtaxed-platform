import Link from "next/link"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Navigation */}
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-900">Overtaxed</h1>
          <div className="flex items-center gap-6">
            <Link
              href="/pricing"
              className="text-gray-600 hover:text-gray-900 font-medium"
            >
              Pricing
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

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Lower Your Property Taxes
            <br />
            <span className="text-blue-600">Automatically</span>
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
            Overtaxed monitors your Cook County property assessments and files appeals 
            automatically when you&apos;re being overtaxed. Save money without the hassle.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/auth/signup"
              className="bg-blue-600 text-white px-8 py-3 rounded-md hover:bg-blue-700 font-medium text-lg"
            >
              Start Saving Now
            </Link>
            <Link
              href="#how-it-works"
              className="border border-gray-300 text-gray-700 px-8 py-3 rounded-md hover:bg-gray-50 font-medium text-lg"
            >
              How It Works
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Automatic Monitoring</h3>
            <p className="text-gray-600">
              We monitor Cook County assessments and alert you when your property is overvalued.
            </p>
          </div>

          <div className="text-center p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Data-Driven Appeals</h3>
            <p className="text-gray-600">
              Our system finds the best comparable properties to build a compelling case.
            </p>
          </div>

          <div className="text-center p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Save Money</h3>
            <p className="text-gray-600">
              Homeowners save an average of $500-$1,500 per year on property taxes.
            </p>
          </div>
        </div>

        {/* Pricing Preview */}
        <div id="how-it-works" className="mt-24">
          <h3 className="text-2xl font-bold text-center text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h3>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Choose the option that works for you. DIY with professional-grade evidence, 
            or let us handle everything automatically.
          </p>

          {/* DIY reports only */}
          <div className="max-w-md mx-auto mb-12">
            <div className="border border-gray-200 rounded-lg p-8 bg-gray-50">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-lg font-semibold text-gray-900">DIY reports only</h4>
                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">Comps only</span>
              </div>
              <p className="text-3xl font-bold text-gray-900 mt-2">$69</p>
              <p className="text-gray-500">one-time, per property</p>
              <p className="text-sm text-gray-600 mt-4 mb-4">
                Get professional-grade comparable analysis and evidence packet. 
                You file the appeal yourself for free with the county.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center text-gray-600 text-sm">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Rule 15-compliant comparable analysis
                </li>
                <li className="flex items-center text-gray-600 text-sm">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  PDF evidence packet ready to submit
                </li>
                <li className="flex items-center text-gray-600 text-sm">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
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
            We monitor, file, and track your appeals automatically. Never miss a deadline.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {/* Flat Fee */}
            <div className="border-2 border-blue-500 rounded-lg p-8 relative">
              <div className="absolute top-0 right-0 bg-blue-500 text-white text-xs px-3 py-1 rounded-bl-lg rounded-tr-lg">
                Simple & Predictable
              </div>
              <h5 className="font-semibold text-gray-900 text-lg">$149/property/year</h5>
              <p className="text-3xl font-bold text-gray-900 mt-2">$149</p>
              <p className="text-gray-500">per property, per year</p>
              <p className="text-sm text-gray-600 mt-4 mb-4">
                Know exactly what you&apos;ll pay. Perfect for homeowners who want 
                predictable costs and hands-off automation.
              </p>
              <ul className="space-y-3 text-sm text-gray-600">
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Automatic assessment monitoring
                </li>
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  We file the appeal for you
                </li>
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Deadline tracking & reminders
                </li>
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Appeal status updates
                </li>
              </ul>
            </div>

            {/* Performance */}
            <div className="border border-gray-200 rounded-lg p-8 bg-gradient-to-br from-green-50 to-white">
              <h5 className="font-semibold text-gray-900 text-lg">Performance</h5>
              <p className="text-3xl font-bold text-gray-900 mt-2">4%</p>
              <p className="text-gray-500">of 3-year tax savings (deferred)</p>
              <p className="text-sm text-gray-600 mt-4 mb-4">
                Pay only when you save. No upfront cost, no risk. 
                We succeed when you succeed.
              </p>
              <ul className="space-y-3 text-sm text-gray-600">
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Everything in Flat Fee
                </li>
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  No payment if no savings
                </li>
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  6-8× cheaper than attorneys
                </li>
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Unlimited properties
                </li>
              </ul>
            </div>

            {/* Commercial: per-property */}
            <div className="max-w-2xl mx-auto mt-12 p-6 rounded-lg border border-gray-200 bg-white">
              <h5 className="font-semibold text-gray-900 text-lg mb-2">Commercial (3–20 properties)</h5>
              <p className="text-sm text-gray-600 mb-4">
                Simple per-property pricing. Volume discounts for larger portfolios.
              </p>
              <ul className="space-y-2 text-sm text-gray-700">
                <li><strong>Growth (3–9):</strong> $125/property/year · 3 = $375/yr · 9 = $1,125/yr</li>
                <li><strong>Portfolio (10–20):</strong> $100/property/year · 10 = $1,000/yr · 20 = $2,000/yr</li>
              </ul>
              <p className="text-xs text-gray-500 mt-3">
                20+ properties? <Link href="/pricing" className="text-blue-600 hover:underline">Contact us</Link> for custom pricing.
              </p>
            </div>
          </div>

          <p className="text-center text-sm text-gray-500 mt-8">
            <Link href="/pricing" className="text-blue-600 hover:underline">View full pricing</Link> · Have questions? <span className="text-blue-600">Contact us</span>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-200 mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex justify-between items-center">
            <p className="text-gray-500 text-sm">
              &copy; {new Date().getFullYear()} Overtaxed. All rights reserved.
            </p>
            <div className="flex gap-6">
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
  )
}
