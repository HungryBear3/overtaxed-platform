/**
 * Which connection Prisma migrates with — decided once, here.
 *
 * THE DEFECT THIS REPLACES
 *
 * `prisma.config.ts` used to branch on the *application* URL first: if
 * `DATABASE_URL` pointed at a Supabase pooler it synthesized a session-mode
 * variant of that URL and used it for `prisma migrate deploy`, and `DIRECT_URL`
 * was consulted only in the remaining `else` branch. On Supabase that is always
 * the branch that is NOT taken, so a deployment that had carefully provisioned a
 * separate owner credential in `DIRECT_URL` still migrated as whatever role the
 * application URL declared. The environment proved one identity and used
 * another.
 *
 * The rule here is the opposite and unconditional: when `DIRECT_URL` is present
 * it IS the migration connection, verbatim — same role, same host, same port,
 * same options. No pooler rewrite, no appended `pgbouncer=true`, no fallback
 * that can quietly restore the old behaviour.
 *
 * Preview is unaffected in kind and fixed in fact: it already sets both URLs,
 * and its own acceptance contract requires `DIRECT_URL` to declare `postgres`
 * while `DATABASE_URL` declares the restricted application login.
 */

export type MigrationEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Lets `prisma generate` succeed on a build host that has no database
 * environment yet. It is never a connection anything can be migrated through.
 */
export const PLACEHOLDER_DATABASE_URL =
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export type MigrationDatasourceSource =
  | "DIRECT_URL"
  | "DATABASE_URL_SESSION_POOLER"
  | "DATABASE_URL"
  | "PLACEHOLDER";

export type MigrationDatasource = {
  url: string;
  directUrl: string;
  /** Which rule produced the URL, so operator paths can refuse the weak ones. */
  source: MigrationDatasourceSource;
};

const POOLER_HOST_SUFFIX = ".pooler.supabase.com";

/**
 * Host-based, not substring-based. `url.includes("pooler.supabase.com")` also
 * matches a query parameter on an unrelated host, which would hand a rewrite
 * rule to whoever controls that URL.
 */
export function isSupabasePoolerUrl(raw: string): boolean {
  try {
    return new URL(raw).hostname.endsWith(POOLER_HOST_SUFFIX);
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

/**
 * Whether the connection lands on the loopback interface — read from the parsed
 * HOSTNAME, for the same reason as above. `raw.includes("localhost")` is true of
 * a password, a database name or an option value containing that text, and the
 * answer decides whether TLS is used at all.
 */
export function isLoopbackDatasourceUrl(raw: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(raw).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Whether the URL asks Prisma to treat the connection as PgBouncer-fronted,
 * read as a parsed query PARAMETER. `raw.includes("pgbouncer=true")` also
 * matches the text appearing inside some other option's value, and that answer
 * feeds a TLS decision.
 */
export function isPgBouncerDatasourceUrl(raw: string): boolean {
  try {
    return (
      new URL(raw).searchParams.get("pgbouncer")?.toLowerCase() === "true"
    );
  } catch {
    return false;
  }
}

function withOption(raw: string, option: string): string {
  if (raw.includes(option)) return raw;
  return raw + (raw.includes("?") ? "&" : "?") + option;
}

/**
 * Transaction-mode pooling needs Prisma told about it; everything else does not.
 *
 * Both halves are structural: the host decides whether the rewrite applies, and
 * the parsed `pgbouncer` parameter decides whether it is already there. Neither
 * question is answered by looking for a substring anywhere in the URL.
 */
export function resolveApplicationDatasourceUrl(
  env: MigrationEnvironment,
): string {
  const raw = env["DATABASE_URL"]?.trim();
  if (!raw) return PLACEHOLDER_DATABASE_URL;
  if (!isSupabasePoolerUrl(raw)) return raw;
  return isPgBouncerDatasourceUrl(raw) ? raw : withOption(raw, "pgbouncer=true");
}

/**
 * Session mode (5432) avoids "prepared statement already exists" under
 * `migrate deploy`. This is the LAST resort — only for a deployment that never
 * provisioned a separate migration credential at all.
 */
export function sessionModePoolerUrl(raw: string): string {
  return withOption(raw.replace(/:6543\//, ":5432/"), "pgbouncer=true");
}

export function resolveMigrationDatasource(
  env: MigrationEnvironment,
): MigrationDatasource {
  const direct = env["DIRECT_URL"]?.trim();
  if (direct) return { url: direct, directUrl: direct, source: "DIRECT_URL" };

  const database = env["DATABASE_URL"]?.trim();
  if (!database)
    return {
      url: PLACEHOLDER_DATABASE_URL,
      directUrl: PLACEHOLDER_DATABASE_URL,
      source: "PLACEHOLDER",
    };

  if (isSupabasePoolerUrl(database)) {
    const url = sessionModePoolerUrl(database);
    return { url, directUrl: url, source: "DATABASE_URL_SESSION_POOLER" };
  }
  return { url: database, directUrl: database, source: "DATABASE_URL" };
}

/**
 * The operator entrypoints (Production baseline, resolve, verification) must
 * never migrate through a derived or shared URL. Two separate refusals:
 * `DIRECT_URL` absent at all, and `DIRECT_URL` that is merely a copy of the
 * application credential — which would prove an owner identity the application
 * also holds.
 */
export function assertOperatorMigrationDatasource(
  env: MigrationEnvironment,
): MigrationDatasource {
  const resolved = resolveMigrationDatasource(env);
  if (resolved.source !== "DIRECT_URL")
    throw new Error(
      "DIRECT_URL is required: operator migration paths refuse a derived migration connection",
    );
  const application = env["DATABASE_URL"]?.trim();
  if (application && application === resolved.url)
    throw new Error(
      "DIRECT_URL and DATABASE_URL must be distinct credentials",
    );
  return resolved;
}
