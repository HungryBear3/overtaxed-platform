/** @jest-environment node */
import { checkServerIdentity, rootCertificates, type ConnectionOptions, type PeerCertificate } from "node:tls"
import { Client } from "pg"
import { buildNeutralPoolConfig } from "@/lib/fulfillment-runtime/neutral-db-tls"

const CERT = "-----BEGIN CERTIFICATE-----\nsynthetic-test-ca\n-----END CERTIFICATE-----\n"

// Identity tests below exercise the configured standard Node validator against
// synthetic peer certificate METADATA only. They are not TLS handshakes; the owned
// native wrong-SAN refusal remains the handshake evidence.
// A real parseable CA (Node's bundled public root) satisfies the loopback opt-in's
// X509 CA check; it is never used to connect.
const REAL_CA = rootCertificates[0]
const peer = (subjectaltname: string, CN = "synthetic-peer") =>
  ({ subject: { CN }, subjectaltname }) as unknown as PeerCertificate
const strictLoopbackSsl = (url: string) =>
  buildNeutralPoolConfig(url, REAL_CA, { loopbackTls: "verify-full" }).ssl as ConnectionOptions
const verdict = (ssl: ConnectionOptions, offered: string, cert: PeerCertificate) => {
  expect(typeof ssl.checkServerIdentity).toBe("function")
  const error = ssl.checkServerIdentity!(offered, cert)
  return error === undefined ? "ACCEPT" : (error as NodeJS.ErrnoException).code
}

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

  test("loopback strict TLS opt-in accepts only the exact verify-full string", () => {
    for (const bad of [true, "require", "VERIFY-FULL", ""]) {
      expect(() =>
        buildNeutralPoolConfig("postgresql://dev:dev@localhost:5432/dev", CERT, {
          loopbackTls: bad as unknown as "verify-full",
        }),
      ).toThrow("NEUTRAL_DATABASE_TLS_OPTION_INVALID")
    }
  })

  test("loopback strict TLS opt-in requires a parseable CA certificate", () => {
    const url = "postgresql://dev:dev@localhost:5432/dev"
    expect(() => buildNeutralPoolConfig(url, "", { loopbackTls: "verify-full" })).toThrow(
      "NEUTRAL_DATABASE_CA_REQUIRED",
    )
    expect(() => buildNeutralPoolConfig(url, CERT, { loopbackTls: "verify-full" })).toThrow(
      "NEUTRAL_DATABASE_CA_INVALID",
    )
  })

  test("loopback strict TLS opt-in still rejects every URL query option", () => {
    for (const query of ["sslmode=verify-full", "host=/tmp", "sslrootcert=x"]) {
      expect(() =>
        buildNeutralPoolConfig(`postgresql://dev:dev@localhost:5432/dev?${query}`, CERT, {
          loopbackTls: "verify-full",
        }),
      ).toThrow("NEUTRAL_DATABASE_URL_OPTION_FORBIDDEN")
    }
  })

  test("a CA alone never enables loopback TLS without the explicit opt-in", () => {
    expect(buildNeutralPoolConfig("postgresql://dev:dev@localhost:5432/dev", CERT).ssl).toBe(false)
  })

  test("strict loopback keeps chain verification and the pinned CA, and binds an exact-host identity check", () => {
    for (const url of [
      "postgresql://dev:dev@localhost:5432/dev",
      "postgresql://dev:dev@127.0.0.1:5432/dev",
      "postgresql://dev:dev@[::1]:5432/dev",
    ]) {
      const ssl = strictLoopbackSsl(url)
      expect(ssl.rejectUnauthorized).toBe(true)
      expect(ssl.ca).toBe(REAL_CA.trim())
      expect(typeof ssl.checkServerIdentity).toBe("function")
    }
    // pg carries the same validator through to its effective connection parameters.
    const config = buildNeutralPoolConfig("postgresql://dev:dev@127.0.0.1:5432/dev", REAL_CA, { loopbackTls: "verify-full" })
    const effective = (new Client(config) as unknown as {
      connectionParameters: { ssl: ConnectionOptions }
    }).connectionParameters
    expect(effective.ssl.rejectUnauthorized).toBe(true)
    expect(effective.ssl.checkServerIdentity).toBe((config.ssl as ConnectionOptions).checkServerIdentity)
  })

  test("literal 127.0.0.1 refuses a DNS:localhost-only certificate even when Node offers its localhost fallback", () => {
    const ssl = strictLoopbackSsl("postgresql://dev:dev@127.0.0.1:5432/dev")
    // Native N2 shape: pg sends no servername for an IP; Node's fallback identity is 'localhost'.
    expect(verdict(ssl, "localhost", peer("DNS:localhost", "localhost"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
    expect(verdict(ssl, "127.0.0.1", peer("DNS:localhost", "localhost"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
    expect(verdict(ssl, "localhost", peer("IP Address:127.0.0.2"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
    expect(verdict(ssl, "localhost", peer("IP Address:127.0.0.1"))).toBe("ACCEPT")
  })

  test("literal localhost accepts only its DNS SAN, not an IP SAN or another name", () => {
    const ssl = strictLoopbackSsl("postgresql://dev:dev@localhost:5432/dev")
    expect(verdict(ssl, "localhost", peer("DNS:localhost", "localhost"))).toBe("ACCEPT")
    expect(verdict(ssl, "localhost", peer("IP Address:127.0.0.1"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
    expect(verdict(ssl, "localhost", peer("DNS:other.invalid"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
  })

  test("bracketed IPv6 loopback is validated as the normalized ::1 address", () => {
    const ssl = strictLoopbackSsl("postgresql://dev:dev@[::1]:5432/dev")
    expect(verdict(ssl, "localhost", peer("IP Address:0:0:0:0:0:0:0:1"))).toBe("ACCEPT")
    expect(verdict(ssl, "localhost", peer("IP Address:127.0.0.1"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
    expect(verdict(ssl, "localhost", peer("DNS:localhost", "localhost"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
  })

  test("remote literal IPv4 keeps verify-full chain/CA and binds the exact-IP identity check", () => {
    const config = buildNeutralPoolConfig("postgresql://role:secret@192.0.2.10:5432/db?sslmode=verify-full", CERT)
    const ssl = config.ssl as ConnectionOptions
    expect(new URL(config.connectionString!).searchParams.has("sslmode")).toBe(false)
    expect(ssl.rejectUnauthorized).toBe(true)
    expect(ssl.ca).toBe(CERT.trim())
    expect(verdict(ssl, "localhost", peer("IP Address:192.0.2.10"))).toBe("ACCEPT")
    expect(verdict(ssl, "localhost", peer("IP Address:192.0.2.11"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
    expect(verdict(ssl, "localhost", peer("DNS:localhost", "localhost"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
  })

  test("remote literal IPv6 is validated as the normalized address, brackets removed", () => {
    const ssl = buildNeutralPoolConfig("postgresql://role:secret@[2001:db8::10]:5432/db?sslmode=verify-full", CERT)
      .ssl as ConnectionOptions
    expect(ssl.rejectUnauthorized).toBe(true)
    expect(ssl.ca).toBe(CERT.trim())
    expect(verdict(ssl, "localhost", peer("IP Address:2001:DB8:0:0:0:0:0:10"))).toBe("ACCEPT")
    expect(verdict(ssl, "localhost", peer("IP Address:2001:DB8:0:0:0:0:0:11"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
    expect(verdict(ssl, "localhost", peer("DNS:localhost", "localhost"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
  })

  test("remote DNS keeps the unchanged TLS object; pg's servername and Node's standard DNS rules apply", () => {
    const config = buildNeutralPoolConfig("postgresql://role:secret@db.example.invalid:5432/db?sslmode=verify-full", CERT)
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: CERT.trim() })
    expect((config.ssl as ConnectionOptions).checkServerIdentity).toBeUndefined()
    // The standard Node validation pg's DNS servername feeds (unchanged by this helper).
    const code = (host: string, cert: PeerCertificate) =>
      (checkServerIdentity(host, cert) as NodeJS.ErrnoException | undefined)?.code ?? "ACCEPT"
    expect(code("db.example.invalid", peer("DNS:db.example.invalid"))).toBe("ACCEPT")
    expect(code("db.example.invalid", peer("DNS:*.example.invalid"))).toBe("ACCEPT")
    expect(code("db.example.invalid", peer("DNS:other.example.invalid"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
    expect(code("example.invalid", peer("DNS:*.invalid"))).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
  })

  test("plaintext loopback default carries no TLS object or identity callback, even with a real CA", () => {
    for (const url of ["postgresql://dev:dev@localhost:5432/dev", "postgresql://dev:dev@[::1]:5432/dev"]) {
      expect(buildNeutralPoolConfig(url, REAL_CA).ssl).toBe(false)
    }
  })

  test("rejects malformed or unbounded CA material", () => {
    for (const ca of ["not a certificate", "-----BEGIN CERTIFICATE-----\nx\n", "x".repeat(131073)]) {
      expect(() =>
        buildNeutralPoolConfig("postgresql://role@example.invalid/db?sslmode=verify-full", ca),
      ).toThrow("NEUTRAL_DATABASE_CA_INVALID")
    }
  })
})
