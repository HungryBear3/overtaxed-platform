import React from 'react'

export default function Hero() {
  return (
    <section
      className="text-white py-20 px-4 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0f2744 0%, #1e3a5f 50%, #162d4a 100%)',
      }}
    >
      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />
      {/* Glow accent */}
      <div
        className="absolute top-0 right-0 w-96 h-96 opacity-10 rounded-full blur-3xl"
        style={{ background: '#f59e0b', transform: 'translate(30%, -30%)' }}
      />

      <div className="relative max-w-4xl mx-auto">
        {/* Urgency badge */}
        <div className="flex justify-center mb-6">
          <span
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-1.5 rounded-full border"
            style={{ backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.4)', color: '#fbbf24' }}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
            2026 Reassessment Cycle — South District Townships Open Now
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl font-bold text-center leading-tight mb-4">
          Cook County Property Taxes{' '}
          <span style={{ color: '#fbbf24' }}>Too High?</span>
          <br className="hidden sm:block" /> Appeal in Minutes.
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-center mb-10" style={{ color: 'rgba(255,255,255,0.75)' }}>
          South district townships are in the 2026 reassessment cycle.
          Homeowners who appeal save an average of{' '}
          <strong className="text-white">$1,200+/year.</strong>
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row justify-center gap-4 mb-12">
          <a
            href="/check"
            className="inline-flex items-center justify-center font-semibold py-3.5 px-8 rounded-lg transition-all duration-200 hover:scale-105"
            style={{ backgroundColor: '#f59e0b', color: '#1e3a5f' }}
          >
            Start Free Check →
          </a>
          <a
            href="/pricing"
            className="inline-flex items-center justify-center font-semibold py-3.5 px-8 rounded-lg border-2 border-white/30 hover:border-white/60 transition-all duration-200"
            style={{ color: 'white' }}
          >
            See Pricing
          </a>
        </div>

        {/* Micro trust signals */}
        <div className="flex flex-wrap justify-center gap-6 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          <span>✓ No lawyer required</span>
          <span>✓ Cook County specialists</span>
          <span>✓ Takes 5 minutes</span>
          <span>✓ Free assessment check</span>
        </div>
      </div>
    </section>
  )
}
