import React from 'react'

const steps = [
  { title: 'Enter your address', description: 'Tell us where your property is located.' },
  { title: 'See comparable properties', description: 'We find similar homes and their assessed values.' },
  { title: 'File your appeal', description: 'We handle the filing — you just review and submit.' },
]

export default function HowItWorks() {
  return (
    <section className="bg-gray-50 py-16 px-4" id="how-it-works">
      <div className="max-w-3xl mx-auto text-center mb-12">
        <h2 className="text-2xl sm:text-3xl font-bold" style={{ color: '#1e3a5f' }}>How It Works</h2>
        <p className="text-gray-600 mt-3">Appeal your property taxes in three simple steps.</p>
      </div>
      <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8">
        {steps.map((step, idx) => (
          <div key={idx} className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center bg-amber-500 text-white rounded-full font-bold text-lg">
              {idx + 1}
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: '#1e3a5f' }}>{step.title}</h3>
            <p className="text-gray-600 text-sm">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
