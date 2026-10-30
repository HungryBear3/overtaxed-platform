/** @jest-environment node */
import type { PoolConfig } from "pg"
import {
  createNeutralPrismaClient,
  disconnectNeutralPrisma,
  neutralPrisma,
} from "@/lib/fulfillment-runtime/neutral-db"

// The real pg Pool and the real installed PrismaPg are subclassed ONLY to observe
// constructor arguments; their behaviour is the installed implementation. Nothing
// here opens a socket or executes a query (structural API checks are not engine
// proof; real queries/transactions/disconnect are qualified natively).
// `instanceof PrismaClient` is deliberately not asserted: the installed Prisma 7.3
// client fails it even for a directly constructed client (historical offline probe).
type ObservedPool = { totalCount: number; idleCount: number; ended: boolean; end(): Promise<void> }
type ObservedAdapter = { dispose(): Promise<void>; underlyingDriver(): unknown }
type ObservedFactory = { connect(): Promise<ObservedAdapter> }
const mockPools: Array<{ config: PoolConfig; pool: ObservedPool }> = []
const mockAdapters: Array<{ arg: unknown; options: unknown; factory: ObservedFactory }> = []
jest.mock("pg", () => {
  const actual = jest.requireActual<typeof import("pg")>("pg")
  class RecordingPool extends actual.Pool {
    constructor(config?: PoolConfig) {
      super(config)
      mockPools.push({ config: config ?? {}, pool: this as unknown as ObservedPool })
    }
  }
  return { ...actual, Pool: RecordingPool }
})
jest.mock("@prisma/adapter-pg", () => {
  const actual = jest.requireActual<typeof import("@prisma/adapter-pg")>("@prisma/adapter-pg")
  class RecordingPrismaPg extends actual.PrismaPg {
    constructor(...args: ConstructorParameters<typeof actual.PrismaPg>) {
      super(...args)
      mockAdapters.push({ arg: args[0], options: args[1], factory: this as unknown as ObservedFactory })
    }
  }
  return { ...actual, PrismaPg: RecordingPrismaPg }
})
const { Pool: ActualPool } = jest.requireActual<typeof import("pg")>("pg")

const CERT = "-----BEGIN CERTIFICATE-----\nsynthetic-test-ca\n-----END CERTIFICATE-----\n"
const REMOTE = "postgresql://role:secret@example.invalid:5432/db?sslmode=verify-full"
const LOOPBACK = "postgresql://local:local@localhost:5432/db"
const ENV_KEYS = ["OT_NEUTRAL_DATABASE_URL", "OT_NEUTRAL_DATABASE_CA_PEM"] as const
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}

beforeAll(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
})
beforeEach(() => {
  mockPools.length = 0
  mockAdapters.length = 0
  for (const key of ENV_KEYS) delete process.env[key]
})
afterEach(async () => {
  await disconnectNeutralPrisma()
})
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const REMOTE_CONFIG = {
  connectionString: "postgresql://role:secret@example.invalid:5432/db",
  ssl: { rejectUnauthorized: true, ca: CERT.trim() },
  max: 2,
  connectionTimeoutMillis: 5000,
}
const LOOPBACK_CONFIG = {
  host: "localhost",
  port: 5432,
  user: "local",
  password: "local",
  database: "db",
  ssl: false,
  max: 2,
  connectionTimeoutMillis: 5000,
}

describe("trusted neutral Prisma client factory", () => {
  test("hands the real adapter the strictly validated bounded config, so the adapter owns a lazy pool", () => {
    const client = createNeutralPrismaClient({ url: REMOTE, caPem: CERT })
    // Package API shape only; not engine or query proof.
    for (const method of ["$queryRaw", "$transaction", "$disconnect"]) {
      expect(typeof (client as unknown as Record<string, unknown>)[method]).toBe("function")
    }
    expect(mockAdapters).toHaveLength(1)
    expect(mockAdapters[0].arg).not.toBeInstanceOf(ActualPool)
    expect(mockAdapters[0].arg).toEqual(REMOTE_CONFIG)
    expect(mockAdapters[0].options).toBeUndefined()
    // No pool exists until the adapter connects.
    expect(mockPools).toHaveLength(0)
  })

  test("the real adapter ends the pool it created on dispose and builds a fresh one on reconnect", async () => {
    // Adapter boundary only (installed PrismaPg connect/dispose, no socket, no query).
    // Prisma $disconnect closing real sessions is qualified natively.
    createNeutralPrismaClient({ url: LOOPBACK })
    const factory = mockAdapters[0].factory
    const first = await factory.connect()
    const firstPool = mockPools[mockPools.length - 1]
    expect(first.underlyingDriver()).toBe(firstPool.pool)
    expect(firstPool.pool.totalCount).toBe(0)
    await first.dispose()
    expect(firstPool.pool.ended).toBe(true)

    const second = await factory.connect()
    const secondPool = mockPools[mockPools.length - 1]
    expect(secondPool.pool).not.toBe(firstPool.pool)
    expect(second.underlyingDriver()).toBe(secondPool.pool)
    expect(secondPool.pool.ended).toBe(false)
    // Reconnect keeps the full validated config, including the credential.
    expect(secondPool.config).toEqual(LOOPBACK_CONFIG)
    await second.dispose()
    expect(secondPool.pool.ended).toBe(true)
  })

  test("returns an independent client per call and never populates the default cache", () => {
    const a = createNeutralPrismaClient({ url: REMOTE, caPem: CERT })
    const b = createNeutralPrismaClient({ url: REMOTE, caPem: CERT })
    expect(a).not.toBe(b)
    expect(() => neutralPrisma()).toThrow("NEUTRAL_DATABASE_DISABLED")

    process.env.OT_NEUTRAL_DATABASE_URL = REMOTE
    process.env.OT_NEUTRAL_DATABASE_CA_PEM = CERT
    const cached = neutralPrisma()
    expect(cached).not.toBe(a)
    expect(cached).not.toBe(b)
    expect(neutralPrisma()).toBe(cached)
    expect(mockAdapters).toHaveLength(3)
    // Only the inherited default pre-builds a pool.
    expect(mockPools).toHaveLength(1)
  })

  test("passes only the explicit trust option to the helper and fails closed before any pool exists", () => {
    expect(() =>
      createNeutralPrismaClient({ url: LOOPBACK, trust: { loopbackTls: "verify-full" } }),
    ).toThrow("NEUTRAL_DATABASE_CA_REQUIRED")
    // PEM-shaped but not a parseable CA certificate.
    expect(() =>
      createNeutralPrismaClient({ url: LOOPBACK, caPem: CERT, trust: { loopbackTls: "verify-full" } }),
    ).toThrow("NEUTRAL_DATABASE_CA_INVALID")
    for (const bad of [true, "require", "VERIFY-FULL"]) {
      expect(() =>
        createNeutralPrismaClient({
          url: LOOPBACK,
          caPem: CERT,
          trust: { loopbackTls: bad as unknown as "verify-full" },
        }),
      ).toThrow("NEUTRAL_DATABASE_TLS_OPTION_INVALID")
    }
    expect(() =>
      createNeutralPrismaClient({ url: "postgresql://u:p@localhost/db?host=/tmp", trust: { loopbackTls: "verify-full" } }),
    ).toThrow("NEUTRAL_DATABASE_URL_OPTION_FORBIDDEN")
    expect(() =>
      createNeutralPrismaClient({ url: "postgresql://role@example.invalid/db?sslmode=require", caPem: CERT }),
    ).toThrow("NEUTRAL_DATABASE_VERIFY_FULL_REQUIRED")
    expect(mockPools).toHaveLength(0)
    expect(mockAdapters).toHaveLength(0)
  })

  test("without a trust option a loopback factory client stays plaintext, exactly like the helper", () => {
    createNeutralPrismaClient({ url: LOOPBACK, caPem: CERT })
    expect(mockAdapters).toHaveLength(1)
    expect(mockAdapters[0].arg).toEqual(LOOPBACK_CONFIG)
    expect(mockPools).toHaveLength(0)
  })

  test("the no-argument default is unchanged: env only, no trust option, loopback CA alone keeps plaintext", () => {
    expect(() => neutralPrisma()).toThrow("NEUTRAL_DATABASE_DISABLED")
    expect(mockPools).toHaveLength(0)
    process.env.OT_NEUTRAL_DATABASE_URL = "postgresql://local:local@127.0.0.1:5432/db"
    process.env.OT_NEUTRAL_DATABASE_CA_PEM = CERT
    neutralPrisma()
    expect(mockPools).toHaveLength(1)
    expect(mockPools[0].config.ssl).toBe(false)
    expect(mockPools[0].config.max).toBe(2)
    expect(mockPools[0].config.connectionTimeoutMillis).toBe(5000)
    expect(mockAdapters).toHaveLength(1)
    expect(mockAdapters[0].arg).toBe(mockPools[0].pool)
    expect(mockAdapters[0].arg).toBeInstanceOf(ActualPool)
    expect(mockAdapters[0].options).toBeUndefined()
  })

  test("inherited default lifecycle is unchanged and disclosed: adapter disposal does not end its external pool", async () => {
    process.env.OT_NEUTRAL_DATABASE_URL = "postgresql://local:local@127.0.0.1:5432/db"
    neutralPrisma()
    const external = mockPools[0].pool
    const adapter = await mockAdapters[0].factory.connect()
    expect(adapter.underlyingDriver()).toBe(external)
    await adapter.dispose()
    // Same as HEAD: the externally owned pool is left to pg-pool idle eviction.
    expect(external.ended).toBe(false)
    await external.end()
  })
})
