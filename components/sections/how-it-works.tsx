"use client"

import { Home, Search, FileCheck, Send } from "lucide-react"
import { useScrollAnimation } from "@/hooks/use-scroll-animation"

const steps = [
  {
    icon: Home,
    number: "01",
    title: "Enter your property",
    description: "Start by entering your address or property PIN. We pull the latest data directly from Cook County records."
  },
  {
    icon: Search,
    number: "02",
    title: "Review your assessment",
    description: "See how your property compares to similar homes. We highlight potential overassessment and estimated savings."
  },
  {
    icon: FileCheck,
    number: "03",
    title: "Choose your appeal path",
    description: "Select DIY for maximum control, Done-For-You for convenience, or explore contingency if eligible."
  },
  {
    icon: Send,
    number: "04",
    title: "File your appeal",
    description: "Submit yourself with our easy-to-follow packet, or let our team handle everything start to finish."
  }
]

export function HowItWorks() {
  const { ref, isVisible } = useScrollAnimation()
  
  return (
    <section id="how-it-works" className="py-20 md:py-28 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-2xl mx-auto text-center mb-16">
          <p className="text-sm font-medium text-primary uppercase tracking-wide mb-3">
            How It Works
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-4 text-balance">
            Four simple steps to lower taxes
          </h2>
          <p className="text-muted-foreground text-lg text-pretty">
            From property check to appeal submission, we make the process clear and straightforward.
          </p>
        </div>

        {/* Steps Grid */}
        <div ref={ref} className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
          {steps.map((step, index) => (
            <div 
              key={index} 
              className={`relative transition-all duration-500 ${
                isVisible 
                  ? 'opacity-100 translate-y-0' 
                  : 'opacity-0 translate-y-8'
              }`}
              style={{ transitionDelay: `${index * 100}ms` }}
            >
              {/* Connector Line (desktop only) */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-10 left-[60%] w-full h-px bg-gradient-to-r from-border to-transparent" />
              )}
              
              <div className="relative card-premium rounded-xl p-6">
                {/* Step Number Badge */}
                <div className="absolute -top-3 left-6">
                  <span className="inline-block px-2.5 py-1 bg-primary text-primary-foreground text-xs font-bold rounded-md shadow-sm badge-shine">
                    {step.number}
                  </span>
                </div>

                {/* Icon */}
                <div className="w-14 h-14 bg-gradient-to-br from-secondary/10 to-secondary/5 rounded-xl flex items-center justify-center mb-4 mt-2 border border-secondary/10">
                  <step.icon className="w-7 h-7 text-secondary" />
                </div>

                {/* Content */}
                <h3 className="font-semibold text-foreground mb-2 text-lg">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
