"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ArrowRight, TrendingDown, Calculator, Info } from "lucide-react"
import Link from "next/link"
import { useScrollAnimation } from "@/hooks/use-scroll-animation"

// Cook County average tax rate is approximately 2.1%
const TAX_RATE = 0.021
// Average successful appeal reduces assessment by 10-20%
const AVG_REDUCTION_PERCENT = 0.15

export function SavingsCalculator() {
  const [homeValue, setHomeValue] = useState(350000)
  const [currentTax, setCurrentTax] = useState(7500)
  const { ref, isVisible } = useScrollAnimation()

  const calculations = useMemo(() => {
    // Estimated assessment is roughly 10% of market value in Cook County
    const estimatedAssessment = homeValue * 0.10
    
    // If they're paying more than expected, they might be overassessed
    const expectedTax = homeValue * TAX_RATE
    const overPayment = Math.max(0, currentTax - expectedTax)
    
    // Potential savings based on average reduction
    const potentialReduction = estimatedAssessment * AVG_REDUCTION_PERCENT
    const potentialAnnualSavings = potentialReduction * TAX_RATE * 10 // Rough multiplier for equalized value
    const adjustedSavings = Math.min(potentialAnnualSavings, currentTax * 0.25) // Cap at 25% of current taxes
    
    // 5-year savings
    const fiveYearSavings = adjustedSavings * 5

    return {
      annualSavings: Math.round(adjustedSavings),
      fiveYearSavings: Math.round(fiveYearSavings),
      monthlyImpact: Math.round(adjustedSavings / 12),
    }
  }, [homeValue, currentTax])

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  }

  return (
    <section className="py-20 md:py-28 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div 
          ref={ref}
          className={`max-w-4xl mx-auto transition-all duration-700 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-full text-sm text-primary mb-4">
              <Calculator className="w-4 h-4" />
              Savings Estimator
            </div>
            <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-4 text-balance">
              How much could you save?
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto text-pretty">
              Adjust the sliders to estimate your potential annual savings based on Cook County averages.
            </p>
          </div>

          {/* Calculator Card */}
          <div className="card-premium rounded-2xl p-8 md:p-10">
            <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
              {/* Inputs */}
              <div className="space-y-8">
                {/* Home Value Slider */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <label className="font-medium text-foreground">Estimated Home Value</label>
                    <span className="text-xl font-bold text-primary">{formatCurrency(homeValue)}</span>
                  </div>
                  <Slider
                    value={[homeValue]}
                    onValueChange={([value]) => setHomeValue(value)}
                    min={100000}
                    max={1500000}
                    step={25000}
                    className="py-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-2">
                    <span>$100k</span>
                    <span>$1.5M</span>
                  </div>
                </div>

                {/* Current Tax Slider */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <label className="font-medium text-foreground">Current Annual Property Tax</label>
                    <span className="text-xl font-bold text-primary">{formatCurrency(currentTax)}</span>
                  </div>
                  <Slider
                    value={[currentTax]}
                    onValueChange={([value]) => setCurrentTax(value)}
                    min={2000}
                    max={30000}
                    step={250}
                    className="py-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-2">
                    <span>$2,000</span>
                    <span>$30,000</span>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>
                    This is an estimate based on Cook County averages. Actual savings depend on your 
                    specific property and assessment. Start a free check for a personalized analysis.
                  </p>
                </div>
              </div>

              {/* Results */}
              <div className="flex flex-col justify-center">
                <div className="space-y-6">
                  {/* Annual Savings */}
                  <div className="bg-gradient-to-br from-secondary to-secondary/90 rounded-xl p-6 text-center">
                    <p className="text-secondary-foreground/70 text-sm mb-2 uppercase tracking-wide">
                      Estimated Annual Savings
                    </p>
                    <p className="text-4xl md:text-5xl font-bold text-primary mb-1">
                      {formatCurrency(calculations.annualSavings)}
                    </p>
                    <p className="text-secondary-foreground/60 text-sm">
                      ~{formatCurrency(calculations.monthlyImpact)}/month
                    </p>
                  </div>

                  {/* 5-Year Projection */}
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                        <TrendingDown className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">5-Year Projection</p>
                        <p className="font-semibold text-foreground">{formatCurrency(calculations.fiveYearSavings)}</p>
                      </div>
                    </div>
                  </div>

                  {/* CTA */}
                  <Button size="lg" className="w-full btn-premium py-6" asChild>
                    <Link href="/check">
                      Get Your Free Property Check
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
