/**
 * Read-only OT funnel drop-off report (lib/analytics/funnel-dropoff-report).
 *
 * This script makes no request and reads no credential. It prints the exact
 * GA4 Data API requests for an operator to run under the read-only Analytics
 * scope, and turns the saved responses into the versioned report.
 *
 *   npx tsx scripts/ot-funnel-dropoff-report.ts requests \
 *     --property-id 123456789 --start 2026-09-01 --end 2026-09-28 > bundle.json
 *   # operator: POST each bundle.requests[i].body to bundle.requests[i].url,
 *   # save the response bodies, in order, as one JSON array: responses.json
 *   npx tsx scripts/ot-funnel-dropoff-report.ts report \
 *     --bundle bundle.json --responses responses.json > report.json
 *
 * Exit status: 0 report OK, 1 report INCONCLUSIVE, 2 invalid input or
 * response (the report still prints, with no funnel), 64 usage.
 */
import { readFileSync } from "node:fs"

import { buildFunnelDropoffRequests, evaluateFunnelDropoff } from "@/lib/analytics/funnel-dropoff-report"

type Io = { out: (text: string) => void; err: (text: string) => void; readFile: (path: string) => string }

const USAGE =
  "usage: ot-funnel-dropoff-report requests --property-id <id> --start <YYYY-MM-DD> --end <YYYY-MM-DD>\n" +
  "       ot-funnel-dropoff-report report --bundle <file> --responses <file>"

function flags(args: string[], names: readonly string[]): Record<string, string> | null {
  const out: Record<string, string> = {}
  if (args.length !== names.length * 2) return null
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index].startsWith("--") ? args[index].slice(2) : ""
    if (!names.includes(name) || Object.prototype.hasOwnProperty.call(out, name)) return null
    out[name] = args[index + 1]
  }
  return out
}

function readJson(io: Io, path: string): unknown {
  try {
    return JSON.parse(io.readFile(path))
  } catch {
    return undefined
  }
}

export function main(argv: string[], io: Io): number {
  const [command, ...rest] = argv
  if (command === "requests") {
    const args = flags(rest, ["property-id", "start", "end"])
    if (!args) {
      io.err(USAGE)
      return 64
    }
    const built = buildFunnelDropoffRequests({ propertyId: args["property-id"], startDate: args.start, endDate: args.end })
    if (!built.ok) {
      io.err(`invalid input: ${built.violations.join(",")}`)
      return 2
    }
    io.out(`${JSON.stringify(built.bundle, null, 2)}\n`)
    return 0
  }
  if (command === "report") {
    const args = flags(rest, ["bundle", "responses"])
    if (!args) {
      io.err(USAGE)
      return 64
    }
    const report = evaluateFunnelDropoff(readJson(io, args.bundle), readJson(io, args.responses))
    io.out(`${JSON.stringify(report, null, 2)}\n`)
    return report.status === "OK" ? 0 : report.status === "INCONCLUSIVE" ? 1 : 2
  }
  io.err(USAGE)
  return 64
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(`${text}\n`),
    readFile: (path) => readFileSync(path, "utf8"),
  })
}
