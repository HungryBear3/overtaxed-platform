import React from 'react'

export default function Hero() {
  return (
    <section className="bg-navy text-white py-16 px-4">
      <div className="max-w-3xl mx-auto text-center">
        <div className="inline-block bg-amber-500 text-white text-sm font-semibold px-3 py-1 rounded-full mb-4">
          2026 Reassessment Cycle — Townships Open Now
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold mb-4">
          Cook County Property Taxes Too High? Appeal in Minutes.
        </h1>
        <p className="text-lg sm:text-xl mb-8">
          South district townships are in the 2026 reassessment cycle. Homeowners who appeal save an average of $1,200+/year.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <a
            href="/check"
            className="bg-white text-navy hover:bg-gray-100 font-semibold py-3 px-6 rounded"
          >
            Start Free Check
          </a>
          <a
            href="/pricing"
            className="border-2 border-white text-white font-semibold py-3 px-6 rounded"
          >
            See Pricing
          </a>
        </div>
      </div>
    </section>
  )
}
