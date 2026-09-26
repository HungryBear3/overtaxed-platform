/** @jest-environment node */
jest.mock("server-only",()=>({}),{virtual:true})

describe("neutral delivery database boundary",()=>{
  const prior=process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL
  const priorCa=process.env.OT_NEUTRAL_DATABASE_CA_PEM
  afterEach(async()=>{
    const {disconnectNeutralDeliveryPrisma}=await import("@/lib/fulfillment-runtime/neutral-delivery-db")
    await disconnectNeutralDeliveryPrisma()
    if(prior===undefined)delete process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL;else process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL=prior
    if(priorCa===undefined)delete process.env.OT_NEUTRAL_DATABASE_CA_PEM;else process.env.OT_NEUTRAL_DATABASE_CA_PEM=priorCa
  })
  it("is disabled without a dedicated URL",async()=>{
    delete process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL
    const {neutralDeliveryPrisma}=await import("@/lib/fulfillment-runtime/neutral-delivery-db")
    expect(()=>neutralDeliveryPrisma()).toThrow("NEUTRAL_DELIVERY_DATABASE_DISABLED")
  })
  it("requires explicit TLS away from loopback",async()=>{
    process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL="postgresql://restricted@example.invalid/db"
    const {neutralDeliveryPrisma}=await import("@/lib/fulfillment-runtime/neutral-delivery-db")
    expect(()=>neutralDeliveryPrisma()).toThrow("NEUTRAL_DATABASE_VERIFY_FULL_REQUIRED")
  })
})
