// Cook County township and Chicago assessment-area geometry.
//
// This module used to be the site's third appeal calendar. It carried a
// `townshipWindows` map of 2024/2025/2026 open and close dates, a
// `townshipStatus` map hand-labelling every township "open", "opening-soon", or
// "closed", and a `getTownshipWindowInfo` helper that turned the two into
// tooltip copy like "Open · May 1, 2026 - May 31, 2026". None of it had a
// source, a retrieval time, or an expiry, and the header's "Last updated: April
// 2026" was the only thing standing between a reader and a hard date.
//
// It also disagreed with the other two calendars. `triadInfo` put the South &
// West triad's reassessment at 2023 with the next in 2026, while the roster in
// lib/townships.ts assigns those same townships a 2026 cycle year and the
// North suburbs 2027 rather than 2028. Three schedules, three answers, and
// nothing to arbitrate between them — which is the defect this rebuild exists
// to remove, not a cosmetic inconsistency.
//
// What remains is what the file is actually for: SVG paths, label centers, and
// triad membership for the county map components. Geometry does not go stale.
//
// The `status` field survives on TownshipData, fixed at "unknown" for every
// row, so the map components that read it keep compiling and render the neutral
// branch. It is not a hedge — there is no longer any value in this file that
// could make it say anything else. A map that needs to show live window state
// must take a projection from lib/deadlines/official-source-state.

export type TownshipStatus = "open" | "opening-soon" | "closed" | "unknown"

export interface TownshipData {
  name: string
  /**
   * Always "unknown". Kept in the shape because the map components branch on
   * it; see the module header.
   */
  status: TownshipStatus
  path: string // SVG path data
  center: [number, number] // For label positioning [x, y]
  triad: "north" | "south" | "city" // Triennial assessment triad
}

/**
 * No window information is published from this module.
 *
 * The signature is preserved — it returns null for every township — so the
 * satellite map's existing `windowInfo && ...` guard simply renders nothing
 * instead of a date whose origin nobody can name.
 */
export function getTownshipWindowInfo(
  _name: string,
): { label: string; dates: string } | null {
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
    status: "unknown",
    path: "M0,0 L85,0 L85,60 L0,60 Z",
    center: [42, 30],
    triad: "north"
  },
  {
    name: "Palatine",
    status: "unknown",
    path: "M85,0 L170,0 L170,60 L85,60 Z",
    center: [127, 30],
    triad: "north"
  },
  {
    name: "Wheeling",
    status: "unknown",
    path: "M170,0 L255,0 L255,60 L170,60 Z",
    center: [212, 30],
    triad: "north"
  },
  {
    name: "Northfield",
    status: "unknown",
    path: "M255,0 L340,0 L340,60 L255,60 Z",
    center: [297, 30],
    triad: "north"
  },
  {
    name: "New Trier",
    status: "unknown",
    path: "M340,0 L400,0 L400,60 L340,60 Z",
    center: [370, 30],
    triad: "north"
  },

  // Row 2
  {
    name: "Hanover",
    status: "unknown",
    path: "M0,60 L85,60 L85,120 L0,120 Z",
    center: [42, 90],
    triad: "north"
  },
  {
    name: "Schaumburg",
    status: "unknown",
    path: "M85,60 L170,60 L170,120 L85,120 Z",
    center: [127, 90],
    triad: "north"
  },
  {
    name: "Elk Grove",
    status: "unknown",
    path: "M170,60 L255,60 L255,120 L170,120 Z",
    center: [212, 90],
    triad: "north"
  },
  {
    name: "Maine",
    status: "unknown",
    path: "M255,60 L340,60 L340,120 L255,120 Z",
    center: [297, 90],
    triad: "north"
  },
  {
    name: "Niles",
    status: "unknown",
    path: "M340,60 L400,60 L400,95 L340,95 Z",
    center: [370, 77],
    triad: "north"
  },
  {
    name: "Evanston",
    status: "unknown",
    path: "M340,95 L400,95 L400,130 L340,130 Z",
    center: [370, 112],
    triad: "north"
  },

  // Row 3 - partial
  {
    name: "Leyden",
    status: "unknown",
    path: "M170,120 L255,120 L255,175 L170,175 Z",
    center: [212, 147],
    triad: "north"
  },
  {
    name: "Norwood Park",
    status: "unknown",
    path: "M255,120 L340,120 L340,175 L255,175 Z",
    center: [297, 147],
    triad: "north"
  },

  // ============ CITY OF CHICAGO (broken into assessment areas) ============
  {
    name: "Rogers Park",
    status: "unknown",
    path: "M340,130 L400,130 L400,165 L340,165 Z",
    center: [370, 147],
    triad: "city"
  },
  {
    name: "Lake View",
    status: "unknown",
    path: "M340,165 L400,165 L400,210 L340,210 Z",
    center: [370, 187],
    triad: "city"
  },
  {
    name: "North Chicago",
    status: "unknown",
    path: "M300,175 L340,175 L340,230 L300,230 Z",
    center: [320, 202],
    triad: "city"
  },
  {
    name: "Lake",
    status: "unknown",
    path: "M340,210 L400,210 L400,255 L340,255 Z",
    center: [370, 232],
    triad: "city"
  },
  {
    name: "West Town",
    status: "unknown",
    path: "M255,175 L300,175 L300,230 L255,230 Z",
    center: [277, 202],
    triad: "city"
  },
  {
    name: "West Chicago",
    status: "unknown",
    path: "M255,230 L340,230 L340,290 L255,290 Z",
    center: [297, 260],
    triad: "city"
  },
  {
    name: "South Chicago",
    status: "unknown",
    path: "M340,255 L400,255 L400,340 L340,340 Z",
    center: [370, 297],
    triad: "city"
  },
  {
    name: "Hyde Park",
    status: "unknown",
    path: "M300,290 L340,290 L340,340 L300,340 Z",
    center: [320, 315],
    triad: "city"
  },
  {
    name: "Jefferson",
    status: "unknown",
    path: "M255,290 L300,290 L300,340 L255,340 Z",
    center: [277, 315],
    triad: "city"
  },

  // ============ SOUTH/WEST TRIAD ============
  {
    name: "Proviso",
    status: "unknown",
    path: "M100,120 L170,120 L170,190 L100,190 Z",
    center: [135, 155],
    triad: "south"
  },
  {
    name: "River Forest",
    status: "unknown",
    path: "M170,175 L210,175 L210,205 L170,205 Z",
    center: [190, 190],
    triad: "south"
  },
  {
    name: "Oak Park",
    status: "unknown",
    path: "M210,175 L255,175 L255,230 L210,230 L210,205 L210,175 Z",
    center: [232, 202],
    triad: "south"
  },
  {
    name: "Cicero",
    status: "unknown",
    path: "M210,230 L255,230 L255,290 L210,290 Z",
    center: [232, 260],
    triad: "south"
  },
  {
    name: "Berwyn",
    status: "unknown",
    path: "M170,205 L210,205 L210,250 L170,250 Z",
    center: [190, 227],
    triad: "south"
  },
  {
    name: "Lyons",
    status: "unknown",
    path: "M100,190 L170,190 L170,290 L100,290 Z",
    center: [135, 240],
    triad: "south"
  },
  {
    name: "Riverside",
    status: "unknown",
    path: "M170,250 L210,250 L210,290 L170,290 Z",
    center: [190, 270],
    triad: "south"
  },
  {
    name: "Stickney",
    status: "unknown",
    path: "M210,290 L255,290 L255,340 L210,340 Z",
    center: [232, 315],
    triad: "south"
  },
  {
    name: "Lemont",
    status: "unknown",
    path: "M20,290 L100,290 L100,380 L20,380 Z",
    center: [60, 335],
    triad: "south"
  },
  {
    name: "Palos",
    status: "unknown",
    path: "M100,290 L170,290 L170,380 L100,380 Z",
    center: [135, 335],
    triad: "south"
  },
  {
    name: "Worth",
    status: "unknown",
    path: "M170,290 L210,290 L210,340 L255,340 L255,380 L170,380 Z",
    center: [200, 345],
    triad: "south"
  },
  {
    name: "Bremen",
    status: "unknown",
    path: "M255,340 L340,340 L340,380 L255,380 Z",
    center: [297, 360],
    triad: "south"
  },
  {
    name: "Calumet",
    status: "unknown",
    path: "M340,340 L400,340 L400,380 L340,380 Z",
    center: [370, 360],
    triad: "south"
  },

  // Row - Southern edge
  {
    name: "Orland",
    status: "unknown",
    path: "M100,380 L185,380 L185,460 L100,460 Z",
    center: [142, 420],
    triad: "south"
  },
  {
    name: "Rich",
    status: "unknown",
    path: "M185,380 L270,380 L270,460 L185,460 Z",
    center: [227, 420],
    triad: "south"
  },
  {
    name: "Bloom",
    status: "unknown",
    path: "M270,380 L340,380 L340,460 L270,460 Z",
    center: [305, 420],
    triad: "south"
  },
  {
    name: "Thornton",
    status: "unknown",
    path: "M340,380 L400,380 L400,460 L340,460 Z",
    center: [370, 420],
    triad: "south"
  },
]

export const statusColors: Record<TownshipStatus, string> = {
  open: "currentColor",
  "opening-soon": "currentColor",
  closed: "currentColor",
  unknown: "currentColor",
}

export const statusLabels: Record<TownshipStatus, string> = {
  open: "See the deadline calendar",
  "opening-soon": "See the deadline calendar",
  closed: "See the deadline calendar",
  unknown: "See the deadline calendar",
}

// Triad membership only. The reassessment years that used to live here were a
// fourth opinion about the county calendar and contradicted the roster; a triad
// is a grouping, not a schedule.
export const triadInfo = {
  north: { name: "North Suburbs" },
  south: { name: "South & West Suburbs" },
  city: { name: "City of Chicago" },
}
