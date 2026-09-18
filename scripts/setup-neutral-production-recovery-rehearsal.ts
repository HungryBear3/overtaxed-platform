import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  assertManagedExtensionFixtureInstalled,
  PRIVATE_RUNTIME_ROOT_VAR,
} from "./neutral-production-extension-fixture-files";
import type { TrustedExecutableOwnershipPolicy } from "./trusted-executable";
import { redactProductionDiagnostic } from "../lib/fulfillment/neutral-production-verifier";
import { resolveRecoveryTarget } from "./neutral-recovery-target";

export async function setupNeutralProductionRecoveryRehearsal(
  input: {
    env?: NodeJS.ProcessEnv;
    testOnlyOwnershipPolicy?: TrustedExecutableOwnershipPolicy;
    writeStatus?: (message: string) => void;
  } = {},
): Promise<void> {
  const env = input.env ?? process.env;
  const targetUrl = env.OT_NEUTRAL_RECOVERY_REHEARSAL_DATABASE_URL;
  const superuser = env.OT_NEUTRAL_RECOVERY_REHEARSAL_SUPERUSER;
  const output = env.OT_NEUTRAL_RECOVERY_REHEARSAL_SENTINEL;
  const authenticationKey = env.OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY;
  const runtimeRoot = env[PRIVATE_RUNTIME_ROOT_VAR];
  if (!targetUrl || !superuser || !output || !authenticationKey || !runtimeRoot)
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
             (select setting from pg_config where name='SHAREDIR') shared_directory,
             (select setting from pg_config where name='PKGLIBDIR') library_directory,
             (select rolsuper from pg_roles where rolname=current_user) is_superuser
    `)
    ).rows[0]!;
    const major = Math.floor(Number(identity.version) / 10_000);
    const fixture = assertManagedExtensionFixtureInstalled(
      runtimeRoot,
      process.cwd(),
      input.testOnlyOwnershipPolicy,
    );
    if (
      (major !== 17 && major !== 18) ||
      fixture.major !== major ||
      identity.shared_directory !== fixture.privateSharedDirectory ||
      identity.library_directory !== fixture.privateLibraryDirectory ||
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
        privateSharedDirectory: fixture.privateSharedDirectory,
        privateLibraryDirectory: fixture.privateLibraryDirectory,
        postgresSha256: fixture.postgresSha256,
        initdbSha256: fixture.initdbSha256,
        privateBinaryTreeSha256: fixture.privateBinaryTreeSha256,
        privateSharedTreeSha256: fixture.privateSharedTreeSha256,
        privateLibraryTreeSha256: fixture.privateLibraryTreeSha256,
        sourcePgConfigSha256: fixture.sourcePgConfigSha256,
        sourceBinaryTreeSha256: fixture.sourceBinaryTreeSha256,
        sourceSharedTreeSha256: fixture.sourceSharedTreeSha256,
        sourceLibraryTreeSha256: fixture.sourceLibraryTreeSha256,
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
    (input.writeStatus ?? ((message) => process.stdout.write(message)))(
      `neutral-report recovery rehearsal setup: PASS target_pg=${major} sentinel=${sentinel.nonce}\n`,
    );
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
)
  setupNeutralProductionRecoveryRehearsal().catch((error: unknown) => {
    process.stderr.write(
      `neutral-report recovery rehearsal setup: FAIL\n${redactProductionDiagnostic(
        error,
        Object.values(process.env).filter((v): v is string => Boolean(v)),
      )}\n`,
    );
    process.exitCode = 1;
  });
