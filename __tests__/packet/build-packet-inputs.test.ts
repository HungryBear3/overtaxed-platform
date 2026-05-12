/**
 * buildPacketInputs — assembler parity tests.
 *
 * The assembler is the shared extraction from /api/appeals/[id]/download-summary.
 * We stub external enrichers (Realie, Cook County address lookup) and verify the
 * diagnostics block returns truthful values for the weak-data gate to consume.
 */

jest.mock("@/lib/cook-county", () => ({
  formatPIN: (pin: string) => pin,
  getAddressByPIN: jest.fn(async () => null),
  haversineMiles: jest.fn(() => 0),
}))
jest.mock("@/lib/realie", () => ({
  getFullPropertyByPin: jest.fn(async () => null),
}))
jest.mock("@/lib/comps/enrich-with-realie", () => ({
  enrichCompsWithRealie: jest.fn(async (list: unknown[]) => list),
}))

import { buildPacketInputs, type AppealForPacket } from "@/lib/packet/build-packet-inputs"

function makeAppeal(overrides: Partial<AppealForPacket> = {}): AppealForPacket {
  return {
    id: "appeal_test",
    taxYear: 2025,
    appealType: "ASSESSOR",
    status: "DRAFT",
    originalAssessmentValue: 300000,
    requestedAssessmentValue: null,
    filingDeadline: new Date("2025-09-01T00:00:00Z"),
    noticeDate: null,
    evidenceSummary: null,
    property: {
      address: "123 Elm",
      city: "Chicago",
      state: "IL",
      zipCode: "60601",
      pin: "12345678901234",
      county: "Cook",
      neighborhood: null,
      subdivision: null,
      block: null,
      buildingClass: null,
      cdu: null,
      livingArea: 1500,
      landSize: 3000,
      yearBuilt: 1990,
      bedrooms: 3,
      bathrooms: 2,
      currentAssessmentValue: 300000,
      currentLandValue: 50000,
      currentImprovementValue: 250000,
      currentMarketValue: 310000,
    },
    compsUsed: [],
    ...overrides,
  }
}

describe("buildPacketInputs — diagnostics", () => {
  it("reports 0 comps and null requested when both are empty", async () => {
    const result = await buildPacketInputs(makeAppeal())
    expect(result.diagnostics.compCount).toBe(0)
    expect(result.diagnostics.requestedAssessmentValue).toBeNull()
  })

  it("reports comp count from compsUsed length", async () => {
    const comp = {
      pin: "99999999999999",
      address: "100 Maple",
      compType: "SALES",
      dataSource: null,
      neighborhood: null,
      buildingClass: null,
      bedrooms: 3,
      bathrooms: 2,
      salePrice: 350000,
      saleDate: new Date("2024-06-01T00:00:00Z"),
      livingArea: 1500,
      yearBuilt: 1990,
      pricePerSqft: null,
      assessedMarketValue: null,
      assessedMarketValuePerSqft: null,
      distanceFromSubject: 0.3,
    }
    const result = await buildPacketInputs(makeAppeal({ compsUsed: [comp, comp, comp, comp] }))
    expect(result.diagnostics.compCount).toBe(4)
  })

  it("parses requestedAssessmentValue to a number", async () => {
    const result = await buildPacketInputs(makeAppeal({ requestedAssessmentValue: "275000" }))
    expect(result.diagnostics.requestedAssessmentValue).toBe(275000)
  })

  it("treats 0 or negative requested as null (weak data)", async () => {
    const zero = await buildPacketInputs(makeAppeal({ requestedAssessmentValue: 0 }))
    expect(zero.diagnostics.requestedAssessmentValue).toBeNull()
    const neg = await buildPacketInputs(makeAppeal({ requestedAssessmentValue: -5 }))
    expect(neg.diagnostics.requestedAssessmentValue).toBeNull()
  })

  it("throws when property is missing (not allowed to fake a packet)", async () => {
    await expect(buildPacketInputs(makeAppeal({ property: null }))).rejects.toThrow(/Property data missing/)
  })

  it("emits an AppealSummaryData shape the PDF generator accepts", async () => {
    const { data } = await buildPacketInputs(makeAppeal({ requestedAssessmentValue: 250000 }))
    expect(data.property.pin).toBe("12345678901234")
    expect(data.appeal.taxYear).toBe(2025)
    expect(data.appeal.requestedAssessmentValue).toBe(250000)
    expect(Array.isArray(data.comps)).toBe(true)
  })
})
