import { promises as dns } from "node:dns";
import net from "node:net";
import type { ClientConfig } from "pg";

const PREFIX = "ot_neutral_recovery_rehearsal_";

export type RecoveryTarget = {
  host: string;
  family: 4 | 6;
  port: number;
  database: string;
  user: string;
  password: string;
  clientConfig: ClientConfig;
  pgEnvironment: NodeJS.ProcessEnv;
};

export type RecoveryLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

/**
 * Parse exactly one unambiguous TCP target. Query parameters are forbidden:
 * accepting any of libpq/node-postgres' overlapping override syntaxes would
 * make it possible for validation and mutation to address different servers.
 */
export async function resolveRecoveryTarget(
  connectionString: string,
  lookup: RecoveryLookup = dns.lookup as RecoveryLookup,
): Promise<RecoveryTarget> {
  const parsed = new URL(connectionString);
  if (
    (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") ||
    parsed.search !== "" ||
    parsed.hash !== ""
  )
    throw new Error(
      "Recovery target must be an unambiguous PostgreSQL URL without query parameters or fragments",
    );
  const requestedHost = parsed.hostname.replace(/^\[|\]$/g, "");
  const port = parsed.port ? Number(parsed.port) : 5432;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (
    !requestedHost ||
    !user ||
    !database.startsWith(PREFIX) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error(
      `Recovery target must use TCP and an explicitly identified ${PREFIX}* database`,
    );
  const addresses = await lookup(requestedHost, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) =>
      net.isIPv4(address) ? !address.startsWith("127.") : address !== "::1",
    )
  )
    throw new Error("Recovery target must resolve exclusively to loopback");
  // Pin a literal after validating every answer. Neither node-postgres nor a
  // libpq child is allowed to resolve the operator-supplied hostname again.
  const selected = addresses[0]!;
  const host = selected.address;
  const family = selected.family as 4 | 6;

  const clientConfig: ClientConfig = {
    host,
    port,
    database,
    user,
    password,
    ssl: false,
  };
  const pgEnvironment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    LANG: "C",
    LC_ALL: "C",
    PGHOST: host,
    PGPORT: String(port),
    PGDATABASE: database,
    PGUSER: user,
    PGPASSWORD: password,
    PGSSLMODE: "disable",
  };
  return {
    host,
    family,
    port,
    database,
    user,
    password,
    clientConfig,
    pgEnvironment,
  };
}
