import "server-only"
/**
 * Server-owned filing window. Fixed UNKNOWN and nonactionable until a separate,
 * versioned, owner-approved window policy exists. No dates, no OPEN/CLOSED.
 */
export const OFFICIAL_WINDOW = Object.freeze({ state: "UNKNOWN" as const, actionable: false as const })

export function currentOfficialWindow(): typeof OFFICIAL_WINDOW {
  return OFFICIAL_WINDOW
}
