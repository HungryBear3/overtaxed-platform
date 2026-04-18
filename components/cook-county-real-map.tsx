"use client"

import { useEffect, useState } from "react"
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps"

// Township appeal window status - this would come from your backend in production
const townshipStatus: Record<string, "open" | "opening-soon" | "closed"> = {
  "Barrington": "closed",
  "Berwyn": "opening-soon",
  "Bloom": "open",
  "Bremen": "open",
  "Calumet": "open",
  "Chicago": "open",
  "Cicero": "opening-soon",
  "Elk Grove": "closed",
  "Evanston": "open",
  "Hanover": "closed",
  "Lemont": "closed",
  "Leyden": "opening-soon",
  "Lyons": "closed",
  "Maine": "opening-soon",
  "New Trier": "open",
  "Niles": "open",
  "Northfield": "open",
  "Norwood Park": "opening-soon",
  "Oak Park": "opening-soon",
  "Orland": "opening-soon",
  "Palatine": "opening-soon",
  "Palos": "closed",
  "Proviso": "closed",
  "Rich": "opening-soon",
  "River Forest": "closed",
  "Riverside": "closed",
  "Schaumburg": "closed",
  "Stickney": "closed",
  "Thornton": "open",
  "Wheeling": "opening-soon",
  "Worth": "opening-soon",
}

const statusColors = {
  open: "fill-emerald-500",
  "opening-soon": "fill-amber-500",
  closed: "fill-secondary/60",
}

const statusLabels = {
  open: "Appeals Open",
  "opening-soon": "Opening Soon", 
  closed: "Window Closed",
}

interface CookCountyRealMapProps {
  className?: string
  showLegend?: boolean
  interactive?: boolean
}

export function CookCountyRealMap({ 
  className = "", 
  showLegend = true,
  interactive = true 
}: CookCountyRealMapProps) {
  const [tooltipContent, setTooltipContent] = useState("")
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const [geoData, setGeoData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Fetch real Cook County township boundaries from official GIS server
    fetch("https://gis.cookcountyil.gov/traditional/rest/services/politicalBoundary/MapServer/4/query?where=1%3D1&outFields=*&f=geojson")
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch map data")
        return res.json()
      })
      .then(data => {
        setGeoData(data)
        setLoading(false)
      })
      .catch(err => {
        console.error("Error loading map:", err)
        setError("Unable to load map data")
        setLoading(false)
      })
  }, [])

  const handleMouseEnter = (geo: GeoJSON.Feature, event: React.MouseEvent) => {
    if (!interactive) return
    const name = geo.properties?.TOWNSHIP_NAME || geo.properties?.NAME || "Unknown"
    const status = townshipStatus[name] || "closed"
    setTooltipContent(`${name}: ${statusLabels[status]}`)
    setTooltipPosition({ x: event.clientX, y: event.clientY })
  }

  const handleMouseLeave = () => {
    setTooltipContent("")
  }

  const handleMouseMove = (event: React.MouseEvent) => {
    if (tooltipContent) {
      setTooltipPosition({ x: event.clientX, y: event.clientY })
    }
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="animate-pulse text-muted-foreground">Loading map...</div>
      </div>
    )
  }

  if (error || !geoData) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-muted-foreground text-sm">{error || "Map unavailable"}</div>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`} onMouseMove={handleMouseMove}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{
          scale: 28000,
          center: [-87.85, 41.85],
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomableGroup center={[-87.85, 41.85]} zoom={1} minZoom={0.8} maxZoom={3}>
          <Geographies geography={geoData}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const name = geo.properties?.TOWNSHIP_NAME || geo.properties?.NAME || ""
                const status = townshipStatus[name] || "closed"
                
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onMouseEnter={(e) => handleMouseEnter(geo, e)}
                    onMouseLeave={handleMouseLeave}
                    className={`
                      ${statusColors[status]}
                      stroke-background
                      stroke-[0.5]
                      outline-none
                      transition-all
                      duration-200
                      ${interactive ? "cursor-pointer hover:opacity-80 hover:stroke-primary hover:stroke-[1.5]" : ""}
                    `}
                    style={{
                      default: { outline: "none" },
                      hover: { outline: "none" },
                      pressed: { outline: "none" },
                    }}
                  />
                )
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* Tooltip */}
      {tooltipContent && (
        <div
          className="fixed z-50 px-3 py-2 text-sm font-medium bg-secondary text-secondary-foreground rounded-lg shadow-lg pointer-events-none"
          style={{
            left: tooltipPosition.x + 10,
            top: tooltipPosition.y - 10,
          }}
        >
          {tooltipContent}
        </div>
      )}

      {/* Legend */}
      {showLegend && (
        <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm rounded-lg p-3 shadow-lg border border-border">
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
              <div className="w-3 h-3 rounded-sm bg-secondary/60" />
              <span className="text-xs text-muted-foreground">Closed</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
