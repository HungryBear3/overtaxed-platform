import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

export function FinalCTA() {
  return (
    <section className="py-20 md:py-28 bg-secondary">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/30 rounded-full text-sm text-primary mb-6">
          <span className="w-1.5 h-1.5 bg-primary rounded-full" />
          Free Property Tax Check
        </div>

        {/* Headline */}
        <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl text-secondary-foreground leading-tight mb-6">
          See if your Cook County property taxes are too high
        </h2>

        {/* Subheadline */}
        <p className="text-lg md:text-xl text-secondary-foreground/70 max-w-2xl mx-auto mb-8">
          It takes under 60 seconds to check your assessment against similar properties. 
          No signup required — just enter your address.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button 
            size="lg" 
            className="w-full sm:w-auto text-base px-8 py-6 h-auto bg-primary hover:bg-primary/90 text-primary-foreground" 
            asChild
          >
            <Link href="/check">
              Start Free Check
              <ArrowRight className="ml-2 w-4 h-4" />
            </Link>
          </Button>
          <Button 
            variant="outline" 
            size="lg" 
            className="w-full sm:w-auto text-base px-8 py-6 h-auto border-primary text-primary bg-transparent hover:bg-primary hover:text-primary-foreground transition-colors" 
            asChild
          >
            <Link href="#options">
              View Appeal Options
            </Link>
          </Button>
        </div>

        {/* Trust Note */}
        <p className="text-sm text-secondary-foreground/60 mt-8">
          Join thousands of Cook County homeowners who&apos;ve checked their assessments
        </p>
      </div>
    </section>
  )
}
