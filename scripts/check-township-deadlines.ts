/**
 * Helper script to fetch the Cook County Assessment Calendar and suggest township deadline entries.
 * Run: npx tsx scripts/check-township-deadlines.ts
 *
 * Output is meant for human review before updating lib/appeals/township-deadlines.ts.
 * The Assessor page structure may change; if parsing fails, update this script or enter data manually.
 */

const CALENDAR_URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"

async function main() {
  console.log("Fetching Assessment Calendar...")
  const res = await fetch(CALENDAR_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Overtaxed/1.0)" },
  })
  if (!res.ok) {
    console.error("Failed to fetch:", res.status)
    process.exit(1)
  }
  const html = await res.text()

  // Match patterns like:
  // Township name (link text or heading)
  // Reassessment Notice Date ... M/D/YYYY or MM/DD/YYYY
  // Last File Date ... M/D/YYYY or MM/DD/YYYY
  const townshipBlocks = html.split(/Open For Appeals|Closed For Appeals|View Details/gi)
  const entries: Array<{ township: string; noticeDate: string; lastFileDate: string }> = []

  // Simpler: look for "Last File Date" followed by date
  const lastFileRe = /Last\s+File\s+Date[\s\S]*?(\d{1,2})\/(\d{1,2})\/(\d{4})/gi
  const noticeRe = /Reassessment\s+Notice\s+Date[\s\S]*?(\d{1,2})\/(\d{1,2})\/(\d{4})/gi

  // Extract township names - they often appear as link text before "Open For Appeals" etc.
  const townshipLinks = html.matchAll(/<a[^>]+href="[^"]*valuation[^"]*"[^>]*>([^<]+)<\/a>/gi)
  const townships: string[] = []
  for (const m of townshipLinks) {
    const name = m[1].trim().replace(/\s+/g, " ")
    if (name && !townships.includes(name)) townships.push(name)
  }

  // Also catch townships from different link patterns
  const altLinks = html.matchAll(/>\s*([A-Za-z\s]+?)\s*<\/a>\s*(?:Open|Closed)/gi)
  for (const m of altLinks) {
    const name = m[1].trim().replace(/\s+/g, " ")
    if (name.length > 2 && name.length < 30 && !townships.includes(name)) townships.push(name)
  }

  const noticeDates = [...html.matchAll(noticeRe)].map((m) => {
    const [, mm, dd, yyyy] = m
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`
  })
  const lastFileDates = [...html.matchAll(lastFileRe)].map((m) => {
    const [, mm, dd, yyyy] = m
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`
  })

  // Try to pair township + notice + lastFile (order on page usually matches)
  const minLen = Math.min(townships.length, noticeDates.length, lastFileDates.length)
  for (let i = 0; i < minLen; i++) {
    const township = townships[i].toLowerCase().replace(/\s+/g, " ")
    const noticeDate = noticeDates[i]
    const lastFileDate = lastFileDates[i]
    entries.push({ township, noticeDate, lastFileDate })
  }

  if (entries.length === 0) {
    console.log("Could not parse township entries. Page structure may have changed.")
    console.log("Manually update lib/appeals/township-deadlines.ts from:")
    console.log(CALENDAR_URL)
    process.exit(0)
  }

  const taxYear = new Date().getFullYear()
  console.log("\n⚠ Township-to-date pairing may be wrong. Always verify against the official calendar.\n")
  console.log("Suggested entries for TOWNSHIP_DEADLINES_" + taxYear + ":\n")
  console.log("export const TOWNSHIP_DEADLINES_" + taxYear + ': Record<string, { noticeDate: string; lastFileDate: string }> = {')
  for (const e of entries) {
    const key = e.township.includes(" ") ? `"${e.township}"` : e.township
    console.log(`  ${key}: { noticeDate: "${e.noticeDate}", lastFileDate: "${e.lastFileDate}" },`)
  }
  console.log("}\n")
  console.log("Review the official calendar and update lib/appeals/township-deadlines.ts accordingly.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
