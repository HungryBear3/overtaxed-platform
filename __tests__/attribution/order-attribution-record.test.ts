/** @jest-environment node */

/**
 * The durable binding itself, against an in-memory stand-in for
 * `ot_order_attribution`. No database is touched.
 *
 * The stand-in deliberately implements only the two semantics the real table
 * provides and this module depends on: `ON CONFLICT (order_id) DO NOTHING`, and
 * a primary key that makes the readback single-row.
 */

import {
  type AttributionSqlClient,
  AttributionBindingError,
  attributionMetadata,
  bindFirstTouchAttribution,
  readOrderAttribution,
} from "@/lib/attribution/record"

type StoredRow = {
  orderId: string
  campaignCode: string | null
  creativeCode: string | null
  registryVersion: string
  boundAt: Date
}

function fakeClient() {
  const table = new Map<string, StoredRow>()
  const executed: Array<{ sql: string; values: unknown[] }> = []

  const client: AttributionSqlClient & { __table: Map<string, StoredRow>; __executed: typeof executed } = {
    __table: table,
    __executed: executed,
    async $executeRaw(query: TemplateStringsArray, ...values: unknown[]) {
      const sql = query.join("?")
      executed.push({ sql, values })
      if (!/INSERT INTO "ot_order_attribution"/.test(sql)) throw new Error(`unexpected statement: ${sql}`)
      const [orderId, campaignCode, creativeCode, registryVersion] = values as [
        string,
        string | null,
        string | null,
        string,
      ]
      // ON CONFLICT (order_id) DO NOTHING — first touch wins.
      if (table.has(orderId)) return 0
      table.set(orderId, {
        orderId,
        campaignCode,
        creativeCode,
        registryVersion,
        boundAt: new Date("2026-09-12T12:00:00.000Z"),
      })
      return 1
    },
    async $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]) {
      const sql = query.join("?")
      executed.push({ sql, values })
      if (!/FROM "ot_order_attribution"/.test(sql)) throw new Error(`unexpected statement: ${sql}`)
      const row = table.get(String(values[0]))
      return (row ? [{ ...row }] : []) as T
    },
  }
  return client
}

const REGISTRY_VERSION = "synthetic_test_registry_v1"

describe("first-touch attribution binding", () => {
  it("binds an approved pair and reads it back exactly", async () => {
    const client = fakeClient()
    const row = await bindFirstTouchAttribution(client, {
      orderId: "ord_1",
      campaignCode: "synthetic_campaign_a",
      creativeCode: "synthetic_creative_1",
      registryVersion: REGISTRY_VERSION,
    })

    expect(row).toMatchObject({
      orderId: "ord_1",
      campaignCode: "synthetic_campaign_a",
      creativeCode: "synthetic_creative_1",
      registryVersion: REGISTRY_VERSION,
    })
    expect(await readOrderAttribution(client, "ord_1")).toMatchObject({ campaignCode: "synthetic_campaign_a" })
  })

  it("passes every value as a bound parameter rather than interpolating it into SQL", async () => {
    const client = fakeClient()
    await bindFirstTouchAttribution(client, {
      orderId: "ord_param",
      campaignCode: "synthetic_campaign_a",
      creativeCode: null,
      registryVersion: REGISTRY_VERSION,
    })

    const insert = client.__executed.find((entry) => entry.sql.includes("INSERT INTO"))!
    expect(insert.values).toEqual(["ord_param", "synthetic_campaign_a", null, REGISTRY_VERSION])
    // The literal must not appear in the statement text at all.
    expect(insert.sql).not.toContain("ord_param")
    expect(insert.sql).not.toContain("synthetic_campaign_a")
  })

  it("returns the ORIGINAL row when a retry offers different codes, and never writes the new ones", async () => {
    const client = fakeClient()
    await bindFirstTouchAttribution(client, {
      orderId: "ord_2",
      campaignCode: "synthetic_campaign_a",
      creativeCode: "synthetic_creative_1",
      registryVersion: REGISTRY_VERSION,
    })

    const retry = await bindFirstTouchAttribution(client, {
      orderId: "ord_2",
      campaignCode: "synthetic_campaign_b",
      creativeCode: null,
      registryVersion: REGISTRY_VERSION,
    })

    expect(retry.campaignCode).toBe("synthetic_campaign_a")
    expect(retry.creativeCode).toBe("synthetic_creative_1")
    expect(client.__table.get("ord_2")?.campaignCode).toBe("synthetic_campaign_a")
  })

  /**
   * Organic has to be a real row. If it were the absence of a row, this retry
   * would bind `synthetic_campaign_a` — an upgrade on retry.
   */
  it("preserves an ORIGINAL organic first touch against a later tagged retry", async () => {
    const client = fakeClient()
    const organic = await bindFirstTouchAttribution(client, {
      orderId: "ord_3",
      campaignCode: null,
      creativeCode: null,
      registryVersion: REGISTRY_VERSION,
    })
    expect(organic.campaignCode).toBeNull()

    const retry = await bindFirstTouchAttribution(client, {
      orderId: "ord_3",
      campaignCode: "synthetic_campaign_a",
      creativeCode: "synthetic_creative_1",
      registryVersion: REGISTRY_VERSION,
    })

    expect(retry.campaignCode).toBeNull()
    expect(retry.creativeCode).toBeNull()
    expect(client.__table.get("ord_3")?.campaignCode).toBeNull()
  })

  it("issues no UPDATE against the table under any path", async () => {
    const client = fakeClient()
    await bindFirstTouchAttribution(client, {
      orderId: "ord_4",
      campaignCode: null,
      creativeCode: null,
      registryVersion: REGISTRY_VERSION,
    })
    await bindFirstTouchAttribution(client, {
      orderId: "ord_4",
      campaignCode: "synthetic_campaign_a",
      creativeCode: null,
      registryVersion: REGISTRY_VERSION,
    })
    expect(client.__executed.some((entry) => /\bUPDATE\b/i.test(entry.sql))).toBe(false)
  })

  it("refuses to bind a value the registry could never have approved", async () => {
    const client = fakeClient()
    await expect(
      bindFirstTouchAttribution(client, {
        orderId: "ord_5",
        campaignCode: "buyer@example.com",
        creativeCode: null,
        registryVersion: REGISTRY_VERSION,
      }),
    ).rejects.toThrow(AttributionBindingError)
    expect(client.__table.size).toBe(0)
  })

  it("refuses a creative without its campaign, mirroring the SQL CHECK", async () => {
    const client = fakeClient()
    await expect(
      bindFirstTouchAttribution(client, {
        orderId: "ord_6",
        campaignCode: null,
        creativeCode: "synthetic_creative_1",
        registryVersion: REGISTRY_VERSION,
      }),
    ).rejects.toThrow(AttributionBindingError)
  })

  it("surfaces an insert failure as AttributionBindingError rather than swallowing it", async () => {
    const client = fakeClient()
    client.$executeRaw = async () => {
      throw new Error('relation "ot_order_attribution" does not exist')
    }
    await expect(
      bindFirstTouchAttribution(client, {
        orderId: "ord_7",
        campaignCode: null,
        creativeCode: null,
        registryVersion: REGISTRY_VERSION,
      }),
    ).rejects.toThrow(AttributionBindingError)
  })

  it("fails rather than inventing a row when the readback comes back empty", async () => {
    const client = fakeClient()
    client.$queryRaw = (async () => []) as AttributionSqlClient["$queryRaw"]
    await expect(
      bindFirstTouchAttribution(client, {
        orderId: "ord_8",
        campaignCode: null,
        creativeCode: null,
        registryVersion: REGISTRY_VERSION,
      }),
    ).rejects.toThrow(/readback returned no row/)
  })
})

describe("attributionMetadata", () => {
  const row = {
    orderId: "ord_1",
    registryVersion: REGISTRY_VERSION,
    boundAt: new Date("2026-09-12T12:00:00.000Z"),
  }

  it("contributes no keys at all when binding is disabled", () => {
    expect(attributionMetadata(null)).toEqual({})
  })

  it("marks an organic row explicitly", () => {
    expect(attributionMetadata({ ...row, campaignCode: null, creativeCode: null })).toEqual({
      attributionStatus: "organic",
    })
  })

  it("carries only the approved codes, and omits an absent creative", () => {
    expect(attributionMetadata({ ...row, campaignCode: "synthetic_campaign_b", creativeCode: null })).toEqual({
      attributionStatus: "campaign",
      attributionCampaign: "synthetic_campaign_b",
    })
    expect(
      attributionMetadata({ ...row, campaignCode: "synthetic_campaign_a", creativeCode: "synthetic_creative_1" }),
    ).toEqual({
      attributionStatus: "campaign",
      attributionCampaign: "synthetic_campaign_a",
      attributionCreative: "synthetic_creative_1",
    })
  })
})
