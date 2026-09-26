/** @jest-environment node */
import { Client } from "pg"
import { buildNeutralPoolConfig } from "@/lib/fulfillment-runtime/neutral-db-tls"

const CERT = "-----BEGIN CERTIFICATE-----\nsynthetic-test-ca\n-----END CERTIFICATE-----\n"

describe("neutral database TLS pool configuration", () => {
  test("requires verify-full and an explicit CA for every remote database", () => {
    expect(() =>
      buildNeutralPoolConfig("postgresql://role@example.invalid/db?sslmode=require", CERT),
    ).toThrow("NEUTRAL_DATABASE_VERIFY_FULL_REQUIRED")

    expect(() =>
      buildNeutralPoolConfig("postgresql://role@example.invalid/db?sslmode=verify-full", ""),
    ).toThrow("NEUTRAL_DATABASE_CA_REQUIRED")
  })

  test("passes a pinned CA to node TLS without letting URL sslmode replace it", () => {
    const config = buildNeutralPoolConfig(
      "postgresql://role:secret@example.invalid:5432/db?sslmode=verify-full",
      CERT,
    )
    const parsed = new URL(config.connectionString!)
    expect(parsed.searchParams.has("sslmode")).toBe(false)
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: CERT.trim() })

    const effective = (new Client(config) as unknown as {
      connectionParameters: { host: string; ssl: unknown }
    }).connectionParameters
    expect(effective.host).toBe("example.invalid")
    expect(effective.ssl).toEqual({ rejectUnauthorized: true, ca: CERT.trim() })
  })

  test.each(["ssl=0", "ssl=no-verify", "ssl=true", "sslrootcert=x", "sslcert=x", "sslkey=x"])(
    "rejects a connection-string TLS override: %s",
    (override) => {
      expect(() =>
        buildNeutralPoolConfig(
          `postgresql://role:secret@example.invalid/db?sslmode=verify-full&${override}`,
          CERT,
        ),
      ).toThrow("NEUTRAL_DATABASE_URL_OPTION_FORBIDDEN")
    },
  )

  test("rejects a query-string host override before applying the loopback exemption", () => {
    expect(() =>
      buildNeutralPoolConfig(
        "postgresql://role:secret@localhost/db?host=example.invalid",
        "",
      ),
    ).toThrow("NEUTRAL_DATABASE_URL_OPTION_FORBIDDEN")
  })

  test("sanitizes malformed URL errors so credentials are not retained", () => {
    const secret = "synthetic-password-that-must-not-escape"
    let failure: unknown
    try {
      buildNeutralPoolConfig(`not a url ${secret}`, CERT)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).toBe("NEUTRAL_DATABASE_URL_INVALID")
    expect(JSON.stringify(failure)).not.toContain(secret)
    expect(Object.values(failure as object).join(" ")).not.toContain(secret)
  })

  test("keeps loopback development connections local and CA-free", () => {
    const config = buildNeutralPoolConfig("postgresql://local:local@127.0.0.1:5432/db", "")
    expect(config).toEqual({
      host: "127.0.0.1",
      port: 5432,
      user: "local",
      password: "local",
      database: "db",
      ssl: false,
    })
  })

  test("rejects query options on loopback before pg can reinterpret TLS", () => {
    expect(() =>
      buildNeutralPoolConfig(
        "postgresql://dev:dev@127.0.0.1:5432/dev?sslmode=no-verify",
        "",
      ),
    ).toThrow("NEUTRAL_DATABASE_URL_OPTION_FORBIDDEN")
  })

  test("normalizes bracketed IPv6 loopback for the effective pg transport", () => {
    const config = buildNeutralPoolConfig("postgresql://dev:dev@[::1]:5432/dev", "")
    const effective = (new Client(config) as unknown as {
      connectionParameters: { host: string; ssl: unknown }
    }).connectionParameters
    expect(config).toMatchObject({ host: "::1", ssl: false })
    expect(effective.host).toBe("::1")
    expect(effective.ssl).toBe(false)
  })

  test("rejects malformed or unbounded CA material", () => {
    for (const ca of ["not a certificate", "-----BEGIN CERTIFICATE-----\nx\n", "x".repeat(131073)]) {
      expect(() =>
        buildNeutralPoolConfig("postgresql://role@example.invalid/db?sslmode=verify-full", ca),
      ).toThrow("NEUTRAL_DATABASE_CA_INVALID")
    }
  })
})
