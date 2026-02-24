export function TestimonialsSection() {
  const testimonials = [
    {
      quote:
        "We saved $800 this year. OverTaxed handled everything—I just added my PIN and followed their instructions. So easy.",
      name: "Homeowner",
      location: "Evanston",
      savings: "$800",
    },
    {
      quote:
        "I was skeptical about DIY appeals, but the evidence packet they gave me was professional. Filed myself and got a reduction.",
      name: "Cook County homeowner",
      location: "Chicago",
    },
    {
      quote:
        "Finally, someone who understands Cook County's township deadlines. No more scrambling at the last minute.",
      name: "Property owner",
      location: "Oak Park",
      savings: "$1,200",
    },
  ]

  return (
    <section className="mt-24">
      <h3 className="text-2xl font-bold text-center text-gray-900 mb-2">
        What Homeowners Say
      </h3>
      <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
        Cook County residents are saving on property taxes with OverTaxed.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
        {testimonials.map((t, i) => (
          <div
            key={i}
            className="border border-gray-200 rounded-lg p-6 bg-white shadow-sm hover:shadow-md transition-shadow"
          >
            <p className="text-gray-700 mb-4 italic">&ldquo;{t.quote}&rdquo;</p>
            <div className="flex flex-col">
              <span className="font-medium text-gray-900 text-sm">{t.name}</span>
              <span className="text-gray-500 text-sm">{t.location}</span>
              {t.savings && (
                <span className="text-green-600 font-semibold text-sm mt-1">
                  Saved {t.savings}/year
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
