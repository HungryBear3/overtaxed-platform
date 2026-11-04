/** Purpose-bound measurement connection. Never imports the shared Prisma client. */
import { Client } from "pg";
import type { AttributionSqlClient } from "@/lib/attribution/record";

export const MEASUREMENT_ROLE = "ot_prod_app";
export function validMeasurementLogin(url: URL): boolean {
  const username = decodeURIComponent(url.username);
  if (username === MEASUREMENT_ROLE) return true;
  // Supabase pooler uses a project-qualified transport login; SQL identity must
  // still be exactly ot_prod_app. Require an independently configured project.
  const project = process.env.OT_FREE_CHECK_MEASUREMENT_SUPABASE_PROJECT_REF;
  return (
    !!project &&
    /^[a-z0-9]{20}$/.test(project) &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    username === `${MEASUREMENT_ROLE}.${project}`
  );
}
export async function withMeasurementClient<T>(
  run: (client: AttributionSqlClient) => Promise<T>,
): Promise<T> {
  const connectionString = process.env.OT_FREE_CHECK_MEASUREMENT_DATABASE_URL;
  if (!connectionString) throw new Error("measurement_configuration_missing");
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !validMeasurementLogin(url)
  )
    throw new Error("measurement_identity_invalid");
  // Dedicated connection per operation: no stale secret cache, shared pool, or fallback.
  const ca = process.env.SUPABASE_CA_PEM;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!local && !ca) throw new Error("measurement_tls_ca_missing");
  if (!local) {
    for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"])
      url.searchParams.delete(key);
  }
  const client = new Client({
    connectionString: url.toString(),
    ...(!local ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    connectionTimeoutMillis: 500,
    statement_timeout: 500,
    query_timeout: 600,
    application_name: "ot_free_check_measurement",
  });
  try {
    await client.connect();
    const identity =
      await client.query(`SELECT current_user, session_user, rolinherit, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication,
      ((SELECT count(*) FROM pg_auth_members WHERE member=r.oid)=1 AND
       EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
        WHERE m.member=r.oid AND parent.rolname='ot_neutral_app_reader' AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option)
       AND NOT pg_has_role(r.oid,'ot_neutral_app_reader','SET')) AS safe_membership,
      EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o') AS owns_objects
      FROM pg_roles r WHERE rolname=current_user`);
    const r = identity.rows[0];
    if (
      !r ||
      r.current_user !== MEASUREMENT_ROLE ||
      r.session_user !== MEASUREMENT_ROLE ||
      !r.rolinherit ||
      r.rolsuper ||
      r.rolbypassrls ||
      r.rolcreaterole ||
      r.rolcreatedb ||
      r.rolreplication ||
      !r.safe_membership ||
      r.owns_objects
    )
      throw new Error("measurement_identity_unsafe");
    const query = (parts: TemplateStringsArray, values: unknown[]) => ({
      text: parts.reduce(
        (sql, part, index) => sql + (index ? `$${index}` : "") + part,
        "",
      ),
      values,
    });
    const adapter: AttributionSqlClient = {
      async $executeRaw(parts: TemplateStringsArray, ...values: unknown[]) {
        return (await client.query(query(parts, values))).rowCount ?? 0;
      },
      async $queryRaw<R>(
        parts: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<R> {
        return (await client.query(query(parts, values))).rows as R;
      },
    };
    return await run(adapter);
  } finally {
    await client.end().catch(() => undefined);
  }
}
