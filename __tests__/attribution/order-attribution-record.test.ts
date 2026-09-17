/** @jest-environment node */

/**
 * The durable binding itself, against an in-memory stand-in for
 * `ot_order_attribution`. No database is touched.
 *
 * The stand-in deliberately implements only the semantics the real table
 * provides and this module depends on: `ON CONFLICT (order_id) DO NOTHING`, and
 * a primary key that makes the readback single-row. It does NOT enforce the
 * CHECK constraints — that is the point of the "untrusted stored data" block
 * below, which exists precisely because this code must not assume they ran.
 */

import {
  type AttributionSqlClient,
  type AttributionState,
  AttributionBindingError,
  attributionMetadata,
  bindFirstTouchAttribution,
  readOrderAttribution,
} from "@/lib/attribution/record"

type StoredRow = {
  orderId: string
  state: string
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
      const [orderId, state, campaignCode, creativeCode, registryVersion] = values as [
        string,
        string,
        string | null,
        string | null,
        string,
      ]
      // ON CONFLICT (order_id) DO NOTHING — first touch wins.
      if (table.has(orderId)) return 0
      table.set(orderId, {
        orderId,
        state,
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

const campaign = (campaignCode: string, creativeCode: string | null = null) => ({
  state: "campaign" as AttributionState,
  campaignCode,
  creativeCode,
  registryVersion: REGISTRY_VERSION,
})
const organic = { state: "organic" as AttributionState, campaignCode: null, creativeCode: null, registryVersion: REGISTRY_VERSION }
const legacy = {
  state: "legacy_unattributed" as AttributionState,
  campaignCode: null,
  creativeCode: null,
  registryVersion: REGISTRY_VERSION,
}

describe("first-touch attribution binding", () => {
  it("binds an approved pair and reads it back exactly", async () => {
    const client = fakeClient()
    const row = await bindFirstTouchAttribution(client, {
      orderId: "ord_1",
      ...campaign("synthetic_campaign_a", "synthetic_creative_1"),
    })

    expect(row).toMatchObject({
      orderId: "ord_1",
      state: "campaign",
      campaignCode: "synthetic_campaign_a",
      creativeCode: "synthetic_creative_1",
      registryVersion: REGISTRY_VERSION,
    })
    expect(await readOrderAttribution(client, "ord_1")).toMatchObject({ campaignCode: "synthetic_campaign_a" })
  })

  it("passes every value as a bound parameter rather than interpolating it into SQL", async () => {
    const client = fakeClient()
    await bindFirstTouchAttribution(client, { orderId: "ord_param", ...campaign("synthetic_campaign_a") })

    const insert = client.__executed.find((entry) => entry.sql.includes("INSERT INTO"))!
    expect(insert.values).toEqual(["ord_param", "campaign", "synthetic_campaign_a", null, REGISTRY_VERSION])
    // The literal must not appear in the statement text at all.
    expect(insert.sql).not.toContain("ord_param")
    expect(insert.sql).not.toContain("synthetic_campaign_a")
  })

  it("returns the ORIGINAL row when a retry offers different codes, and never writes the new ones", async () => {
    const client = fakeClient()
    await bindFirstTouchAttribution(client, {
      orderId: "ord_2",
      ...campaign("synthetic_campaign_a", "synthetic_creative_1"),
    })

    const retry = await bindFirstTouchAttribution(client, { orderId: "ord_2", ...campaign("synthetic_campaign_b") })

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
    const bound = await bindFirstTouchAttribution(client, { orderId: "ord_3", ...organic })
    expect(bound.state).toBe("organic")

    const retry = await bindFirstTouchAttribution(client, {
      orderId: "ord_3",
      ...campaign("synthetic_campaign_a", "synthetic_creative_1"),
    })

    expect(retry.state).toBe("organic")
    expect(retry.campaignCode).toBeNull()
    expect(retry.creativeCode).toBeNull()
    expect(client.__table.get("ord_3")?.campaignCode).toBeNull()
  })

  it("issues no UPDATE against the table under any path", async () => {
    const client = fakeClient()
    await bindFirstTouchAttribution(client, { orderId: "ord_4", ...organic })
    await bindFirstTouchAttribution(client, { orderId: "ord_4", ...campaign("synthetic_campaign_a") })
    expect(client.__executed.some((entry) => /\bUPDATE\b/i.test(entry.sql))).toBe(false)
  })

  it("refuses to bind a value the registry could never have approved", async () => {
    const client = fakeClient()
    await expect(
      bindFirstTouchAttribution(client, { orderId: "ord_5", ...campaign("buyer@example.com") }),
    ).rejects.toMatchObject({ reason: "invalid_binding_input" })
    expect(client.__table.size).toBe(0)
  })

  it("refuses a creative without its campaign, mirroring the SQL CHECK", async () => {
    const client = fakeClient()
    await expect(
      bindFirstTouchAttribution(client, {
        orderId: "ord_6",
        state: "organic",
        campaignCode: null,
        creativeCode: "synthetic_creative_1",
        registryVersion: REGISTRY_VERSION,
      }),
    ).rejects.toMatchObject({ reason: "invalid_binding_input" })
  })

  it("surfaces an insert failure as AttributionBindingError rather than swallowing it", async () => {
    const client = fakeClient()
    client.$executeRaw = async () => {
      throw new Error('relation "ot_order_attribution" does not exist')
    }
    await expect(bindFirstTouchAttribution(client, { orderId: "ord_7", ...organic })).rejects.toMatchObject({
      reason: "insert_failed",
    })
  })

  it("fails rather than inventing a row when the readback comes back empty", async () => {
    const client = fakeClient()
    client.$queryRaw = (async () => []) as AttributionSqlClient["$queryRaw"]
    await expect(bindFirstTouchAttribution(client, { orderId: "ord_8", ...organic })).rejects.toMatchObject({
      reason: "readback_missing_after_insert",
    })
  })
})

describe("state is stored, never inferred from the null columns", () => {
  it("binds legacy_unattributed as its own state, distinguishable from organic", async () => {
    const client = fakeClient()
    const legacyRow = await bindFirstTouchAttribution(client, { orderId: "ord_legacy", ...legacy })
    const organicRow = await bindFirstTouchAttribution(client, { orderId: "ord_organic", ...organic })

    // Byte-identical in every column except the one that carries the claim.
    expect(legacyRow.campaignCode).toBeNull()
    expect(organicRow.campaignCode).toBeNull()
    expect(legacyRow.state).toBe("legacy_unattributed")
    expect(organicRow.state).toBe("organic")
  })

  it("never promotes a legacy_unattributed marker to a campaign on a later bind", async () => {
    const client = fakeClient()
    await bindFirstTouchAttribution(client, { orderId: "ord_legacy", ...legacy })

    const later = await bindFirstTouchAttribution(client, {
      orderId: "ord_legacy",
      ...campaign("synthetic_campaign_a", "synthetic_creative_1"),
    })

    expect(later.state).toBe("legacy_unattributed")
    expect(later.campaignCode).toBeNull()
    expect(client.__table.get("ord_legacy")?.state).toBe("legacy_unattributed")
  })

  it("does not downgrade an existing campaign when a legacy bind is attempted over it", async () => {
    const client = fakeClient()
    await bindFirstTouchAttribution(client, {
      orderId: "ord_tagged",
      ...campaign("synthetic_campaign_a", "synthetic_creative_1"),
    })

    const attempted = await bindFirstTouchAttribution(client, { orderId: "ord_tagged", ...legacy })

    expect(attempted).toMatchObject({
      state: "campaign",
      campaignCode: "synthetic_campaign_a",
      creativeCode: "synthetic_creative_1",
    })
  })

  it("refuses an incoherent state/code combination before it reaches the table", async () => {
    const client = fakeClient()
    for (const params of [
      { state: "organic" as AttributionState, campaignCode: "synthetic_campaign_a", creativeCode: null },
      { state: "legacy_unattributed" as AttributionState, campaignCode: "synthetic_campaign_a", creativeCode: null },
      { state: "campaign" as AttributionState, campaignCode: null, creativeCode: null },
      { state: "invented_state" as AttributionState, campaignCode: null, creativeCode: null },
    ]) {
      await expect(
        bindFirstTouchAttribution(client, { orderId: "ord_incoherent", registryVersion: REGISTRY_VERSION, ...params }),
      ).rejects.toMatchObject({ reason: "invalid_binding_input" })
    }
    expect(client.__table.size).toBe(0)
  })
})

/**
 * The table has CHECK constraints, but this code must not depend on them having
 * run: the migration is not executed by this branch, a restore or a manual edit
 * can bypass them, and a campaign code is copied verbatim into Stripe metadata.
 */
describe("stored data is revalidated on readback", () => {
  async function readStored(row: Record<string, unknown>) {
    const client = fakeClient()
    client.$queryRaw = (async () => [row]) as AttributionSqlClient["$queryRaw"]
    return readOrderAttribution(client, "ord_bad")
  }

  const valid = {
    orderId: "ord_bad",
    state: "campaign",
    campaignCode: "synthetic_campaign_a",
    creativeCode: null,
    registryVersion: REGISTRY_VERSION,
    boundAt: new Date("2026-09-12T12:00:00.000Z"),
  }

  it("reads a well-formed stored row", async () => {
    await expect(readStored(valid)).resolves.toMatchObject({ state: "campaign" })
  })

  it.each([
    ["a code carrying an email", { campaignCode: "buyer@example.com" }],
    ["a code carrying a URL", { campaignCode: "https://www.overtaxed-il.com/check" }],
    ["a code carrying a quote", { campaignCode: "a'; DROP TABLE ot_order; --" }],
    ["an over-long code", { campaignCode: "a".repeat(41) }],
    ["a creative carrying free text", { creativeCode: "Elk Grove Village, IL" }],
    ["a creative without its campaign", { state: "organic", campaignCode: null, creativeCode: "synthetic_creative_1" }],
    ["a campaign state with no code", { state: "campaign", campaignCode: null }],
    ["an organic state carrying a code", { state: "organic" }],
    ["a legacy state carrying a code", { state: "legacy_unattributed" }],
    ["an unknown state", { state: "paid_social" }],
    ["a state that is not a string", { state: 7 }],
    ["a registry version carrying free text", { registryVersion: "registry <script>alert(1)</script>" }],
    ["an unparseable bound_at", { boundAt: "not-a-timestamp" }],
    ["a missing order id", { orderId: "" }],
  ])("rejects %s instead of forwarding it", async (_label, override) => {
    await expect(readStored({ ...valid, ...override })).rejects.toMatchObject({ reason: "readback_shape_invalid" })
  })

  it("rejects a readback that is not a single-row list", async () => {
    const client = fakeClient()
    client.$queryRaw = (async () => [valid, valid]) as AttributionSqlClient["$queryRaw"]
    await expect(readOrderAttribution(client, "ord_bad")).rejects.toMatchObject({ reason: "readback_multiple_rows" })

    const notAList = fakeClient()
    notAList.$queryRaw = (async () => ({ rows: [] })) as unknown as AttributionSqlClient["$queryRaw"]
    await expect(readOrderAttribution(notAList, "ord_bad")).rejects.toMatchObject({ reason: "readback_not_a_list" })
  })
})

/**
 * A driver error carries statement text, bound parameters and vendor detail.
 * The bound parameters on this path include the submitted acquisition codes, so
 * the failure that escapes this module must carry a classification and nothing
 * else.
 */
describe("failures carry a fixed classification and no raw driver detail", () => {
  it("drops the originating error rather than attaching it as `cause`", async () => {
    const client = fakeClient()
    const secret = 'INSERT ... VALUES ($1) -- "buyer@example.com"'
    client.$executeRaw = async () => {
      throw new Error(secret)
    }

    const error = await bindFirstTouchAttribution(client, { orderId: "ord_9", ...organic }).catch((e) => e)

    expect(error).toBeInstanceOf(AttributionBindingError)
    expect((error as { cause?: unknown }).cause).toBeUndefined()
    // Nothing serializable off the error may echo the driver's text.
    const serialized = `${error.message}|${error.stack ?? ""}|${JSON.stringify(Object.entries(error))}`
    expect(serialized).not.toContain("buyer@example.com")
    expect(error.reason).toBe("insert_failed")
  })

  it("classifies a readback driver failure separately from an insert failure", async () => {
    const client = fakeClient()
    client.$queryRaw = (async () => {
      throw new Error('column "campaign_code" does not exist')
    }) as AttributionSqlClient["$queryRaw"]
    await expect(readOrderAttribution(client, "ord_10")).rejects.toMatchObject({ reason: "readback_failed" })
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
    expect(attributionMetadata({ ...row, state: "organic", campaignCode: null, creativeCode: null })).toEqual({
      attributionStatus: "organic",
    })
  })

  /**
   * The legacy marker is stamped as itself. Dressing it up as organic would
   * claim an untagged first touch that was never measured, and inventing a
   * source would be worse.
   */
  it("marks a legacy row as legacy, not as organic and not as a source", () => {
    expect(
      attributionMetadata({ ...row, state: "legacy_unattributed", campaignCode: null, creativeCode: null }),
    ).toEqual({ attributionStatus: "legacy_unattributed" })
  })

  it("carries only the approved codes, and omits an absent creative", () => {
    expect(
      attributionMetadata({ ...row, state: "campaign", campaignCode: "synthetic_campaign_b", creativeCode: null }),
    ).toEqual({
      attributionStatus: "campaign",
      attributionCampaign: "synthetic_campaign_b",
    })
    expect(
      attributionMetadata({
        ...row,
        state: "campaign",
        campaignCode: "synthetic_campaign_a",
        creativeCode: "synthetic_creative_1",
      }),
    ).toEqual({
      attributionStatus: "campaign",
      attributionCampaign: "synthetic_campaign_a",
      attributionCreative: "synthetic_creative_1",
    })
  })

  it("never stamps the registry version into provider metadata", () => {
    const metadata = attributionMetadata({
      ...row,
      state: "campaign",
      campaignCode: "synthetic_campaign_a",
      creativeCode: null,
    })
    expect(JSON.stringify(metadata)).not.toContain(REGISTRY_VERSION)
  })
})
