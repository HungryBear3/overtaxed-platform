"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

const faqs = [
  {
    question: "How do I know if my property is overassessed?",
    answer: "The simplest way is to compare your assessed value to similar properties in your area. Our free property check does this automatically using Cook County public records. If your home's assessed value is significantly higher than comparable homes, you likely have grounds for an appeal."
  },
  {
    question: "Do I need my PIN to get started?",
    answer: "No, you can start with just your property address. We'll look up your PIN and assessment details automatically using Cook County's public database. However, having your PIN handy can speed up the process."
  },
  {
    question: "What if I just want the DIY option?",
    answer: "That's exactly what we recommend for most homeowners. The DIY Appeal Packet gives you everything you need — comparable properties, evidence documentation, step-by-step instructions, and support — at a fraction of what full-service options cost. You stay in control of your appeal while having professional-grade materials."
  },
  {
    question: "What's the difference between DIY and Done-For-You?",
    answer: "With DIY, you receive a complete appeal packet and file it yourself following our instructions. With Done-For-You, our team handles everything: we prepare your evidence, file your appeal, and represent you at hearings if needed. DIY costs less and gives you more control; Done-For-You is for homeowners who prefer a completely hands-off experience."
  },
  {
    question: "Is this legal advice?",
    answer: "No. OverTaxed IL provides property tax analysis and appeal preparation services. We help you understand your assessment, prepare evidence, and navigate the appeal process. We are not a law firm and do not provide legal advice. For complex legal questions, we recommend consulting with a licensed attorney."
  },
  {
    question: "What happens after I submit my free check?",
    answer: "You'll immediately see how your property compares to similar homes in your area, along with an estimate of potential overassessment. If there's a case for appeal, you can choose your preferred option — DIY Packet, Done-For-You, or Contingency — and move forward. There's no obligation and no signup required for the free check."
  },
  {
    question: "When is the deadline to file an appeal?",
    answer: "Cook County has specific appeal windows that vary by township. After your assessment notice arrives, you typically have 30 days to file. Our free check will show you the relevant deadlines for your property so you don't miss your window."
  },
  {
    question: "What if my appeal isn't successful?",
    answer: "Property tax appeals are low-risk — your taxes cannot go up as a result of filing. If your appeal isn't successful at the first level, you may have options to appeal further. With our Done-For-You service, we include representation at additional hearing levels if needed."
  }
]

export function FAQ() {
  return (
    <section id="faq" className="py-20 md:py-28 bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-12">
          <p className="text-sm font-medium text-primary uppercase tracking-wide mb-3">
            Frequently Asked Questions
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-4">
            Common questions answered
          </h2>
          <p className="text-muted-foreground text-lg">
            Everything you need to know about property tax appeals in Cook County.
          </p>
        </div>

        {/* Accordion */}
        <Accordion type="single" collapsible className="space-y-4">
          {faqs.map((faq, index) => (
            <AccordionItem 
              key={index} 
              value={`item-${index}`}
              className="bg-card border border-border rounded-lg px-6 data-[state=open]:ring-1 data-[state=open]:ring-primary/20"
            >
              <AccordionTrigger className="text-left font-medium text-foreground hover:no-underline py-5">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed pb-5">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
