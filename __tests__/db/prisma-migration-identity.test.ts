import fs from "node:fs";
import path from "node:path";
import {
  PLACEHOLDER_DATABASE_URL,
  assertOperatorMigrationDatasource,
  isLoopbackDatasourceUrl,
  isPgBouncerDatasourceUrl,
  isSupabasePoolerUrl,
  resolveApplicationDatasourceUrl,
  resolveMigrationDatasource,
} from "@/lib/db/prisma-migration-identity";

const POOLER_TRANSACTION =
  "postgresql://postgres.kdvjiijzgflumgkndxsl:pw@aws-1-us-east-2.pooler.supabase.com:6543/postgres?sslmode=verify-full";
const POOLER_SESSION =
  "postgresql://ot_prod_app.kdvjiijzgflumgkndxsl:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full";
const OWNER_DIRECT =
  "postgresql://postgres.kdvjiijzgflumgkndxsl:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full";
const PLAIN = "postgresql://postgres:pw@127.0.0.1:5432/postgres";

describe("Prisma migration datasource identity", () => {
  test("DIRECT_URL is the migration connection even when DATABASE_URL is a Supabase pooler", () => {
    const resolved = resolveMigrationDatasource({
      DATABASE_URL: POOLER_TRANSACTION,
      DIRECT_URL: OWNER_DIRECT,
    });
    expect(resolved).toEqual({
      url: OWNER_DIRECT,
      directUrl: OWNER_DIRECT,
      source: "DIRECT_URL",
    });
  });

  test("DIRECT_URL wins over a session-mode pooler application URL", () => {
    const resolved = resolveMigrationDatasource({
      DATABASE_URL: POOLER_SESSION,
      DIRECT_URL: OWNER_DIRECT,
    });
    expect(resolved.url).toBe(OWNER_DIRECT);
    expect(resolved.url).not.toBe(POOLER_SESSION);
  });

  test("DIRECT_URL is never rewritten, so its declared role and port survive", () => {
    const resolved = resolveMigrationDatasource({
      DATABASE_URL: POOLER_TRANSACTION,
      DIRECT_URL: OWNER_DIRECT,
    });
    expect(new URL(resolved.url).username).toBe(
      "postgres.kdvjiijzgflumgkndxsl",
    );
    expect(resolved.url).not.toContain("pgbouncer=true");
  });

  test("a blank DIRECT_URL is treated as absent rather than as a connection", () => {
    const resolved = resolveMigrationDatasource({
      DATABASE_URL: PLAIN,
      DIRECT_URL: "   ",
    });
    expect(resolved).toEqual({
      url: PLAIN,
      directUrl: PLAIN,
      source: "DATABASE_URL",
    });
  });

  test("without DIRECT_URL a pooler application URL still degrades to session mode", () => {
    const resolved = resolveMigrationDatasource({
      DATABASE_URL: POOLER_TRANSACTION,
    });
    expect(resolved.source).toBe("DATABASE_URL_SESSION_POOLER");
    expect(resolved.url).toContain(":5432/");
    expect(resolved.url).toContain("pgbouncer=true");
  });

  test("an absent DATABASE_URL resolves to the generate-only placeholder", () => {
    const resolved = resolveMigrationDatasource({});
    expect(resolved).toEqual({
      url: PLACEHOLDER_DATABASE_URL,
      directUrl: PLACEHOLDER_DATABASE_URL,
      source: "PLACEHOLDER",
    });
  });

  test("the application URL keeps pgbouncer=true on transaction-mode poolers", () => {
    expect(resolveApplicationDatasourceUrl({ DATABASE_URL: POOLER_TRANSACTION })).toBe(
      `${POOLER_TRANSACTION}&pgbouncer=true`,
    );
    expect(resolveApplicationDatasourceUrl({ DATABASE_URL: PLAIN })).toBe(PLAIN);
  });

  /**
   * `lib/db/prisma.ts` used to re-derive this rule itself. These are the cases
   * where the shared resolver and the hand-rolled version differ, pinned so the
   * integration is a behaviour claim rather than a refactor nobody measured.
   */
  test("a session-mode pooler URL is rewritten too, and an existing option is not duplicated", () => {
    expect(resolveApplicationDatasourceUrl({ DATABASE_URL: POOLER_SESSION })).toBe(
      `${POOLER_SESSION}&pgbouncer=true`,
    );
    expect(
      resolveApplicationDatasourceUrl({
        DATABASE_URL: `${POOLER_TRANSACTION}&pgbouncer=true`,
      }),
    ).toBe(`${POOLER_TRANSACTION}&pgbouncer=true`);
  });

  test("a URL that merely mentions the pooler host is left alone", () => {
    const decoy =
      "postgresql://u:p@evil.example.invalid:5432/db?note=pooler.supabase.com";
    expect(resolveApplicationDatasourceUrl({ DATABASE_URL: decoy })).toBe(decoy);
  });

  test("an absent or blank DATABASE_URL yields the placeholder, never undefined", () => {
    expect(resolveApplicationDatasourceUrl({})).toBe(PLACEHOLDER_DATABASE_URL);
    expect(resolveApplicationDatasourceUrl({ DATABASE_URL: "   " })).toBe(
      PLACEHOLDER_DATABASE_URL,
    );
  });

  test("pooler detection is host-based, not substring-based on the whole URL", () => {
    expect(isSupabasePoolerUrl(POOLER_TRANSACTION)).toBe(true);
    expect(isSupabasePoolerUrl(PLAIN)).toBe(false);
    expect(
      isSupabasePoolerUrl(
        "postgresql://u:p@evil.example.invalid:5432/db?note=pooler.supabase.com",
      ),
    ).toBe(false);
  });

  /**
   * The two other facts `lib/db/prisma.ts` used to re-derive with
   * `connectionString.includes(...)`. Both feed a TLS decision — whether the CA
   * pin is used, and whether `NODE_TLS_REJECT_UNAUTHORIZED=0` is set
   * process-wide — so a decoy in a password, a database name or an option value
   * was a way to talk the client out of verifying a certificate.
   */
  test("pgbouncer detection reads a parsed parameter, not a substring", () => {
    expect(isPgBouncerDatasourceUrl(`${POOLER_TRANSACTION}&pgbouncer=true`)).toBe(
      true,
    );
    expect(isPgBouncerDatasourceUrl(POOLER_TRANSACTION)).toBe(false);
    expect(
      isPgBouncerDatasourceUrl(
        "postgresql://u:p@evil.example.invalid:5432/db?note=pgbouncer%3Dtrue",
      ),
    ).toBe(false);
    expect(
      isPgBouncerDatasourceUrl(
        "postgresql://u:pgbouncer=true@evil.example.invalid:5432/db",
      ),
    ).toBe(false);
    // And a value that is not `true` is not a yes.
    expect(
      isPgBouncerDatasourceUrl(`${POOLER_TRANSACTION}&pgbouncer=false`),
    ).toBe(false);
  });

  test("loopback detection is host-based, not substring-based", () => {
    expect(
      isLoopbackDatasourceUrl("postgresql://u:p@localhost:5432/db"),
    ).toBe(true);
    expect(isLoopbackDatasourceUrl("postgresql://u:p@127.0.0.1:5432/db")).toBe(
      true,
    );
    expect(isLoopbackDatasourceUrl(PLACEHOLDER_DATABASE_URL)).toBe(true);
    expect(isLoopbackDatasourceUrl(POOLER_TRANSACTION)).toBe(false);
    // The decoys: the text appears, the connection lands elsewhere.
    expect(
      isLoopbackDatasourceUrl("postgresql://u:p@evil.example.invalid/localhost"),
    ).toBe(false);
    expect(
      isLoopbackDatasourceUrl("postgresql://localhost:p@evil.example.invalid/db"),
    ).toBe(false);
  });

  test("operator migration paths fail closed when DIRECT_URL is absent", () => {
    expect(() =>
      assertOperatorMigrationDatasource({ DATABASE_URL: POOLER_TRANSACTION }),
    ).toThrow(/DIRECT_URL/);
    expect(() =>
      assertOperatorMigrationDatasource({
        DATABASE_URL: POOLER_TRANSACTION,
        DIRECT_URL: "",
      }),
    ).toThrow(/DIRECT_URL/);
    expect(
      assertOperatorMigrationDatasource({
        DATABASE_URL: POOLER_TRANSACTION,
        DIRECT_URL: OWNER_DIRECT,
      }).url,
    ).toBe(OWNER_DIRECT);
  });

  test("operator migration paths refuse a DIRECT_URL equal to the application URL", () => {
    expect(() =>
      assertOperatorMigrationDatasource({
        DATABASE_URL: OWNER_DIRECT,
        DIRECT_URL: OWNER_DIRECT,
      }),
    ).toThrow(/distinct/);
  });
});

describe("prisma.config.ts source contract", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "prisma.config.ts"),
    "utf8",
  );

  test("delegates migration URL selection to the shared identity module", () => {
    expect(source).toContain("prisma-migration-identity");
    expect(source).toContain("resolveMigrationDatasource");
  });

  test("no longer decides the migration URL from the pooler host itself", () => {
    expect(source).not.toMatch(/migrateUrl\s*=\s*databaseUrl\.replace/);
    expect(source).not.toMatch(/if\s*\(databaseUrl\.includes\("pooler/);
  });
});

/**
 * The runtime client and the migration CLI now answer "which URL does the
 * application connect on" from the same function. They used to answer it
 * separately, and the runtime copy used a substring test on the whole URL —
 * which also matched a URL that merely mentioned `pooler.supabase.com` in a
 * query parameter, handing a rewrite rule to whoever controlled that URL.
 */
describe("lib/db/prisma.ts source contract", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "lib/db/prisma.ts"),
    "utf8",
  );

  test("takes its connection string from the shared resolver", () => {
    expect(source).toContain("prisma-migration-identity");
    expect(source).toContain(
      "const connectionString = resolveApplicationDatasourceUrl(process.env)",
    );
  });

  test("no longer hand-rolls the pgbouncer append", () => {
    // The old form was `connectionString += (… ? "&" : "?") + "pgbouncer=true"`
    // on a `let`. Both halves are gone, so there is nothing left here to drift
    // away from what prisma.config.ts does.
    expect(source).not.toMatch(/connectionString\s*\+=/);
    expect(source).not.toMatch(/\blet connectionString\b/);
  });

  test("keeps the Supabase pooler TLS and pool-sizing behaviour", () => {
    expect(source).toContain("DATABASE_INSECURE_TLS");
    expect(source).toContain("SUPABASE_CA_PEM");
    expect(source).toContain("rejectUnauthorized");
    expect(source).toMatch(/isServerless\s*\?\s*1\s*:\s*5/);
  });

  /**
   * The comment at the top of this file has claimed "pooler detection is
   * HOSTNAME-based" since the rewrite rule moved into the shared module — while
   * the two TLS gates below it went on re-deriving the same fact with
   * `connectionString.includes(...)`, the exact predicate that comment calls the
   * defect. Both gates decide TLS: one picks the CA pin, the other can set
   * `NODE_TLS_REJECT_UNAUTHORIZED=0` for the whole process. A URL carrying
   * `pooler.supabase.com` or `pgbouncer=true` anywhere in it — a password, a
   * database name, an option value — flipped them on a host that is not a
   * pooler.
   *
   * Asserted on the source, because the behaviour is decided at module load
   * from `process.env` and there is no seam to call.
   */
  test("derives every pooler and loopback fact from the shared host-based helpers", () => {
    expect(source).toContain("isSupabasePoolerUrl");
    expect(source).toContain("isPgBouncerDatasourceUrl");
    expect(source).toContain("isLoopbackDatasourceUrl");
  });

  test("no substring test on the connection string decides TLS any more", () => {
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(executable).not.toMatch(/connectionString\.includes\(/);
    expect(executable).not.toContain("'pooler.supabase.com'");
    expect(executable).not.toContain('"pooler.supabase.com"');
    expect(executable).not.toContain("'pgbouncer=true'");
    expect(source).not.toContain('"pgbouncer=true"');
  });

  /** One computation of each fact, read by both gates rather than re-derived. */
  test("computes isUsingPooler and useSSL exactly once", () => {
    expect(source.match(/const isUsingPooler =/g)).toHaveLength(1);
    expect(source.match(/const useSSL =/g)).toHaveLength(1);
    expect(source.match(/const useLocalhost =/g)).toHaveLength(1);
  });
});
