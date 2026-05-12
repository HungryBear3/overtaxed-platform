// Shared packet-input assembler. Used by:
//   - /api/appeals/[id]/download-summary  (DIY / interactive download)
//   - /lib/packet/generate-and-deliver    (paid DIY Pro webhook fulfillment)
//   - T3/T4 higher-touch tiers            (future — same engine, different service wrapper)
//
// Deterministic: given the same Appeal + its compsUsed, returns the same AppealSummaryData.
// Optional Maps/StreetView enrichment is gated on GOOGLE_MAPS_API_KEY — no-ops otherwise.

import type { AppealSummaryData } from "@/lib/document-generation/appeal-summary"
import { formatPIN, getAddressByPIN, haversineMiles } from "@/lib/cook-county"
import { getFullPropertyByPin } from "@/lib/realie"
import { enrichCompsWithRealie } from "@/lib/comps/enrich-with-realie"

const ADDRESS_CONCURRENCY = 5

export interface AppealForPacket {
  id: string
  taxYear: number
  appealType: string
  status: string
  originalAssessmentValue: unknown
  requestedAssessmentValue: unknown
  filingDeadline: Date
  noticeDate: Date | null
  evidenceSummary: string | null
  property: {
    address: string | null
    city: string | null
    state: string | null
    zipCode: string | null
    pin: string
    county: string
    neighborhood: string | null
    subdivision: string | null
    block: string | null
    buildingClass: string | null
    cdu: string | null
    livingArea: number | null
    landSize: number | null
    yearBuilt: number | null
    bedrooms: number | null
    bathrooms: unknown
    currentAssessmentValue: unknown
    currentLandValue: unknown
    currentImprovementValue: unknown
    currentMarketValue: unknown
  } | null
  compsUsed: Array<{
    pin: string
    address: string | null
    compType: string
    dataSource: string | null
    neighborhood: string | null
    buildingClass: string | null
    bedrooms: number | null
    bathrooms: unknown
    salePrice: unknown
    saleDate: Date | null
    livingArea: number | null
    yearBuilt: number | null
    pricePerSqft: unknown
    assessedMarketValue: unknown
    assessedMarketValuePerSqft: unknown
    distanceFromSubject: unknown
  }>
}

export interface PacketInputsResult {
  data: AppealSummaryData
  subjectLat: number | null
  subjectLon: number | null
  compCoordsList: Array<{ lat: number; lng: number } | null>
  compAddrList: Array<{ address: string; city: string } | null>
  /**
   * Diagnostics the caller can use to decide MANUAL_REVIEW.
   * - compCount: number of usable comps on the appeal
   * - requestedAssessmentValue: null when the appeal has no proposed value
   */
  diagnostics: {
    compCount: number
    requestedAssessmentValue: number | null
    hasSubjectEnrichment: boolean
  }
}

export async function buildPacketInputs(appeal: AppealForPacket): Promise<PacketInputsResult> {
  if (!appeal.property) {
    throw new Error("Property data missing for appeal")
  }

  const safeFormatPIN = (pin: string | null | undefined) => formatPIN(String(pin ?? ""))

  const subjectRealie = await getFullPropertyByPin(
    appeal.property.pin.replace(/\D/g, "") || appeal.property.pin,
  ).catch(() => null)

  const list = appeal.compsUsed
  const subjectPin = appeal.property.pin.replace(/\D/g, "") || appeal.property.pin
  const subjectAddr = await getAddressByPIN(subjectPin).catch(() => null)
  const subjectLat = subjectAddr?.latitude ?? null
  const subjectLon = subjectAddr?.longitude ?? null

  const compCoordsByPin = new Map<string, { lat: number; lng: number }>()
  const compAddrByPin = new Map<string, { address: string; city: string }>()
  for (let i = 0; i < list.length; i += ADDRESS_CONCURRENCY) {
    const batch = list.slice(i, i + ADDRESS_CONCURRENCY)
    const results = await Promise.all(
      batch.map((c) => getAddressByPIN(c.pin.replace(/\D/g, "") || c.pin).catch(() => null)),
    )
    batch.forEach((c, j) => {
      const addr = results[j]
      if (addr?.latitude != null && addr?.longitude != null) {
        compCoordsByPin.set(c.pin, { lat: addr.latitude, lng: addr.longitude })
        const addrStr = addr.address || c.address
        if (addrStr) compAddrByPin.set(c.pin, { address: addrStr, city: addr.city || "Chicago" })
      }
    })
  }

  const compCoordsList = list.map((c) => compCoordsByPin.get(c.pin) ?? null)
  const compAddrList = list.map((c) => compAddrByPin.get(c.pin) ?? null)

  const countyList = list.map((c) => {
    const livingArea = c.livingArea ?? null
    const yearBuilt = c.yearBuilt ?? null
    const bedrooms = c.bedrooms ?? null
    const bathrooms = c.bathrooms != null ? Number(c.bathrooms) : null
    const salePrice = c.salePrice != null ? Number(c.salePrice) : null
    const pricePerSqft =
      c.pricePerSqft != null
        ? Number(c.pricePerSqft)
        : livingArea != null && livingArea > 0 && salePrice != null && salePrice > 0
          ? salePrice / livingArea
          : null
    let distanceFromSubject: number | null =
      c.distanceFromSubject != null ? Number(c.distanceFromSubject) : null
    if (distanceFromSubject == null && subjectLat != null && subjectLon != null) {
      const coords = compCoordsByPin.get(c.pin)
      if (coords) {
        distanceFromSubject = haversineMiles(subjectLat, subjectLon, coords.lat, coords.lng)
      }
    }
    return {
      pin: safeFormatPIN(c.pin),
      pinRaw: c.pin,
      address: c.address ?? "",
      compType: c.compType,
      dataSource: c.dataSource ?? "Cook County Open Data",
      neighborhood: c.neighborhood ?? null,
      buildingClass: c.buildingClass ?? null,
      bedrooms,
      bathrooms,
      salePrice,
      saleDate: c.saleDate?.toISOString() ?? null,
      livingArea,
      yearBuilt,
      pricePerSqft,
      assessedMarketValue: c.assessedMarketValue != null ? Number(c.assessedMarketValue) : null,
      assessedMarketValuePerSqft:
        c.assessedMarketValuePerSqft != null ? Number(c.assessedMarketValuePerSqft) : null,
      distanceFromSubject,
    }
  })

  const enriched = await enrichCompsWithRealie(countyList, { maxRealie: 15 }).catch(() => countyList)
  const comps = enriched.map((e) => ({
    pin: e.pin,
    address: e.address,
    compType: e.compType,
    dataSource: (e as { dataSource?: string }).dataSource ?? "Cook County Open Data",
    neighborhood: e.neighborhood,
    buildingClass: e.buildingClass,
    bedrooms: e.bedrooms,
    bathrooms: e.bathrooms,
    salePrice: e.salePrice,
    saleDate: e.saleDate,
    livingArea: e.livingArea,
    yearBuilt: e.yearBuilt,
    pricePerSqft: e.pricePerSqft,
    assessedMarketValue: e.assessedMarketValue,
    assessedMarketValuePerSqft: e.assessedMarketValuePerSqft,
    distanceFromSubject: e.distanceFromSubject,
    inBothSources: (e as { inBothSources?: boolean }).inBothSources,
    livingAreaRealie: (e as { livingAreaRealie?: number | null }).livingAreaRealie,
    yearBuiltRealie: (e as { yearBuiltRealie?: number | null }).yearBuiltRealie,
    bedroomsRealie: (e as { bedroomsRealie?: number | null }).bedroomsRealie,
    bathroomsRealie: (e as { bathroomsRealie?: number | null }).bathroomsRealie,
  }))

  const subLivingCo = appeal.property.livingArea ?? null
  const subLivingRe = subjectRealie?.livingArea ?? null
  const subYrCo = appeal.property.yearBuilt ?? null
  const subYrRe = subjectRealie?.yearBuilt ?? null
  const subBedCo = appeal.property.bedrooms ?? null
  const subBedRe = subjectRealie?.bedrooms ?? null
  const subBathCo = appeal.property.bathrooms != null ? Number(appeal.property.bathrooms) : null
  const subBathRe = subjectRealie?.bathrooms ?? null

  const data: AppealSummaryData = {
    property: {
      address: appeal.property.address ?? "",
      city: appeal.property.city ?? "",
      state: appeal.property.state ?? "IL",
      zipCode: appeal.property.zipCode ?? "",
      pin: safeFormatPIN(appeal.property.pin),
      county: appeal.property.county,
      neighborhood: appeal.property.neighborhood ?? subjectRealie?.neighborhood ?? null,
      subdivision: appeal.property.subdivision ?? subjectRealie?.subdivision ?? null,
      block: appeal.property.block,
      buildingClass: appeal.property.buildingClass,
      cdu: appeal.property.cdu,
      livingArea: subLivingCo ?? subLivingRe ?? null,
      landSize: appeal.property.landSize ?? subjectRealie?.landArea ?? null,
      yearBuilt: subYrCo ?? subYrRe ?? null,
      bedrooms: subBedCo ?? subBedRe ?? null,
      bathrooms: subBathCo ?? subBathRe ?? null,
      livingAreaCounty: subLivingCo,
      livingAreaRealie: subLivingRe,
      yearBuiltCounty: subYrCo,
      yearBuiltRealie: subYrRe,
      bedroomsCounty: subBedCo,
      bedroomsRealie: subBedRe,
      bathroomsCounty: subBathCo,
      bathroomsRealie: subBathRe,
      currentAssessmentValue:
        appeal.property.currentAssessmentValue != null ? Number(appeal.property.currentAssessmentValue) : null,
      currentLandValue:
        appeal.property.currentLandValue != null ? Number(appeal.property.currentLandValue) : null,
      currentImprovementValue:
        appeal.property.currentImprovementValue != null ? Number(appeal.property.currentImprovementValue) : null,
      currentMarketValue:
        appeal.property.currentMarketValue != null ? Number(appeal.property.currentMarketValue) : null,
    },
    appeal: {
      taxYear: appeal.taxYear,
      appealType: appeal.appealType,
      status: appeal.status,
      originalAssessmentValue: Number(appeal.originalAssessmentValue),
      requestedAssessmentValue:
        appeal.requestedAssessmentValue != null ? Number(appeal.requestedAssessmentValue) : null,
      filingDeadline: appeal.filingDeadline.toISOString(),
      noticeDate: appeal.noticeDate?.toISOString() ?? null,
      evidenceSummary: appeal.evidenceSummary ?? null,
    },
    comps,
  }

  const requestedNum =
    appeal.requestedAssessmentValue != null ? Number(appeal.requestedAssessmentValue) : null

  return {
    data,
    subjectLat,
    subjectLon,
    compCoordsList,
    compAddrList,
    diagnostics: {
      compCount: comps.length,
      requestedAssessmentValue:
        requestedNum != null && !Number.isNaN(requestedNum) && requestedNum > 0 ? requestedNum : null,
      hasSubjectEnrichment: subjectRealie != null,
    },
  }
}
