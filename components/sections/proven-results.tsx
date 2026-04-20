"use client"

import { useScrollAnimation } from "@/hooks/use-scroll-animation"

const stats = [
  { end: 1,  prefix: "$", suffix: "B+", label: "Overpaid annually by Cook County homeowners" },
  { end: 10, prefix: "",  suffix: "K+", label: "Appeals filed by Cook County homeowners each year" },
  { end: 70, prefix: "",  suffix: "%",  label: "Of appeals result in some assessment reduction" },
  { end: 1,  prefix: "$", suffix: "K+", label: "Typical annual savings for successful appellants" },
]

function formatStatValue(end: number, prefix: string, suffix: string) {
  return `${prefix}${end.toFixed(0)}${suffix}`
}

function StatCard({
  end,
  prefix,
  suffix,
  label,
  delay,
}: (typeof stats)[0] & { delay: number }) {
  return (
    <div className="text-center" style={{ transitionDelay: `${delay}ms` }}>
      <div className="text-4xl md:text-5xl font-bold text-primary mb-2 tabular-nums">
        {formatStatValue(end, prefix, suffix)}
      </div>
      <p className="text-sm text-secondary-foreground/80 leading-snug max-w-[160px] mx-auto">
        {label}
      </p>
    </div>
  )
}

export function ProvenResults() {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section className="py-16 md:py-20 bg-secondary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div
          ref={ref}
          className={`text-center mb-12 transition-all duration-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <p className="text-sm font-medium text-primary uppercase tracking-wide mb-3">
            Cook County by the numbers
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-secondary-foreground mb-4">
            The appeal opportunity is real
          </h2>
          <p className="text-secondary-foreground/70 text-base max-w-2xl mx-auto">
            These benchmarks come from Cook County Assessor&apos;s Office public records and
            Board of Review appeal data. OverTaxed IL uses that public data, enriched with
            third-party property data tools including Realie AI, to identify appeal
            opportunities for individual properties.
          </p>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12">
          {stats.map((stat, i) => (
            <StatCard key={i} {...stat} delay={i * 100} />
          ))}
        </div>

        {/* Disclaimer */}
        <p className="mt-10 text-center text-xs text-secondary-foreground/50 max-w-2xl mx-auto leading-relaxed">
          Figures reflect countywide public benchmarks from Cook County Assessor&apos;s Office and
          Board of Review records. Individual savings depend on eligibility and property-specific facts.
        </p>
      </div>
    </section>
  )
}
