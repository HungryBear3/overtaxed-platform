// Cook County township and Chicago assessment area data
// Based on Cook County Assessor's Office official boundaries and calendar
// Last updated: April 2026

export type TownshipStatus = "open" | "opening-soon" | "closed"

export interface AppealWindow {
  startDate: string // ISO date string
  endDate: string // ISO date string
}

export interface TownshipData {
  name: string
  status: TownshipStatus
  path: string // SVG path data
  center: [number, number] // For label positioning [x, y]
  triad: "north" | "south" | "city" // Triennial assessment triad
  appealWindow?: AppealWindow // Current or upcoming window
  lastWindow?: AppealWindow // Previous appeal window (for closed townships)
}

// Township appeal window dates based on Cook County Assessor calendar
// Format: { startDate, endDate } as ISO strings
export const townshipWindows: Record<string, { current?: AppealWindow; last?: AppealWindow }> = {
  // North Triad (reassessed 2025) - closed, showing last window
  "Barrington": { last: { startDate: "2025-01-15", endDate: "2025-02-14" } },
  "Palatine": { last: { startDate: "2025-01-15", endDate: "2025-02-14" } },
  "Wheeling": { last: { startDate: "2025-02-01", endDate: "2025-03-03" } },
  "Northfield": { last: { startDate: "2025-02-15", endDate: "2025-03-17" } },
  "New Trier": { last: { startDate: "2025-02-15", endDate: "2025-03-17" } },
  "Hanover": { last: { startDate: "2025-01-15", endDate: "2025-02-14" } },
  "Schaumburg": { last: { startDate: "2025-02-01", endDate: "2025-03-03" } },
  "Elk Grove": { last: { startDate: "2025-02-15", endDate: "2025-03-17" } },
  "Maine": { last: { startDate: "2025-03-01", endDate: "2025-03-31" } },
  "Niles": { last: { startDate: "2025-03-01", endDate: "2025-03-31" } },
  "Evanston": { last: { startDate: "2025-03-01", endDate: "2025-03-31" } },
  "Leyden": { last: { startDate: "2025-03-15", endDate: "2025-04-14" } },
  "Norwood Park": { last: { startDate: "2025-03-15", endDate: "2025-04-14" } },
  
  // City of Chicago Assessment Areas (reassessed 2024) - closed
  "Rogers Park": { last: { startDate: "2024-10-01", endDate: "2024-10-31" } },
  "West Chicago": { last: { startDate: "2024-10-15", endDate: "2024-11-14" } },
  "South Chicago": { last: { startDate: "2024-11-01", endDate: "2024-12-01" } },
  "Hyde Park": { last: { startDate: "2024-11-01", endDate: "2024-12-01" } },
  "Jefferson": { last: { startDate: "2024-11-15", endDate: "2024-12-15" } },
  "Lake": { last: { startDate: "2024-10-15", endDate: "2024-11-14" } },
  "Lake View": { last: { startDate: "2024-10-01", endDate: "2024-10-31" } },
  "North Chicago": { last: { startDate: "2024-10-15", endDate: "2024-11-14" } },
  "West Town": { last: { startDate: "2024-10-15", endDate: "2024-11-14" } },
  
  // South/West Triad (reassessed 2026)
  "Berwyn": { current: { startDate: "2026-05-01", endDate: "2026-05-31" } },
  "Cicero": { current: { startDate: "2026-05-01", endDate: "2026-05-31" } },
  "Oak Park": { current: { startDate: "2026-05-01", endDate: "2026-05-31" } },
  "River Forest": { last: { startDate: "2026-01-15", endDate: "2026-02-14" } },
  "Proviso": { last: { startDate: "2026-01-15", endDate: "2026-02-14" } },
  "Riverside": { last: { startDate: "2026-02-01", endDate: "2026-03-03" } },
  "Lyons": { last: { startDate: "2026-02-01", endDate: "2026-03-03" } },
  "Stickney": { last: { startDate: "2026-02-15", endDate: "2026-03-17" } },
  "Lemont": { last: { startDate: "2026-02-15", endDate: "2026-03-17" } },
  "Palos": { last: { startDate: "2026-03-01", endDate: "2026-03-31" } },
  "Worth": { current: { startDate: "2026-04-25", endDate: "2026-05-25" } },
  "Bremen": { current: { startDate: "2026-04-01", endDate: "2026-04-30" } },
  "Calumet": { current: { startDate: "2026-04-01", endDate: "2026-04-30" } },
  "Orland": { current: { startDate: "2026-04-25", endDate: "2026-05-25" } },
  "Rich": { current: { startDate: "2026-04-25", endDate: "2026-05-25" } },
  "Bloom": { current: { startDate: "2026-04-01", endDate: "2026-04-30" } },
  "Thornton": { current: { startDate: "2026-04-01", endDate: "2026-04-30" } },
}

// Township appeal window status based on Cook County Assessor calendar
// 2025 = North suburbs reassessment year
// 2024 = City of Chicago reassessment year  
// 2023/2026 = South/West suburbs reassessment year
export const townshipStatus: Record<string, TownshipStatus> = {
  // North Triad (reassessed 2025) - all currently closed for 2025 cycle
  "Barrington": "closed",
  "Palatine": "closed",
  "Wheeling": "closed",
  "Northfield": "closed",
  "New Trier": "closed",
  "Hanover": "closed",
  "Schaumburg": "closed",
  "Elk Grove": "closed",
  "Maine": "closed",
  "Niles": "closed",
  "Evanston": "closed",
  "Leyden": "closed",
  "Norwood Park": "closed",
  
  // City of Chicago Assessment Areas (reassessed 2024)
  "Rogers Park": "closed",
  "West Chicago": "closed",
  "South Chicago": "closed", 
  "Hyde Park": "closed",
  "Jefferson": "closed",
  "Lake": "closed",
  "Lake View": "closed",
  "North Chicago": "closed",
  "West Town": "closed",
  
  // South/West Triad (reassessed 2026) - some opening for 2026
  "Berwyn": "opening-soon",
  "Cicero": "opening-soon",
  "Oak Park": "opening-soon",
  "River Forest": "closed",
  "Proviso": "closed",
  "Riverside": "closed",
  "Lyons": "closed",
  "Stickney": "closed",
  "Lemont": "closed",
  "Palos": "closed",
  "Worth": "opening-soon",
  "Bremen": "open",
  "Calumet": "open",
  "Orland": "opening-soon",
  "Rich": "opening-soon",
  "Bloom": "open",
  "Thornton": "open",
}

// Helper to format date for display
export function formatWindowDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// Helper to get window info for a township
export function getTownshipWindowInfo(name: string): { label: string; dates: string } | null {
  const windows = townshipWindows[name]
  if (!windows) return null
  
  const status = townshipStatus[name]
  
  if (status === "open" && windows.current) {
    return {
      label: "Open",
      dates: `${formatWindowDate(windows.current.startDate)} - ${formatWindowDate(windows.current.endDate)}`
    }
  } else if (status === "opening-soon" && windows.current) {
    return {
      label: "Opens",
      dates: `${formatWindowDate(windows.current.startDate)} - ${formatWindowDate(windows.current.endDate)}`
    }
  } else if (status === "closed" && windows.last) {
    return {
      label: "Last window",
      dates: `${formatWindowDate(windows.last.startDate)} - ${formatWindowDate(windows.last.endDate)}`
    }
  }
  
  return null
}

// ViewBox: 0 0 400 500 (approximately 30 mi E-W x 38 mi N-S)
// Grid-based layout matching actual Cook County geography
// Lake Michigan is on the east side

export const townships: TownshipData[] = [
  // ============ NORTH TRIAD ============
  // Row 1 - Northern edge
  { 
    name: "Barrington", 
    status: townshipStatus["Barrington"],
    path: "M0,0 L85,0 L85,60 L0,60 Z",
    center: [42, 30],
    triad: "north"
  },
  { 
    name: "Palatine", 
    status: townshipStatus["Palatine"],
    path: "M85,0 L170,0 L170,60 L85,60 Z",
    center: [127, 30],
    triad: "north"
  },
  { 
    name: "Wheeling", 
    status: townshipStatus["Wheeling"],
    path: "M170,0 L255,0 L255,60 L170,60 Z",
    center: [212, 30],
    triad: "north"
  },
  { 
    name: "Northfield", 
    status: townshipStatus["Northfield"],
    path: "M255,0 L340,0 L340,60 L255,60 Z",
    center: [297, 30],
    triad: "north"
  },
  { 
    name: "New Trier", 
    status: townshipStatus["New Trier"],
    path: "M340,0 L400,0 L400,60 L340,60 Z",
    center: [370, 30],
    triad: "north"
  },
  
  // Row 2
  { 
    name: "Hanover", 
    status: townshipStatus["Hanover"],
    path: "M0,60 L85,60 L85,120 L0,120 Z",
    center: [42, 90],
    triad: "north"
  },
  { 
    name: "Schaumburg", 
    status: townshipStatus["Schaumburg"],
    path: "M85,60 L170,60 L170,120 L85,120 Z",
    center: [127, 90],
    triad: "north"
  },
  { 
    name: "Elk Grove", 
    status: townshipStatus["Elk Grove"],
    path: "M170,60 L255,60 L255,120 L170,120 Z",
    center: [212, 90],
    triad: "north"
  },
  { 
    name: "Maine", 
    status: townshipStatus["Maine"],
    path: "M255,60 L340,60 L340,120 L255,120 Z",
    center: [297, 90],
    triad: "north"
  },
  { 
    name: "Niles", 
    status: townshipStatus["Niles"],
    path: "M340,60 L400,60 L400,95 L340,95 Z",
    center: [370, 77],
    triad: "north"
  },
  { 
    name: "Evanston", 
    status: townshipStatus["Evanston"],
    path: "M340,95 L400,95 L400,130 L340,130 Z",
    center: [370, 112],
    triad: "north"
  },

  // Row 3 - partial
  { 
    name: "Leyden", 
    status: townshipStatus["Leyden"],
    path: "M170,120 L255,120 L255,175 L170,175 Z",
    center: [212, 147],
    triad: "north"
  },
  { 
    name: "Norwood Park", 
    status: townshipStatus["Norwood Park"],
    path: "M255,120 L340,120 L340,175 L255,175 Z",
    center: [297, 147],
    triad: "north"
  },
  
  // ============ CITY OF CHICAGO (broken into assessment areas) ============
  { 
    name: "Rogers Park", 
    status: townshipStatus["Rogers Park"],
    path: "M340,130 L400,130 L400,165 L340,165 Z",
    center: [370, 147],
    triad: "city"
  },
  { 
    name: "Lake View", 
    status: townshipStatus["Lake View"],
    path: "M340,165 L400,165 L400,210 L340,210 Z",
    center: [370, 187],
    triad: "city"
  },
  { 
    name: "North Chicago", 
    status: townshipStatus["North Chicago"],
    path: "M300,175 L340,175 L340,230 L300,230 Z",
    center: [320, 202],
    triad: "city"
  },
  { 
    name: "Lake", 
    status: townshipStatus["Lake"],
    path: "M340,210 L400,210 L400,255 L340,255 Z",
    center: [370, 232],
    triad: "city"
  },
  { 
    name: "West Town", 
    status: townshipStatus["West Town"],
    path: "M255,175 L300,175 L300,230 L255,230 Z",
    center: [277, 202],
    triad: "city"
  },
  { 
    name: "West Chicago", 
    status: townshipStatus["West Chicago"],
    path: "M255,230 L340,230 L340,290 L255,290 Z",
    center: [297, 260],
    triad: "city"
  },
  { 
    name: "South Chicago", 
    status: townshipStatus["South Chicago"],
    path: "M340,255 L400,255 L400,340 L340,340 Z",
    center: [370, 297],
    triad: "city"
  },
  { 
    name: "Hyde Park", 
    status: townshipStatus["Hyde Park"],
    path: "M300,290 L340,290 L340,340 L300,340 Z",
    center: [320, 315],
    triad: "city"
  },
  { 
    name: "Jefferson", 
    status: townshipStatus["Jefferson"],
    path: "M255,290 L300,290 L300,340 L255,340 Z",
    center: [277, 315],
    triad: "city"
  },
  
  // ============ SOUTH/WEST TRIAD ============
  { 
    name: "Proviso", 
    status: townshipStatus["Proviso"],
    path: "M100,120 L170,120 L170,190 L100,190 Z",
    center: [135, 155],
    triad: "south"
  },
  { 
    name: "River Forest", 
    status: townshipStatus["River Forest"],
    path: "M170,175 L210,175 L210,205 L170,205 Z",
    center: [190, 190],
    triad: "south"
  },
  { 
    name: "Oak Park", 
    status: townshipStatus["Oak Park"],
    path: "M210,175 L255,175 L255,230 L210,230 L210,205 L210,175 Z",
    center: [232, 202],
    triad: "south"
  },
  { 
    name: "Cicero", 
    status: townshipStatus["Cicero"],
    path: "M210,230 L255,230 L255,290 L210,290 Z",
    center: [232, 260],
    triad: "south"
  },
  { 
    name: "Berwyn", 
    status: townshipStatus["Berwyn"],
    path: "M170,205 L210,205 L210,250 L170,250 Z",
    center: [190, 227],
    triad: "south"
  },
  { 
    name: "Lyons", 
    status: townshipStatus["Lyons"],
    path: "M100,190 L170,190 L170,290 L100,290 Z",
    center: [135, 240],
    triad: "south"
  },
  { 
    name: "Riverside", 
    status: townshipStatus["Riverside"],
    path: "M170,250 L210,250 L210,290 L170,290 Z",
    center: [190, 270],
    triad: "south"
  },
  { 
    name: "Stickney", 
    status: townshipStatus["Stickney"],
    path: "M210,290 L255,290 L255,340 L210,340 Z",
    center: [232, 315],
    triad: "south"
  },
  { 
    name: "Lemont", 
    status: townshipStatus["Lemont"],
    path: "M20,290 L100,290 L100,380 L20,380 Z",
    center: [60, 335],
    triad: "south"
  },
  { 
    name: "Palos", 
    status: townshipStatus["Palos"],
    path: "M100,290 L170,290 L170,380 L100,380 Z",
    center: [135, 335],
    triad: "south"
  },
  { 
    name: "Worth", 
    status: townshipStatus["Worth"],
    path: "M170,290 L210,290 L210,340 L255,340 L255,380 L170,380 Z",
    center: [200, 345],
    triad: "south"
  },
  { 
    name: "Bremen", 
    status: townshipStatus["Bremen"],
    path: "M255,340 L340,340 L340,380 L255,380 Z",
    center: [297, 360],
    triad: "south"
  },
  { 
    name: "Calumet", 
    status: townshipStatus["Calumet"],
    path: "M340,340 L400,340 L400,380 L340,380 Z",
    center: [370, 360],
    triad: "south"
  },
  
  // Row - Southern edge
  { 
    name: "Orland", 
    status: townshipStatus["Orland"],
    path: "M100,380 L185,380 L185,460 L100,460 Z",
    center: [142, 420],
    triad: "south"
  },
  { 
    name: "Rich", 
    status: townshipStatus["Rich"],
    path: "M185,380 L270,380 L270,460 L185,460 Z",
    center: [227, 420],
    triad: "south"
  },
  { 
    name: "Bloom", 
    status: townshipStatus["Bloom"],
    path: "M270,380 L340,380 L340,460 L270,460 Z",
    center: [305, 420],
    triad: "south"
  },
  { 
    name: "Thornton", 
    status: townshipStatus["Thornton"],
    path: "M340,380 L400,380 L400,460 L340,460 Z",
    center: [370, 420],
    triad: "south"
  },
]

export const statusColors = {
  open: "#22c55e", // Green - appeals currently open
  "opening-soon": "#f59e0b", // Amber - opening within 30 days
  closed: "currentColor", // Use theme color
}

export const statusLabels = {
  open: "Appeals Open",
  "opening-soon": "Opening Soon",
  closed: "Window Closed",
}

export const triadInfo = {
  north: {
    name: "North Suburbs",
    reassessmentYear: 2025,
    nextReassessment: 2028,
  },
  south: {
    name: "South & West Suburbs", 
    reassessmentYear: 2023,
    nextReassessment: 2026,
  },
  city: {
    name: "City of Chicago",
    reassessmentYear: 2024,
    nextReassessment: 2027,
  },
}
