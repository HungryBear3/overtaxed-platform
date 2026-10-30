/**
 * LOCAL SYNTHETIC fixture acquisition for tests and the instrumented driver.
 *
 * Nothing here is a Cook County record. Every parcel is invented, labelled
 * SYNTHETIC_PREVIEW, and resolves only for the fixed synthetic address/PIN
 * below. Production modules must never import this file.
 */
import type {
  Acquisition,
  AcquisitionRequest,
  FactualAcquisitionAdapter,
} from "@/lib/evidence/server/factual-analysis"
import { createInMemoryAnalysisStore } from "@/lib/evidence/server/analysis-store"
import { createFreeCheckRoute } from "@/lib/evidence/server/free-check-handler"

export const SYNTHETIC_SUBJECT_PIN = "18-06-214-011-0000"
export const SYNTHETIC_ADDRESS = "100 Synthetic Preview Ave"
export const SYNTHETIC_SECOND_PIN = "18-06-214-021-0000"
export const SYNTHETIC_SECOND_ADDRESS = "200 Synthetic Preview Ave"

type Parcel = Extract<Acquisition, { ok: true }>["parcels"][number]

function parcels(subjectPin: string, subjectCents: number, township: "Cicero" | "Berwyn"): Acquisition {
  const cohort: Parcel[] = [
    { pin: township === "Cicero" ? "18-06-214-012-0000" : "18-06-214-022-0000", role: "cohort", taxYear: 2025, assessedTotalCents: 3_640_000, landCents: 900_000, buildingCents: 2_740_000, propertyClass: "2-03", township, neighborhoodCode: "78-120", sourceId: "ccao_assessed_values", parcelSourceId: "ccao_parcel_universe", recordDate: null },
    { pin: township === "Cicero" ? "18-06-214-013-0000" : "18-06-214-023-0000", role: "cohort", taxYear: 2025, assessedTotalCents: 3_480_000, landCents: 880_000, buildingCents: 2_600_000, propertyClass: "2-03", township, neighborhoodCode: "78-120", sourceId: "ccao_assessed_values", parcelSourceId: "ccao_parcel_universe", recordDate: "2025-04-01" },
    { pin: township === "Cicero" ? "18-06-214-014-0000" : "18-06-214-024-0000", role: "cohort", taxYear: 2025, assessedTotalCents: 3_410_000, landCents: 870_000, buildingCents: 2_540_000, propertyClass: "2-03", township, neighborhoodCode: "78-120", sourceId: "ccao_assessed_values", parcelSourceId: "ccao_parcel_universe", recordDate: null },
  ]
  return {
    ok: true,
    origin: "SYNTHETIC_PREVIEW",
    atomic: true,
    sources: ["ccao_assessed_values", "ccao_parcel_universe"],
    subject: { pin: subjectPin, township, taxYear: 2025 },
    cohort: { neighborhoodCode: "78-120", propertyClass: "2-03" },
    parcels: [
      { pin: subjectPin, role: "subject", taxYear: 2025, assessedTotalCents: subjectCents, landCents: 1_000_000, buildingCents: subjectCents - 1_000_000, propertyClass: "2-03", township, neighborhoodCode: "78-120", sourceId: "ccao_assessed_values", parcelSourceId: "ccao_parcel_universe", recordDate: null },
      ...cohort,
    ],
  }
}

/** Driver/test-only adapter. Resolves the synthetic address or PIN; holds on anything else. */
export function createSyntheticAdapter(
  overrides: { delayMs?: Record<string, number>; mutate?: (a: Acquisition) => Acquisition } = {},
): FactualAcquisitionAdapter {
  return {
    id: "local-synthetic-fixture",
    addressSource: {
      async search() {
        return {ok:true,records:[
          {pin:SYNTHETIC_SUBJECT_PIN,address:SYNTHETIC_ADDRESS,city:"Cicero",zip:""},
          {pin:SYNTHETIC_SECOND_PIN,address:SYNTHETIC_SECOND_ADDRESS,city:"Berwyn",zip:""},
        ]}
      },
      async load(pin) {
        const first=pin===SYNTHETIC_SUBJECT_PIN.replace(/-/g,"")
        if (!first && pin!==SYNTHETIC_SECOND_PIN.replace(/-/g,"")) return null
        return {pin,address:first?SYNTHETIC_ADDRESS:SYNTHETIC_SECOND_ADDRESS,city:first?"Cicero":"Berwyn",zip:"",county:"Cook",township:first?"Cicero":"Berwyn",taxYear:2025}
      },
    },
    async acquire(req: AcquisitionRequest): Promise<Acquisition> {
      const key = (req.pin ?? req.address ?? "").trim()
      const delay = overrides.delayMs?.[key] ?? 0
      if (delay) await new Promise((r) => setTimeout(r, delay))
      let acq: Acquisition
      if (key === SYNTHETIC_SUBJECT_PIN.replace(/\D/g, "") || key === SYNTHETIC_SUBJECT_PIN || key === SYNTHETIC_ADDRESS) {
        acq = parcels(SYNTHETIC_SUBJECT_PIN, 4_250_000, "Cicero")
      } else if (key === SYNTHETIC_SECOND_PIN.replace(/\D/g, "") || key === SYNTHETIC_SECOND_PIN || key === SYNTHETIC_SECOND_ADDRESS) {
        acq = parcels(SYNTHETIC_SECOND_PIN, 3_900_000, "Berwyn")
      } else {
        acq = { ok: false, hold: "ACQUISITION_UNSUPPORTED" }
      }
      return overrides.mutate ? overrides.mutate(acq) : acq
    },
  }
}

export function createFactualLocalRuntime(adapterOverrides?: Parameters<typeof createSyntheticAdapter>[0]) {
  const store = createInMemoryAnalysisStore()
  const adapter = createSyntheticAdapter(adapterOverrides)
  const route = createFreeCheckRoute({ adapter, store })
  return { store, adapter, route }
}
