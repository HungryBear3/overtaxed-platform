/**
 * Regenerate the checked-in decision-export artifacts from their source of
 * truth in lib/analytics/decision-export:
 *
 *   data/analytics/ot-decision-export-mapping.v1.json
 *   fixtures/analytics/decision-packet/<document>.synthetic.json
 *
 * Local file writes only: synthetic data, no network, no credentials. The
 * decision-export test fails whenever these files and the code disagree.
 *
 *   npx tsx scripts/write-decision-export-artifacts.ts
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  buildDecisionExportMappingContract,
  generateSyntheticDecisionFixtures,
  serializeDecisionDocument,
} from "@/lib/analytics/decision-export"

const root = resolve(__dirname, "..")
const fixtureDir = resolve(root, "fixtures/analytics/decision-packet")
mkdirSync(fixtureDir, { recursive: true })

writeFileSync(
  resolve(root, "data/analytics/ot-decision-export-mapping.v1.json"),
  serializeDecisionDocument(buildDecisionExportMappingContract()),
)
for (const [name, document] of Object.entries(generateSyntheticDecisionFixtures())) {
  writeFileSync(resolve(fixtureDir, `${name}.synthetic.json`), serializeDecisionDocument(document))
}
console.log("decision-export artifacts written")
