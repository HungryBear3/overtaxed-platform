"use client"

import { useEffect, useState } from "react"
import {
  ComposableMap,
  Geographies,
  Geography,
} from "react-simple-maps"

interface CookCountyHeroMapProps {
  className?: string
  side: "left" | "right"
}

export function CookCountyHeroMap({ className = "", side }: CookCountyHeroMapProps) {
  const [geoData, setGeoData] = useState<GeoJSON.FeatureCollection | null>(null)

  useEffect(() => {
    fetch("https://gis.cookcountyil.gov/traditional/rest/services/politicalBoundary/MapServer/4/query?where=1%3D1&outFields=*&f=geojson")
      .then(res => res.json())
      .then(data => setGeoData(data))
      .catch(err => console.error("Error loading map:", err))
  }, [])

  if (!geoData) return null

  return (
    <div className={`${className} ${side === "right" ? "scale-x-[-1]" : ""}`}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{
          scale: 22000,
          center: [-87.85, 41.85],
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={geoData}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                className="fill-secondary/30 stroke-secondary/10 stroke-[0.5]"
                style={{
                  default: { outline: "none" },
                  hover: { outline: "none" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>
      </ComposableMap>
    </div>
  )
}
