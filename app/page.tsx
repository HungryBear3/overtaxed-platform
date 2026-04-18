import type { Metadata } from "next"
import { Hero } from "@/components/sections/hero"
import { TrustStrip } from "@/components/sections/trust-strip"
import { ProvenResults } from "@/components/sections/proven-results"
import { HowItWorks } from "@/components/sections/how-it-works"
import { AppealWindows } from "@/components/sections/appeal-windows"
import { AppealOptions } from "@/components/sections/appeal-options"
import { SavingsCalculator } from "@/components/sections/savings-calculator"
import { WhyChooseUs } from "@/components/sections/why-choose-us"
import { Testimonials } from "@/components/sections/testimonials"
import { FAQ } from "@/components/sections/faq"
import { FinalCTA } from "@/components/sections/final-cta"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileStickyBar } from "@/components/MobileStickyBar"

export const metadata: Metadata = {
  title: "Cook County Property Tax Appeal | Start Free Check",
  description: "Appeal your Cook County property taxes. 2026 reassessment cycle is open for south district townships. Homeowners who appeal save $1,200+/year on average.",
  keywords: ["Cook County property tax appeal", "property tax appeal Illinois", "2026 reassessment", "Cook County Board of Review", "lower property taxes"],
  openGraph: {
    title: "Cook County Property Tax Appeal | Start Free Check",
    description: "Appeal your Cook County property taxes. 2026 reassessment cycle open — homeowners who appeal save $1,200+/year.",
    type: "website",
  },
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "OverTaxed IL",
  url: "https://www.overtaxed-il.com",
  description: "Cook County property tax appeal service. We find comparable properties and help you file your appeal.",
  areaServed: { "@type": "AdministrativeArea", name: "Cook County, Illinois" },
  serviceType: "Property Tax Appeal",
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MobileStickyBar href="/check" label="Start Free Check" subtext="Takes 60 seconds · No credit card" color="amber" />
      <main className="min-h-screen bg-background">
        <Header />
        <Hero />
        <TrustStrip />
        <ProvenResults />
        <AppealWindows />
        <HowItWorks />
        <AppealOptions />
        <SavingsCalculator />
        <WhyChooseUs />
        <Testimonials />
        <FAQ />
        <FinalCTA />
        <Footer />
      </main>
    </>
  )
}
