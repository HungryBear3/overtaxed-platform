import React from 'react'

const stats = [
  { number: '$1,200+', label: 'avg. savings/year' },
  { number: 'No win,', label: 'no fee option' },
  { number: 'Cook County', label: 'specialists' },
  { number: '5 min', label: 'to start' },
]

export default function TrustBar() {
  return (
    <section className="bg-white border-b border-gray-100 py-8 px-4">
      <div className="max-w-4xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
        {stats.map((stat, i) => (
          <div key={i} className="flex flex-col items-center">
            <span className="text-2xl font-bold" style={{ color: '#1e3a5f' }}>{stat.number}</span>
            <span className="text-sm text-gray-500 mt-0.5">{stat.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
