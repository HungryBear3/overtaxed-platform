import React from 'react'

const stats = [
  'Avg. savings $1,200+/yr',
  'No win, no fee option',
  'Cook County specialists',
  'Takes 5 minutes',
]

export default function TrustBar() {
  return (
    <section className="bg-white border-b border-gray-100 py-8 px-4">
      <div className="max-w-4xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
        {stats.map((label, i) => (
          <div key={i} className="font-semibold text-sm sm:text-base" style={{ color: '#1e3a5f' }}>
            {label}
          </div>
        ))}
      </div>
    </section>
  )
}
