import { MapPin, DollarSign, TrendingUp, Users, BarChart3 } from "lucide-react"

const trustItems = [
  {
    icon: MapPin,
    text: "Cook County focused"
  },
  {
    icon: DollarSign,
    text: "Transparent pricing"
  },
  {
    icon: TrendingUp,
    text: "Real homeowner outcomes"
  },
  {
    icon: Users,
    text: "DIY & full-service options"
  },
  {
    icon: BarChart3,
    text: "Public-data-driven analysis"
  }
]

export function TrustStrip() {
  return (
    <section className="py-6 bg-primary/10 border-y border-primary/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 md:gap-x-12">
          {trustItems.map((item, index) => (
            <div key={index} className="flex items-center gap-2 text-foreground">
              <item.icon className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
