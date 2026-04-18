"use client"

import { CookCountySatelliteMap } from "@/components/cook-county-satellite-map"
import { townships } from "@/lib/cook-county-townships"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, CheckCircle, Clock } from "lucide-react"

const openTownships = townships.filter(t => t.status === "open")
const upcomingTownships = townships.filter(t => t.status === "opening-soon")

export function AppealWindows() {
  return (
    <section className="py-16 md:py-24 bg-secondary text-secondary-foreground relative overflow-hidden">
      {/* Subtle pattern */}
      <div 
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `
            linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />
      
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Cook County Satellite Map with Township Overlay */}
          <div className="relative h-[500px] lg:h-[600px] order-2 lg:order-1">
            <CookCountySatelliteMap className="w-full h-full" showLegend={true} interactive={true} />
          </div>
          
          {/* Content */}
          <div className="order-1 lg:order-2">
            <Badge variant="outline" className="mb-4 border-primary/50 text-primary">
              <Clock className="w-3 h-3 mr-1" />
              Time-Sensitive
            </Badge>
            
            <h2 className="font-serif text-3xl md:text-4xl text-secondary-foreground mb-4 text-balance">
              Know your township&apos;s appeal window
            </h2>
            
            <p className="text-lg text-secondary-foreground/60 mb-8 text-pretty">
              Cook County uses a triennial system - North suburbs, South/West suburbs, and City of Chicago 
              each reassess on a 3-year cycle. Each township has a specific window to file appeals. 
              Miss it, and you wait another year.
            </p>
            
            {/* Open Now */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                <span className="font-semibold text-secondary-foreground">Open Now</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {openTownships.map((township) => (
                  <Badge 
                    key={township.name} 
                    className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30"
                  >
                    {township.name}
                  </Badge>
                ))}
              </div>
            </div>
            
            {/* Opening Soon */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                <span className="font-semibold text-secondary-foreground">Opening Soon</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {upcomingTownships.map((township) => (
                  <Badge 
                    key={township.name} 
                    className="bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30"
                  >
                    {township.name}
                  </Badge>
                ))}
              </div>
            </div>
            
            <p className="text-sm text-secondary-foreground/60">
              Hover over the map to see each township&apos;s status. We&apos;ll check your specific 
              township when you enter your address.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
