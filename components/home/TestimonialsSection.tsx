function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
      <span className="text-blue-700 font-bold text-sm">{initials}</span>
    </div>
  )
}

export function TestimonialsSection() {
  const testimonials = [
    {
      quote:
        "We saved $800 this year. OverTaxed IL handled everything — I just added my PIN and followed their instructions. So easy.",
      name: "Homeowner",
      location: "Evanston",
      savings: "$800",
      stars: 5,
    },
    {
      quote:
        "I was skeptical about DIY appeals, but the evidence packet they gave me was professional. Filed myself and got a reduction.",
      name: "Cook County Homeowner",
      location: "Chicago",
      stars: 5,
    },
    {
      quote:
        "Finally, someone who understands Cook County's township deadlines. No more scrambling at the last minute.",
      name: "Property Owner",
      location: "Oak Park",
      savings: "$1,200",
      stars: 5,
    },
  ]

  return (
    <section className="mt-24">
      <h3 className="text-2xl font-bold text-center text-gray-900 mb-2">
        What Homeowners Say
      </h3>
      <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
        Cook County residents are saving on property taxes with OverTaxed IL.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
        {testimonials.map((t, i) => (
          <div
            key={i}
            className="border border-gray-200 rounded-lg p-6 bg-white shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center space-x-0.5 text-amber-400 text-sm mb-3">
              {Array.from({ length: t.stars }).map((_, si) => (
                <span key={si}>★</span>
              ))}
            </div>
            <p className="text-gray-700 mb-4 italic">&ldquo;{t.quote}&rdquo;</p>
            <div className="flex items-center space-x-3">
              <Avatar name={t.name} />
              <div>
                <span className="font-medium text-gray-900 text-sm block">{t.name}</span>
                <span className="text-gray-500 text-xs">{t.location}</span>
              </div>
            </div>
            {t.savings && (
              <span className="inline-block bg-green-100 text-green-700 rounded-full px-3 py-0.5 text-xs font-semibold mt-3">
                Saved {t.savings}/yr
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
