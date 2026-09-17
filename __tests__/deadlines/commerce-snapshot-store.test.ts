/** @jest-environment node */
import { createHash } from "node:crypto"

import { createCommerceSnapshotStore, type CommerceSnapshotClient } from "@/lib/deadlines/commerce-snapshot-store"
import { INFORMATIONAL_SOURCE_URL } from "@/lib/deadlines/informational-snapshot"
import { TOWNSHIPS } from "@/lib/townships"

jest.mock("server-only", () => ({}))

const NOW = new Date("2026-09-13T16:00:00.000Z")
const BODY = Buffer.from("official-assessor-capture")
const HASH = createHash("sha256").update(BODY).digest("hex")

function snapshot(retrievedAt = "2026-09-13T15:59:00.000Z") {
  return {
    schemaVersion: 1 as const,
    synthetic: false,
    sources: { bor: null, assessor: {
      authority: "cook_county_assessor" as const,
      sourceUrl: INFORMATIONAL_SOURCE_URL,
      finalUrl: INFORMATIONAL_SOURCE_URL,
      httpStatus: 200,
      retrievedAt,
      sourceUpdatedAt: null,
      contentSha256: HASH,
      parseStatus: "ok" as const,
      parserVersion: "ccao-dom/1.0.0",
    } },
    townships: Object.fromEntries(TOWNSHIPS.map(t => [t.slug, {
      townshipName: t.name,
      stages: { assessor: null },
    }])),
  }
}

function row(overrides: Record<string, unknown> = {}) {
  const value = snapshot()
  return {
    id: "capture-1",
    retrieved_at: new Date(value.sources.assessor.retrievedAt),
    content_sha256: HASH,
    source_body: BODY,
    value: JSON.stringify({ snapshot: value, sourceBodyBase64: BODY.toString("base64") }),
    ...overrides,
  }
}

function storeWith(rows: unknown[]) {
  const query = jest.fn().mockResolvedValue(rows)
  const execute = jest.fn().mockResolvedValue(1)
  const client = {
    $queryRaw: query,
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: query, $executeRaw: execute }),
  } as unknown as CommerceSnapshotClient
  return { store: createCommerceSnapshotStore(client), query, execute }
}

const original = process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED
beforeEach(() => { process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED = "true" })
afterAll(() => {
  if (original === undefined) delete process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED
  else process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED = original
})

test("authoritative read requires all relational columns to match the embedded capture", async () => {
  const { store, query } = storeWith([row()])
  expect(await store.read(NOW)).toEqual(snapshot())
  expect(query.mock.calls[0][0].text).toContain('"retrieved_at", "content_sha256", "source_body"')
})

test.each([
  ["contradictory retrieval", { retrieved_at: new Date("2026-09-13T15:58:00.000Z") }],
  ["contradictory hash", { content_sha256: "f".repeat(64) }],
  ["contradictory body", { source_body: Buffer.from("different official bytes") }],
])("%s fails closed", async (_name, override) => {
  const { store } = storeWith([row(override)])
  expect(await store.read(NOW)).toBeNull()
})

test("a relationally consistent future row still fails closed", async () => {
  const future = snapshot("2026-09-14T15:59:00.000Z")
  const { store } = storeWith([row({
    retrieved_at: new Date(future.sources.assessor.retrievedAt),
    value: JSON.stringify({ snapshot: future, sourceBodyBase64: BODY.toString("base64") }),
  })])
  expect(await store.read(NOW)).toBeNull()
})

test("publication uses only the restricted security-definer entry point", async () => {
  const { store, query, execute } = storeWith([])
  expect(await store.publish(snapshot(), BODY, NOW)).toBe("PUBLISHED")
  expect(execute).toHaveBeenCalledTimes(1)
  expect(execute.mock.calls[0][0].text).toContain('"ot_publish_commerce_deadline_capture"')
  expect(execute.mock.calls[0][0].text).not.toContain('INSERT INTO "ot_commerce_deadline_capture"')
  expect(query).toHaveBeenCalled()
})
