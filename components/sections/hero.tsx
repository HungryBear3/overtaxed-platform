import { Button } from "@/components/ui/button"
import { ArrowRight, Clock, Shield, Database } from "lucide-react"
import Link from "next/link"
import { ChicagoSkyline } from "@/components/chicago-skyline"

export function Hero() {
  return (
    <section id="hero" className="relative pt-24 pb-16 md:pt-32 md:pb-24 overflow-hidden">
      {/* Satellite map background with subtle overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=-88.3,41.45,-87.5,42.15&bboxSR=4326&imageSR=4326&size=1600,1000&format=png&f=image"
          alt=""
          width="1600"
          height="1000"
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            filter: 'saturate(0.4) brightness(0.35) contrast(1.1)',
            opacity: 0.6
          }}
          crossOrigin="anonymous"
        />
        {/* Gradient overlay for readability */}
        <div 
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 80% 80% at 50% 50%, transparent 0%, var(--background) 70%),
              linear-gradient(to bottom, var(--background) 0%, transparent 15%, transparent 85%, var(--background) 100%)
            `
          }}
        />
      </div>

      {/* Subtle glow accent from top - Chicago baby blue */}
      <div 
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 70% 60% at 50% 0%, oklch(0.65 0.14 230 / 0.10), transparent 60%)',
        }}
      />

      {/* Chicago Skyline - Bottom of hero */}
      <div className="absolute bottom-0 left-0 right-0 h-40 md:h-56 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
        <ChicagoSkyline className="absolute bottom-0 w-full h-full text-secondary/20" />
      </div>

      {/* Content */}
      <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-secondary/10 border border-secondary/20 rounded-full text-sm text-secondary mb-6">
            <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            Cook County Property Tax Appeals
          </div>

          {/* Headline */}
          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground leading-tight text-balance mb-6">
            Are you paying too much in property taxes?
          </h1>

          {/* Subheadline */}
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto mb-8 text-pretty">
            Cook County homeowners overpay millions each year due to incorrect assessments. 
            Check if your property is overassessed and get the best path to appeal.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <Button size="lg" className="w-full sm:w-auto text-base px-8 py-6 h-auto" asChild>
              <Link href="/check">
                Start Free Check
                <ArrowRight className="ml-2 w-4 h-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="w-full sm:w-auto text-base px-8 py-6 h-auto" asChild>
              <Link href="#how-it-works">
                See How It Works
              </Link>
            </Button>
          </div>

          {/* Trust Microcopy */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <span>No signup required</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <span>Takes under 60 seconds</span>
            </div>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              <span>Uses public Cook County data</span>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
