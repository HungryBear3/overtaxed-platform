"use client"

import { useState } from "react"
import { townships, statusColors, statusLabels, type TownshipData } from "@/lib/cook-county-townships"

interface CookCountyAccurateMapProps {
  className?: string
  showLegend?: boolean
  interactive?: boolean
  showLabels?: boolean
}

export function CookCountyAccurateMap({ 
  className = "", 
  showLegend = true,
  interactive = true,
  showLabels = false
}: CookCountyAccurateMapProps) {
  const [hoveredTownship, setHoveredTownship] = useState<TownshipData | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  const handleMouseEnter = (township: TownshipData, event: React.MouseEvent) => {
    if (!interactive) return
    setHoveredTownship(township)
    setTooltipPosition({ x: event.clientX, y: event.clientY })
  }

  const handleMouseMove = (event: React.MouseEvent) => {
    if (hoveredTownship) {
      setTooltipPosition({ x: event.clientX, y: event.clientY })
    }
  }

  const handleMouseLeave = () => {
    setHoveredTownship(null)
  }

  const getFillColor = (township: TownshipData) => {
    if (township.status === "open") return "fill-emerald-500"
    if (township.status === "opening-soon") return "fill-amber-500"
    return "fill-secondary/40"
  }

  const getHoverFillColor = (township: TownshipData) => {
    if (township.status === "open") return "fill-emerald-400"
    if (township.status === "opening-soon") return "fill-amber-400"
    return "fill-secondary/60"
  }

  return (
    <div className={`relative ${className}`} onMouseMove={handleMouseMove}>
      <svg 
        viewBox="0 0 400 450" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
        style={{ maxHeight: "100%" }}
      >
        {/* Lake Michigan indicator */}
        <defs>
          <pattern id="water" patternUnits="userSpaceOnUse" width="8" height="8">
            <path d="M0 4 Q2 2 4 4 T8 4" fill="none" stroke="oklch(0.72 0.15 75 / 0.15)" strokeWidth="0.5"/>
          </pattern>
          <linearGradient id="lakeGradient" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="oklch(0.72 0.15 75 / 0.1)"/>
            <stop offset="100%" stopColor="transparent"/>
          </linearGradient>
        </defs>
        
        {/* Lake Michigan */}
        <rect x="400" y="0" width="60" height="450" fill="url(#lakeGradient)" />
        
        {/* County outline */}
        <rect 
          x="0" 
          y="0" 
          width="400" 
          height="445" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          className="text-secondary/30"
          rx="4"
        />
        
        {/* Townships */}
        {townships.map((township) => (
          <g 
            key={township.name}
            onMouseEnter={(e) => handleMouseEnter(township, e)}
            onMouseLeave={handleMouseLeave}
            className={interactive ? "cursor-pointer" : ""}
          >
            <path
              d={township.path}
              className={`
                ${hoveredTownship?.name === township.name ? getHoverFillColor(township) : getFillColor(township)}
                stroke-background
                transition-all
                duration-200
              `}
              strokeWidth="1.5"
            />
            {showLabels && (
              <text
                x={township.center[0]}
                y={township.center[1]}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground text-[8px] font-medium pointer-events-none"
              >
                {township.name}
              </text>
            )}
          </g>
        ))}
        
        {/* Chicago label - always visible since it's the largest */}
        <text
          x="360"
          y="225"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-background text-[12px] font-bold pointer-events-none"
        >
          Chicago
        </text>
      </svg>

      {/* Tooltip */}
      {hoveredTownship && (
        <div
          className="fixed z-50 px-3 py-2 text-sm font-medium bg-secondary text-secondary-foreground rounded-lg shadow-lg pointer-events-none whitespace-nowrap"
          style={{
            left: tooltipPosition.x + 12,
            top: tooltipPosition.y - 12,
          }}
        >
          <div className="font-semibold">{hoveredTownship.name}</div>
          <div className="text-xs opacity-80">{statusLabels[hoveredTownship.status]}</div>
        </div>
      )}

      {/* Legend */}
      {showLegend && (
        <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur-sm rounded-lg p-3 shadow-lg border border-border">
          <div className="text-xs font-semibold text-foreground mb-2">Appeal Windows</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-emerald-500" />
              <span className="text-xs text-muted-foreground">Open Now</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-amber-500" />
              <span className="text-xs text-muted-foreground">Opening Soon</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-secondary/40" />
              <span className="text-xs text-muted-foreground">Closed</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Simplified background version for hero sections
export function CookCountyMapBackground({ className = "" }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 400 450" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {townships.map((township) => (
        <path
          key={township.name}
          d={township.path}
          className="fill-current opacity-20"
          stroke="currentColor"
          strokeWidth="0.5"
          strokeOpacity="0.3"
        />
      ))}
    </svg>
  )
}
