"use client"

import { useState, useEffect, useCallback } from "react"
import { Quote, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

const testimonials = [
  {
    quote: "I was paying $8,400 in property taxes on my home in Palatine Township. After using the DIY packet, my assessed value dropped by 18% — saving me over $1,500 annually.",
    name: "Michael R.",
    location: "Palatine Township",
    outcome: "$1,500+ annual savings",
    service: "DIY Appeal Packet"
  },
  {
    quote: "I honestly didn't think I had a case, but the free check showed my home was assessed 22% higher than comparable properties. The Done-For-You service handled everything — I just signed the forms.",
    name: "Sarah K.",
    location: "Oak Park",
    outcome: "22% assessment reduction",
    service: "Done-For-You Appeal"
  },
  {
    quote: "As a first-time homeowner, property taxes felt overwhelming. The step-by-step instructions in the DIY packet made it manageable. My appeal was approved on the first try.",
    name: "David L.",
    location: "Northbrook",
    outcome: "Appeal approved first try",
    service: "DIY Appeal Packet"
  },
  {
    quote: "We'd been overpaying for years without realizing it. The comparison report made it crystal clear our assessment was way off. Got a $2,100 refund plus lower taxes going forward.",
    name: "Jennifer & Mark T.",
    location: "Evanston Township",
    outcome: "$2,100 refund + ongoing savings",
    service: "Done-For-You Appeal"
  }
]

export function Testimonials() {
  const [current, setCurrent] = useState(0)
  const [isAutoPlaying, setIsAutoPlaying] = useState(true)

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % testimonials.length)
  }, [])

  const prev = useCallback(() => {
    setCurrent((prev) => (prev - 1 + testimonials.length) % testimonials.length)
  }, [])

  const goTo = useCallback((index: number) => {
    setCurrent(index)
    setIsAutoPlaying(false)
  }, [])

  // Auto-play
  useEffect(() => {
    if (!isAutoPlaying) return
    const interval = setInterval(next, 6000)
    return () => clearInterval(interval)
  }, [isAutoPlaying, next])

  return (
    <section className="py-20 md:py-28 bg-secondary overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-2xl mx-auto text-center mb-12">
          <p className="text-sm font-medium text-primary uppercase tracking-wide mb-3">
            Real Results
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-secondary-foreground mb-4 text-balance">
            Cook County homeowners saving real money
          </h2>
          <p className="text-secondary-foreground/60 text-lg text-pretty">
            These are actual outcomes from homeowners who took action on their property taxes.
          </p>
        </div>

        {/* Carousel */}
        <div className="relative max-w-4xl mx-auto">
          {/* Main testimonial card */}
          <div className="relative glass rounded-2xl p-8 md:p-12 shadow-2xl">
            {/* Large quote icon */}
            <Quote className="absolute top-6 left-6 md:top-8 md:left-8 w-16 h-16 text-primary/10" />
            
            {/* Content with transition */}
            <div className="relative min-h-[280px] md:min-h-[240px] flex flex-col justify-center">
              {testimonials.map((testimonial, index) => (
                <div
                  key={index}
                  className={`absolute inset-0 flex flex-col justify-center transition-all duration-500 ${
                    index === current 
                      ? 'opacity-100 translate-x-0' 
                      : index < current 
                        ? 'opacity-0 -translate-x-8' 
                        : 'opacity-0 translate-x-8'
                  }`}
                  aria-hidden={index !== current}
                >
                  {/* Quote Text */}
                  <blockquote className="text-xl md:text-2xl text-foreground leading-relaxed mb-8 font-medium">
                    &ldquo;{testimonial.quote}&rdquo;
                  </blockquote>

                  {/* Outcome Badge */}
                  <div className="inline-flex items-center self-start px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-semibold mb-6 shadow-lg">
                    {testimonial.outcome}
                  </div>

                  {/* Author Info */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground text-lg">{testimonial.name}</p>
                      <p className="text-muted-foreground">{testimonial.location}</p>
                    </div>
                    <span className="text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                      {testimonial.service}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-4 mt-8">
            <Button
              variant="outline"
              size="icon"
              onClick={() => { prev(); setIsAutoPlaying(false) }}
              className="rounded-full w-10 h-10 bg-secondary-foreground/5 border-secondary-foreground/20 text-secondary-foreground hover:bg-secondary-foreground/10"
              aria-label="Previous testimonial"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>

            {/* Dots */}
            <div className="flex items-center gap-2">
              {testimonials.map((_, index) => (
                <button
                  key={index}
                  onClick={() => goTo(index)}
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                    index === current 
                      ? 'bg-primary w-8' 
                      : 'bg-secondary-foreground/30 hover:bg-secondary-foreground/50'
                  }`}
                  aria-label={`Go to testimonial ${index + 1}`}
                />
              ))}
            </div>

            <Button
              variant="outline"
              size="icon"
              onClick={() => { next(); setIsAutoPlaying(false) }}
              className="rounded-full w-10 h-10 bg-secondary-foreground/5 border-secondary-foreground/20 text-secondary-foreground hover:bg-secondary-foreground/10"
              aria-label="Next testimonial"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
