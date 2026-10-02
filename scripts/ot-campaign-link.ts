/**
 * Print the canonical campaign URL for one experiment in the checked-in OT
 * experiment registry (lib/analytics/campaign-link-builder).
 *
 * This script makes no request, reads no credential and writes nothing. It
 * reads only data/analytics/ot-experiment-registry.v1.json — there is no flag
 * to point it at another registry — and prints exactly one URL on success.
 *
 *   npx tsx scripts/ot-campaign-link.ts --experiment ot_exp_2026_001
 *
 * Exit status: 0 URL printed, 2 refused (code and value-free lint findings on
 * stderr, nothing on stdout), 64 usage.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { buildCampaignLink } from "@/lib/analytics/campaign-link-builder"

type Io = { out: (text: string) => void; err: (text: string) => void; readFile: (path: string) => string }

const USAGE = "usage: ot-campaign-link --experiment <experiment_id>"

const REGISTRY_PATH = join(__dirname, "..", "data", "analytics", "ot-experiment-registry.v1.json")

export function main(argv: string[], io: Io): number {
  if (argv.length !== 2 || argv[0] !== "--experiment") {
    io.err(USAGE)
    return 64
  }
  let text: string
  try {
    text = io.readFile(REGISTRY_PATH)
  } catch {
    io.err("refused: REGISTRY_UNREADABLE")
    return 2
  }
  const result = buildCampaignLink(text, argv[1])
  if (result.ok) {
    io.out(`${result.url}\n`)
    return 0
  }
  const findings = "issues" in result ? result.issues.map((issue) => ` ${issue.code}@${issue.path}`).join("") : ""
  io.err(`refused: ${result.code}${findings}`)
  return 2
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(`${text}\n`),
    readFile: (path) => readFileSync(path, "utf8"),
  })
}
