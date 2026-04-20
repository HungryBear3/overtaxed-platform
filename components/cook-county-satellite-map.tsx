"use client"

import { useEffect, useState } from "react"
import { townships, statusLabels, triadInfo, getTownshipWindowInfo, type TownshipData } from "@/lib/cook-county-townships"

interface CookCountySatelliteMapProps {
  className?: string
  showLegend?: boolean
  interactive?: boolean
}

export function CookCountySatelliteMap({ 
  className = "", 
  showLegend = true,
  interactive = true,
}: CookCountySatelliteMapProps) {
  const [hoveredTownship, setHoveredTownship] = useState<TownshipData | null>(null)
  const [selectedTownship, setSelectedTownship] = useState<TownshipData | null>(null)
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return

    const media = window.matchMedia("(hover: none), (pointer: coarse)")
    const sync = () => setIsTouchDevice(media.matches)
    sync()

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync)
      return () => media.removeEventListener("change", sync)
    }

    media.addListener(sync)
    return () => media.removeListener(sync)
  }, [])

  const activeTownship = isTouchDevice ? selectedTownship : hoveredTownship

  const handleMouseEnter = (township: TownshipData, event: React.MouseEvent) => {
    if (!interactive || isTouchDevice) return
    setHoveredTownship(township)
    setTooltipPosition({ x: event.clientX, y: event.clientY })
  }

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!isTouchDevice && hoveredTownship) {
      setTooltipPosition({ x: event.clientX, y: event.clientY })
    }
  }

  const handleMouseLeave = () => {
    if (isTouchDevice) return
    setHoveredTownship(null)
  }

  const handleTownshipSelect = (township: TownshipData) => {
    if (!interactive) return
    if (isTouchDevice) {
      setSelectedTownship((current) => current?.name === township.name ? null : township)
      return
    }
    setHoveredTownship(township)
  }

  const getFillColor = (township: TownshipData) => {
    if (township.status === "open") return "rgba(34, 197, 94, 0.45)" // emerald
    if (township.status === "opening-soon") return "rgba(245, 158, 11, 0.4)" // amber
    return "rgba(30, 41, 59, 0.25)" // slate/navy
  }

  const getHoverFillColor = (township: TownshipData) => {
    if (township.status === "open") return "rgba(34, 197, 94, 0.65)"
    if (township.status === "opening-soon") return "rgba(245, 158, 11, 0.6)"
    return "rgba(30, 41, 59, 0.4)"
  }

  const getStrokeColor = (township: TownshipData) => {
    if (township.status === "open") return "rgba(34, 197, 94, 0.9)"
    if (township.status === "opening-soon") return "rgba(245, 158, 11, 0.9)"
    return "rgba(148, 163, 184, 0.5)"
  }

  const getTooltipStyle = () => {
    const padding = 12
    const estimatedWidth = 240
    const estimatedHeight = 140
    let left = tooltipPosition.x + 12
    let top = tooltipPosition.y - 12

    if (typeof window !== "undefined") {
      left = Math.min(left, window.innerWidth - estimatedWidth - padding)
      top = Math.min(top, window.innerHeight - estimatedHeight - padding)
      left = Math.max(padding, left)
      top = Math.max(padding, top)
    }

    return {
      left,
      top,
      maxWidth: "min(15rem, calc(100vw - 24px))",
    }
  }

  return (
    <div className={`relative overflow-hidden rounded-xl ${className}`} onMouseMove={handleMouseMove}>
      {/* Satellite imagery base layer - multiple tiles stitched together */}
      <div className="absolute inset-0">
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(15, 23, 42, 0.3), transparent 10%, transparent 90%, rgba(15, 23, 42, 0.3)),
              linear-gradient(to bottom, rgba(15, 23, 42, 0.2), transparent 10%, transparent 90%, rgba(15, 23, 42, 0.2)),
              url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/380/525'),
              url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/380/526'),
              url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/381/525'),
              url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/381/526')
            `,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            filter: 'saturate(0.8) brightness(0.9)',
          }}
        />
        {/* Composite satellite image of Cook County */}
        <img
          src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=-88.3,41.45,-87.5,42.15&bboxSR=4326&imageSR=4326&size=800,700&format=png&f=image"
          alt="Cook County satellite imagery"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'saturate(0.85) brightness(0.85) contrast(1.05)' }}
          crossOrigin="anonymous"
        />
      </div>

      {/* Township overlay */}
      <svg 
        viewBox="0 0 400 500" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* Glow filter for highlighted townships */}
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        {/* Townships */}
        {townships.map((township) => {
          const isHovered = activeTownship?.name === township.name
          return (
            <g 
              key={township.name}
              onMouseEnter={(e) => handleMouseEnter(township, e)}
              onMouseLeave={handleMouseLeave}
              onClick={() => handleTownshipSelect(township)}
              className={interactive ? "cursor-pointer" : ""}
              filter={isHovered ? "url(#glow)" : undefined}
            >
              <path
                d={township.path}
                fill={isHovered ? getHoverFillColor(township) : getFillColor(township)}
                stroke={getStrokeColor(township)}
                strokeWidth={isHovered ? "2" : "1"}
                style={{
                  transition: 'all 0.2s ease',
                }}
              />
            </g>
          )
        })}

        {/* Lake Michigan indicator */}
        <text
          x="395"
          y="200"
          textAnchor="end"
          dominantBaseline="middle"
          className="pointer-events-none"
          style={{
            fill: 'rgba(255,255,255,0.4)',
            fontSize: '9px',
            fontWeight: 500,
            letterSpacing: '0.5px',
          }}
        >
          Lake Michigan
        </text>
      </svg>

      {/* Tooltip */}
      {activeTownship && (() => {
        const windowInfo = getTownshipWindowInfo(activeTownship.name)
        return isTouchDevice ? (
          <div className="absolute inset-x-3 bottom-3 z-40 rounded-lg border border-white/10 bg-secondary/95 px-4 py-3 text-sm text-secondary-foreground shadow-xl backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">
                  {activeTownship.name}
                  {activeTownship.triad !== "city" && " Township"}
                </div>
                <div className="mt-0.5 text-xs opacity-60">
                  {triadInfo[activeTownship.triad].name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTownship(null)}
                className="rounded-md border border-white/10 px-2 py-1 text-xs font-medium text-secondary-foreground/80"
              >
                Close
              </button>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs opacity-85">
              <span 
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: activeTownship.status === "open" 
                    ? "rgb(34, 197, 94)" 
                    : activeTownship.status === "opening-soon" 
                      ? "rgb(245, 158, 11)" 
                      : "rgb(148, 163, 184)"
                }}
              />
              {statusLabels[activeTownship.status]}
            </div>
            {windowInfo && (
              <div className="mt-2 border-t border-white/10 pt-2 text-xs">
                <span className="opacity-60">{windowInfo.label}: </span>
                <span className="opacity-90">{windowInfo.dates}</span>
              </div>
            )}
          </div>
        ) : (
          <div
            className="fixed z-50 rounded-lg border border-white/10 bg-secondary/95 px-3 py-2.5 text-sm font-medium text-secondary-foreground shadow-xl pointer-events-none whitespace-normal backdrop-blur"
            style={getTooltipStyle()}
          >
            <div className="font-semibold">
              {activeTownship.name}
              {activeTownship.triad !== "city" && " Township"}
            </div>
            <div className="mt-0.5 text-xs opacity-60">
              {triadInfo[activeTownship.triad].name}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs opacity-80">
              <span 
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor: activeTownship.status === "open" 
                    ? "rgb(34, 197, 94)" 
                    : activeTownship.status === "opening-soon" 
                      ? "rgb(245, 158, 11)" 
                      : "rgb(148, 163, 184)"
                }}
              />
              {statusLabels[activeTownship.status]}
            </div>
            {windowInfo && (
              <div className="mt-2 border-t border-white/10 pt-2 text-xs">
                <span className="opacity-60">{windowInfo.label}: </span>
                <span className="opacity-90">{windowInfo.dates}</span>
              </div>
            )}
          </div>
        )
      })()}

      {/* Legend */}
      {showLegend && (
        <div className="absolute bottom-4 left-4 bg-secondary/90 backdrop-blur-md rounded-lg p-3 shadow-xl border border-white/10">
          <div className="text-xs font-semibold text-secondary-foreground mb-2">Appeal Windows</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-emerald-500 shadow-sm shadow-emerald-500/50" />
              <span className="text-xs text-secondary-foreground/80">Open Now</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-amber-500 shadow-sm shadow-amber-500/50" />
              <span className="text-xs text-secondary-foreground/80">Opening Soon</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-slate-400/50 border border-slate-400/30" />
              <span className="text-xs text-secondary-foreground/80">Closed</span>
            </div>
          </div>
        </div>
      )}

      {/* Map attribution */}
      <div className="absolute bottom-1 right-2 text-[9px] text-white/50">
        Imagery: Esri, Maxar
      </div>
    </div>
  )
}
