import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import {
  OT_PRODUCTION_REHEARSAL_SENTINEL_SCHEMA,
  OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY,
  OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
  authenticateReceipt,
  canonicalJson,
  sha256,
  type RehearsalClusterSentinel,
} from "../lib/fulfillment/neutral-production-recovery";
import { assertManagedExtensionFixtureInstalled } from "./neutral-production-extension-fixture-files";
import { redactProductionDiagnostic } from "../lib/fulfillment/neutral-production-verifier";
import { resolveRecoveryTarget } from "./neutral-recovery-target";

async function main(): Promise<void> {
  const targetUrl = process.env.OT_NEUTRAL_RECOVERY_REHEARSAL_DATABASE_URL;
  const superuser = process.env.OT_NEUTRAL_RECOVERY_REHEARSAL_SUPERUSER;
  const output = process.env.OT_NEUTRAL_RECOVERY_REHEARSAL_SENTINEL;
  const authenticationKey = process.env.OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY;
  if (!targetUrl || !superuser || !output || !authenticationKey)
    throw new Error(
      "Target URL, temporary superuser, sentinel path and authentication key are required",
    );
  const target = await resolveRecoveryTarget(targetUrl);
  const databaseName = target.database;
  if (target.user !== superuser)
    throw new Error(
      "Rehearsal URL user does not match the expected temporary superuser",
    );
  const client = new Client(target.clientConfig);
  await client.connect();
  try {
    const identity = (
      await client.query(`
      select current_user username,
             current_setting('server_version_num')::int version,
             (pg_control_system()).system_identifier::text system_identifier,
             current_setting('data_directory') data_directory,
             (select rolsuper from pg_roles where rolname=current_user) is_superuser
    `)
    ).rows[0]!;
    const major = Math.floor(Number(identity.version) / 10_000);
    const fixture = assertManagedExtensionFixtureInstalled();
    if (
      (major !== 17 && major !== 18) ||
      fixture.major !== major ||
      identity.username !== superuser ||
      !identity.is_superuser
    )
      throw new Error(
        "Rehearsal cluster identity or temporary superuser is invalid",
      );
    const availableExtension = await client.query(`
      select name, version, superuser, trusted, relocatable, schema,
             coalesce(array_to_string(requires,','),'') requires,
             comment
      from pg_available_extension_versions
      where name='supabase_vault'
    `);
    if (
      availableExtension.rows.length !== 1 ||
      availableExtension.rows[0]!.name !== "supabase_vault" ||
      availableExtension.rows[0]!.version !== "0.3.1" ||
      availableExtension.rows[0]!.superuser !== true ||
      availableExtension.rows[0]!.trusted !== false ||
      availableExtension.rows[0]!.relocatable !== false ||
      availableExtension.rows[0]!.schema !== "vault" ||
      availableExtension.rows[0]!.requires !== "" ||
      availableExtension.rows[0]!.comment !== "Supabase Vault Extension"
    )
      throw new Error(
        "Managed extension fixture availability or control metadata is invalid",
      );

    const roles = (
      await client.query(
        "select rolname from pg_roles where rolname !~ '^pg_' order by 1",
      )
    ).rows.map((row) => String(row.rolname));
    if (roles.length !== 1 || roles[0] !== superuser)
      throw new Error(
        `Rehearsal cluster contains valuable or unexpected roles: ${roles.join(",")}`,
      );
    const databases = (
      await client.query(
        "select datname from pg_database where not datistemplate order by 1",
      )
    ).rows.map((row) => String(row.datname));
    if (
      databases.length !== 2 ||
      !databases.includes("postgres") ||
      !databases.includes(databaseName)
    )
      throw new Error(
        `Rehearsal cluster contains valuable or unexpected databases: ${databases.join(",")}`,
      );
    const objects = await client.query(
      "select count(*)::int count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'",
    );
    if (Number(objects.rows[0]!.count) !== 0)
      throw new Error("Rehearsal database is not empty");

    const sentinel: RehearsalClusterSentinel = {
      schema: OT_PRODUCTION_REHEARSAL_SENTINEL_SCHEMA,
      nonce: randomBytes(32).toString("hex"),
      createdAt: new Date().toISOString(),
      systemIdentifier: String(identity.system_identifier),
      dataDirectorySha256: sha256(String(identity.data_directory)),
      databaseName,
      temporarySuperuser: superuser,
      targetServerMajor: major,
      managedExtensionFixture: {
        policy: OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY,
        filesSha256: {
          ...OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
        },
      },
      authenticator: "",
    };
    sentinel.authenticator = authenticateReceipt(sentinel, authenticationKey);
    const commentSql = await client.query(
      "select format('comment on database %I is %L', $1::text, $2::text) sql",
      [databaseName, canonicalJson(sentinel)],
    );
    await client.query(String(commentSql.rows[0]!.sql));
    fs.writeFileSync(path.resolve(output), canonicalJson(sentinel), {
      mode: 0o600,
      flag: "wx",
    });
    process.stdout.write(
      `neutral-report recovery rehearsal setup: PASS target_pg=${major} sentinel=${sentinel.nonce}\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `neutral-report recovery rehearsal setup: FAIL\n${redactProductionDiagnostic(
      error,
      Object.values(process.env).filter((v): v is string => Boolean(v)),
    )}\n`,
  );
  process.exitCode = 1;
});
