import { Zap, Scale, Eye, MapPinned, ArrowRight } from "lucide-react"

const benefits = [
  {
    icon: Zap,
    title: "Easier than going it alone",
    description: "Our property analysis and evidence packets take the guesswork out of appeals. No hunting for comparables or deciphering Cook County forms."
  },
  {
    icon: Scale,
    title: "Lower friction than hiring an attorney",
    description: "Traditional property tax attorneys charge high fees and make the process feel more complicated than it needs to be. We keep it simple."
  },
  {
    icon: Eye,
    title: "Transparent at every step",
    description: "Know exactly what you&apos;re getting and what it costs. No hidden fees, no surprises, no pressure tactics."
  },
  {
    icon: MapPinned,
    title: "Local Cook County expertise",
    description: "We specialize in Cook County assessments. Our analysis is built on local data, local comparables, and local market knowledge."
  },
  {
    icon: ArrowRight,
    title: "Practical next steps",
    description: "After your free check, you&apos;ll know exactly where you stand and what to do next. No dead ends or vague recommendations."
  }
]

export function WhyChooseUs() {
  return (
    <section className="py-20 md:py-28 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Left Column - Header */}
          <div className="lg:sticky lg:top-32">
            <p className="text-sm font-medium text-primary uppercase tracking-wide mb-3">
              Why Homeowners Choose Us
            </p>
            <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-6">
              The smarter way to appeal your property taxes
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed mb-8">
              Most Cook County homeowners either overpay because they don&apos;t know how to appeal, 
              or they avoid it because it seems too complicated. We created OverTaxed IL to fix that.
            </p>
            <div className="p-6 bg-secondary rounded-lg">
              <p className="text-secondary-foreground font-medium mb-2">
                Did you know?
              </p>
              <p className="text-secondary-foreground/80 text-sm">
                Over 50% of Cook County homeowners who appeal their property taxes win some form of reduction. 
                Yet less than 5% of homeowners actually file an appeal each year.
              </p>
            </div>
          </div>

          {/* Right Column - Benefits */}
          <div className="space-y-6">
            {benefits.map((benefit, index) => (
              <div 
                key={index} 
                className="flex gap-4 p-6 bg-card rounded-lg border border-border hover:border-primary/20 transition-colors"
              >
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                  <benefit.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1.5">
                    {benefit.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {benefit.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
