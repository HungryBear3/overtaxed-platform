"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Check, Star, ArrowRight } from "lucide-react"
import Link from "next/link"
import { useScrollAnimation } from "@/hooks/use-scroll-animation"

const appealOptions = [
  {
    id: "diy",
    badge: "Best for Most Homeowners",
    recommended: true,
    title: "DIY Appeal Packet",
    price: "$69",
    priceNote: "one-time",
    description: "Everything you need to file a successful appeal yourself. Clear instructions, evidence packet, and comparable properties.",
    bestFor: "Homeowners who want full control and maximum savings",
    features: [
      "Complete evidence packet with comparables",
      "Step-by-step filing instructions",
      "Assessment analysis report",
      "Email support throughout the process",
      "Appeal deadline reminders"
    ],
    cta: "Get DIY Packet",
    ctaVariant: "default" as const
  },
  {
    id: "dfy",
    badge: "Premium Service",
    recommended: false,
    title: "Done-For-You Appeal",
    price: "$97",
    priceNote: "flat, one-time",
    description: "We handle your entire appeal from start to finish. You review and approve — we do the rest.",
    bestFor: "Busy homeowners who prefer a hands-off approach",
    features: [
      "Full appeal preparation & filing",
      "Professional evidence compilation",
      "Hearing representation (if needed)",
      "Dedicated account manager",
      "Status updates at every step",
      "100% satisfaction guarantee"
    ],
    cta: "Choose Done-For-You",
    ctaVariant: "outline" as const
  },
  {
    id: "contingency",
    badge: "For Qualifying Properties",
    recommended: false,
    title: "Contingency Appeal",
    price: "22%",
    priceNote: "of first-year savings · $0 upfront",
    description: "No upfront cost. We only get paid if we reduce your taxes. Available for properties with significant overassessment.",
    bestFor: "Higher-value properties with clear overassessment",
    features: [
      "No upfront payment required",
      "Full-service appeal handling",
      "Professional representation",
      "Only pay if you save money",
      "Available for qualifying properties"
    ],
    cta: "Check Eligibility",
    ctaVariant: "outline" as const
  }
]

export function AppealOptions() {
  const { ref, isVisible } = useScrollAnimation()
  
  return (
    <section id="options" className="py-20 md:py-28 bg-muted">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-2xl mx-auto text-center mb-16">
          <p className="text-sm font-medium text-primary uppercase tracking-wide mb-3">
            Appeal Options
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-4 text-balance">
            Choose your best path to lower taxes
          </h2>
          <p className="text-muted-foreground text-lg text-pretty">
            Whether you prefer to handle it yourself or want us to manage everything, we have an option that fits.
          </p>
        </div>

        {/* Options Grid */}
        <div ref={ref} className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {appealOptions.map((option, index) => (
            <Card 
              key={option.id} 
              className={`relative flex flex-col transition-all duration-500 ${
                option.recommended 
                  ? "card-premium-highlight" 
                  : "card-premium"
              } ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${index * 100}ms` }}
            >
              {/* Badge */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap shadow-md ${
                  option.recommended 
                    ? "bg-primary text-primary-foreground badge-shine" 
                    : "bg-secondary text-secondary-foreground"
                }`}>
                  {option.recommended && <Star className="w-3 h-3" />}
                  {option.badge}
                </span>
              </div>

              <CardHeader className="pt-8">
                <CardTitle className="text-xl">{option.title}</CardTitle>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-3xl font-bold text-foreground">{option.price}</span>
                  <span className="text-sm text-muted-foreground">{option.priceNote}</span>
                </div>
                <CardDescription className="mt-3">
                  {option.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex-1">
                {/* Best For */}
                <div className="bg-muted rounded-md p-3 mb-6">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Best for</p>
                  <p className="text-sm text-foreground">{option.bestFor}</p>
                </div>

                {/* Features */}
                <ul className="space-y-3">
                  {option.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="pt-4">
                <Button 
                  variant={option.ctaVariant} 
                  className={`w-full btn-premium ${option.recommended ? 'shadow-lg' : ''}`}
                  size="lg"
                  asChild
                >
                  <Link href="/pricing">
                    {option.cta}
                    <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
