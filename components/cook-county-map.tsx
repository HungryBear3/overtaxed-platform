"use client"

// Cook County Townships with appeal window status
// Status: "open" = currently accepting appeals, "upcoming" = opens soon, "closed" = window passed
export type TownshipStatus = "open" | "upcoming" | "closed"

export interface Township {
  name: string
  status: TownshipStatus
  path: string
}

// Simplified Cook County township boundaries
// These are approximated SVG paths representing the general shape of each township
export const townships: Township[] = [
  // North Suburbs
  { name: "Northfield", status: "open", path: "M180,20 L240,20 L240,60 L180,60 Z" },
  { name: "New Trier", status: "open", path: "M240,20 L300,20 L310,60 L240,60 Z" },
  { name: "Wheeling", status: "upcoming", path: "M100,30 L180,30 L180,80 L100,80 Z" },
  { name: "Palatine", status: "upcoming", path: "M20,30 L100,30 L100,90 L20,90 Z" },
  { name: "Hanover", status: "closed", path: "M20,90 L70,90 L70,140 L20,140 Z" },
  { name: "Schaumburg", status: "closed", path: "M70,90 L140,90 L140,150 L70,150 Z" },
  
  // Northwest
  { name: "Maine", status: "upcoming", path: "M140,80 L200,80 L200,140 L140,140 Z" },
  { name: "Niles", status: "open", path: "M200,60 L260,60 L260,120 L200,120 Z" },
  { name: "Evanston", status: "open", path: "M260,50 L310,50 L310,100 L260,100 Z" },
  
  // City of Chicago (large central area)
  { name: "Chicago", status: "open", path: "M200,120 L310,100 L320,280 L240,320 L200,280 Z" },
  
  // West Suburbs
  { name: "Elk Grove", status: "closed", path: "M20,140 L90,140 L90,200 L20,200 Z" },
  { name: "Leyden", status: "upcoming", path: "M140,140 L200,140 L200,200 L140,200 Z" },
  { name: "Norwood Park", status: "upcoming", path: "M170,120 L200,120 L200,160 L170,160 Z" },
  { name: "Proviso", status: "closed", path: "M90,170 L140,170 L140,240 L90,240 Z" },
  { name: "River Forest", status: "closed", path: "M140,200 L180,200 L180,250 L140,250 Z" },
  { name: "Oak Park", status: "upcoming", path: "M180,200 L200,200 L200,260 L180,260 Z" },
  
  // Southwest
  { name: "Riverside", status: "closed", path: "M140,250 L180,250 L180,300 L140,300 Z" },
  { name: "Berwyn", status: "upcoming", path: "M180,260 L210,260 L210,310 L180,310 Z" },
  { name: "Cicero", status: "upcoming", path: "M200,260 L230,260 L230,300 L200,300 Z" },
  { name: "Stickney", status: "closed", path: "M140,300 L180,300 L180,340 L140,340 Z" },
  { name: "Lyons", status: "closed", path: "M90,240 L140,240 L140,310 L90,310 Z" },
  { name: "Palos", status: "closed", path: "M20,280 L90,280 L90,360 L20,360 Z" },
  { name: "Lemont", status: "closed", path: "M20,360 L90,360 L90,420 L20,420 Z" },
  { name: "Orland", status: "upcoming", path: "M90,340 L160,340 L160,420 L90,420 Z" },
  { name: "Worth", status: "upcoming", path: "M160,320 L220,320 L220,380 L160,380 Z" },
  { name: "Bremen", status: "open", path: "M160,380 L230,380 L230,440 L160,440 Z" },
  
  // South Suburbs
  { name: "Calumet", status: "open", path: "M240,320 L310,300 L320,380 L250,400 Z" },
  { name: "Thornton", status: "open", path: "M230,380 L300,380 L300,450 L230,450 Z" },
  { name: "Bloom", status: "open", path: "M230,450 L300,450 L300,500 L230,500 Z" },
  { name: "Rich", status: "upcoming", path: "M160,440 L230,440 L230,500 L160,500 Z" },
]

const statusColors = {
  open: "fill-emerald-500/70 stroke-emerald-600",
  upcoming: "fill-amber-500/50 stroke-amber-600", 
  closed: "fill-secondary/30 stroke-secondary/50",
}

const statusLabels = {
  open: "Appeals Open",
  upcoming: "Opening Soon",
  closed: "Window Closed",
}

export function CookCountyMap({ 
  className = "",
  showLegend = true,
  interactive = true,
}: { 
  className?: string
  showLegend?: boolean
  interactive?: boolean
}) {
  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox="0 0 340 520"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        {/* Lake Michigan */}
        <path
          d="M310,20 L340,20 L340,400 L320,400 L310,300 L320,200 L310,100 Z"
          className="fill-blue-400/20 stroke-blue-400/40"
          strokeWidth="1"
        />
        
        {/* Township boundaries */}
        {townships.map((township) => (
          <g key={township.name} className={interactive ? "cursor-pointer transition-all duration-200 hover:brightness-110" : ""}>
            <path
              d={township.path}
              className={`${statusColors[township.status]} transition-colors duration-300`}
              strokeWidth="1.5"
            />
            {interactive && (
              <title>{township.name} - {statusLabels[township.status]}</title>
            )}
          </g>
        ))}
        
        {/* Chicago label */}
        <text x="250" y="200" className="fill-foreground/60 text-[10px] font-medium" textAnchor="middle">
          Chicago
        </text>
      </svg>
      
      {/* Legend */}
      {showLegend && (
        <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm rounded-lg p-3 border border-border shadow-lg">
          <p className="text-xs font-semibold text-foreground mb-2">Appeal Windows</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-emerald-500/70 border border-emerald-600" />
              <span className="text-xs text-muted-foreground">Open Now</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-amber-500/50 border border-amber-600" />
              <span className="text-xs text-muted-foreground">Opening Soon</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-secondary/30 border border-secondary/50" />
              <span className="text-xs text-muted-foreground">Closed</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Simplified background version without interactivity
export function CookCountyMapBackground({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 340 520"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Lake Michigan */}
      <path
        d="M310,20 L340,20 L340,400 L320,400 L310,300 L320,200 L310,100 Z"
        className="fill-primary/5 stroke-primary/10"
        strokeWidth="1"
      />
      
      {/* Township boundaries - subtle background version */}
      {townships.map((township) => (
        <path
          key={township.name}
          d={township.path}
          className={
            township.status === "open" 
              ? "fill-primary/15 stroke-primary/25" 
              : township.status === "upcoming"
              ? "fill-primary/8 stroke-primary/15"
              : "fill-secondary/8 stroke-secondary/15"
          }
          strokeWidth="1"
        />
      ))}
    </svg>
  )
}
