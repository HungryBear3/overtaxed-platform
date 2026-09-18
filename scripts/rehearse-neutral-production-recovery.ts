import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  OT_PRODUCTION_REHEARSAL_SENTINEL_SCHEMA,
  OT_PRODUCTION_RECOVERY_GPG_PATH_VAR,
  OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY,
  OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
  OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
  OT_PRODUCTION_RESTORE_SCHEMA,
  OT_PRODUCTION_RECOVERY_CATALOG_SQL,
  OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
  adaptManagedRoleMembershipGrantors,
  assertManagedRoleMembershipPortabilityCounts,
  assertReceiptAuthenticator,
  assertFreshRehearsalSentinelTimestamp,
  authenticateReceipt,
  canonicalJson,
  assertRecoveryReceipt,
  assertRecoveryExtensionPortability,
  countNormalizedManagedMemberships,
  recoveryExtensionPortability,
  sha256,
  type ProductionRecoveryReceipt,
  type RehearsalClusterSentinel,
  type RestoreRehearsalReceipt,
} from "../lib/fulfillment/neutral-production-recovery";
import {
  RecoveryExtensionSqlTransform,
  planRecoveryArchiveToc,
  type ExtensionSqlPortabilityProof,
} from "../lib/fulfillment/neutral-production-extension-portability";
import {
  materializePrivateCopy,
  privateCopyReadStream,
  readProtectedFile,
  type PrivateArtifactCopy,
} from "./neutral-production-recovery-gate";
import { redactProductionDiagnostic } from "../lib/fulfillment/neutral-production-verifier";
import { resolveRecoveryTarget } from "./neutral-recovery-target";
import {
  assertManagedExtensionFixtureInstalled,
  PRIVATE_RUNTIME_ROOT_VAR,
} from "./neutral-production-extension-fixture-files";
import {
  resolveTrustedExecutable,
  spawnTrusted,
  type TrustedExecutable,
} from "./trusted-executable";

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function decryptRestoreSingleSession(input: {
  rolesSql: Buffer;
  rolesPlaintextSha256: string;
  databaseEncrypted: PrivateArtifactCopy;
  passphrase: string;
  env: NodeJS.ProcessEnv;
  sentinel: RehearsalClusterSentinel;
  psqlCommand: TrustedExecutable;
  pgRestoreCommand: TrustedExecutable;
  gpgCommand: TrustedExecutable;
  expectedDatabaseSha256: string;
}): Promise<{
  roles: string;
  adaptedRoles: string;
  database: string;
  extensions: ExtensionSqlPortabilityProof & { archiveTocSha256: string };
}> {
  const gpgHome = fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-gpg-"));
  fs.chmodSync(gpgHome, 0o700);
  const children = new Set<ChildProcess>();
  const track = <T extends ChildProcess>(child: T): T => {
    children.add(child);
    child.once("close", () => children.delete(child));
    return child;
  };
  const abortPipeline = async (): Promise<void> => {
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([
      Promise.all(
        [...children].map((child) =>
          child.exitCode === null
            ? once(child, "close").catch(() => undefined)
            : undefined,
        ),
      ),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGKILL");
  };
  const psql = track(
    spawnTrusted(input.psqlCommand, ["--no-psqlrc", "--set=ON_ERROR_STOP=1"], {
      env: input.env,
      stdio: ["pipe", "ignore", "pipe"],
      shell: false,
    }),
  );
  const psqlClosed = once(psql, "close") as Promise<
    [number | null, NodeJS.Signals | null]
  >;
  psql.stderr.resume();
  const psqlInputFailed = new Promise<never>((_resolve, reject) => {
    psql.stdin.once("error", (error) => {
      reject(new Error("single-session restore input failed"));
    });
  });
  const prematurePsqlExit = psqlClosed.then(([code, signal]) => {
    throw new Error(
      `single-session restore exited before commit: code=${String(code)} signal=${String(signal)}`,
    );
  });
  const guard = `BEGIN;
DO $ot_recovery_guard$
BEGIN
  IF (pg_control_system()).system_identifier::text <> ${sqlLiteral(input.sentinel.systemIdentifier)}
     OR encode(sha256(convert_to(current_setting('data_directory'),'UTF8')),'hex') <> ${sqlLiteral(input.sentinel.dataDirectorySha256)}
     OR current_database() <> ${sqlLiteral(input.sentinel.databaseName)}
     OR current_user <> ${sqlLiteral(input.sentinel.temporarySuperuser)}
     OR (select setting from pg_config where name='SHAREDIR') <> ${sqlLiteral(input.sentinel.managedExtensionFixture.privateSharedDirectory)}
     OR coalesce((select shobj_description(oid,'pg_database') from pg_database where datname=current_database()),'') <> ${sqlLiteral(canonicalJson(input.sentinel))}
  THEN
    RAISE EXCEPTION 'recovery rehearsal sentinel mismatch';
  END IF;
END
$ot_recovery_guard$;
`;
  psql.stdin.write(guard);

  const decryptInto = async (
    consumer: NodeJS.WritableStream,
    endConsumer: boolean,
  ): Promise<string> => {
    const encrypted = privateCopyReadStream(input.databaseEncrypted);
    const gpg = track(
      spawnTrusted(
        input.gpgCommand,
        [
          "--batch",
          "--quiet",
          "--no-options",
          "--pinentry-mode",
          "loopback",
          "--passphrase-fd",
          "3",
          "--decrypt",
        ],
        {
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "production",
            LANG: "C",
            LC_ALL: "C",
            GNUPGHOME: gpgHome,
          },
          stdio: ["pipe", "pipe", "pipe", "pipe"],
        },
      ),
    );
    encrypted.pipe(gpg.stdin!);
    const gpgClosed = once(gpg, "close") as Promise<
      [number | null, NodeJS.Signals | null]
    >;
    const digest = createHash("sha256");
    gpg.stdout!.on("data", (chunk: Buffer) => digest.update(chunk));
    gpg.stderr!.resume();
    gpg.stdout!.pipe(consumer, { end: endConsumer });
    (gpg.stdio[3] as NodeJS.WritableStream).end(`${input.passphrase}\n`);
    const [code] = await Promise.race([
      gpgClosed,
      prematurePsqlExit,
      psqlInputFailed,
    ]);
    if (code !== 0) throw new Error("gpg restore decrypt failed");
    return digest.digest("hex");
  };
  try {
    const adaptedRoles = sha256(input.rolesSql);
    if (!psql.stdin.write(input.rolesSql))
      await Promise.race([
        once(psql.stdin, "drain"),
        prematurePsqlExit,
        psqlInputFailed,
      ]);
    const integritySink = new PassThrough();
    integritySink.resume();
    const verifiedDatabaseHash = await decryptInto(integritySink, true);
    if (verifiedDatabaseHash !== input.expectedDatabaseSha256)
      throw new Error(
        "Recovery database plaintext checksum mismatch before restore",
      );

    const runArchive = async (archiveInput: {
      args: string[];
      toc?: Buffer;
      output: NodeJS.WritableStream;
      endOutput: boolean;
    }): Promise<void> => {
      const encrypted = privateCopyReadStream(input.databaseEncrypted);
      const gpg = track(
        spawnTrusted(
          input.gpgCommand,
          [
            "--batch",
            "--quiet",
            "--no-options",
            "--pinentry-mode",
            "loopback",
            "--passphrase-fd",
            "3",
            "--decrypt",
          ],
          {
            env: {
              PATH: process.env.PATH,
              NODE_ENV: "production",
              LANG: "C",
              LC_ALL: "C",
              GNUPGHOME: gpgHome,
            },
            stdio: ["pipe", "pipe", "ignore", "pipe"],
          },
        ),
      );
      encrypted.pipe(gpg.stdin!);
      const restore = track(
        spawnTrusted(input.pgRestoreCommand, archiveInput.args, {
          env: input.env,
          stdio: archiveInput.toc
            ? ["pipe", "pipe", "pipe", "pipe"]
            : ["pipe", "pipe", "pipe"],
        }),
      );
      const restoreClosed = once(restore, "close") as Promise<
        [number | null, NodeJS.Signals | null]
      >;
      restore.stderr.resume();
      const restoreInputFailed = new Promise<never>((_resolve, reject) => {
        restore.stdin.once("error", (error) => {
          if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
            reject(new Error("pg_restore input failed"));
          }
        });
      });
      if (archiveInput.toc)
        (restore.stdio[3] as NodeJS.WritableStream).end(archiveInput.toc);
      const outputEnded = archiveInput.endOutput
        ? once(archiveInput.output, "end")
        : once(restore.stdout, "end");
      restore.stdout.pipe(archiveInput.output, {
        end: archiveInput.endOutput,
      });
      gpg.stdout!.pipe(restore.stdin);
      (gpg.stdio[3] as NodeJS.WritableStream).end(`${input.passphrase}\n`);
      const [[restoreCode]] = await Promise.race([
        Promise.all([restoreClosed, outputEnded]),
        prematurePsqlExit,
        psqlInputFailed,
        restoreInputFailed,
      ]);
      if (restoreCode !== 0) throw new Error("pg_restore SQL emission failed");
      if (gpg.exitCode === null) gpg.kill("SIGTERM");
      await Promise.race([
        gpg.exitCode === null ? once(gpg, "close") : Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    };

    const readArchiveToc = async (): Promise<Buffer> => {
      const encrypted = privateCopyReadStream(input.databaseEncrypted);
      const gpg = track(
        spawnTrusted(
          input.gpgCommand,
          [
            "--batch",
            "--quiet",
            "--no-options",
            "--pinentry-mode",
            "loopback",
            "--passphrase-fd",
            "3",
            "--decrypt",
          ],
          {
            env: {
              PATH: process.env.PATH,
              NODE_ENV: "production",
              LANG: "C",
              LC_ALL: "C",
              GNUPGHOME: gpgHome,
            },
            stdio: ["pipe", "pipe", "ignore", "pipe"],
          },
        ),
      );
      encrypted.pipe(gpg.stdin!);
      const restore = track(
        spawnTrusted(input.pgRestoreCommand, ["--list"], {
          env: input.env,
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
      const chunks: Buffer[] = [];
      restore.stdout.on("data", (chunk: Buffer) =>
        chunks.push(Buffer.from(chunk)),
      );
      restore.stderr.resume();
      restore.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") restore.kill("SIGTERM");
      });
      gpg.stdout!.pipe(restore.stdin);
      (gpg.stdio[3] as NodeJS.WritableStream).end(`${input.passphrase}\n`);
      const [restoreCode] = (await Promise.race([
        once(restore, "close"),
        prematurePsqlExit,
        psqlInputFailed,
      ])) as [number | null];
      if (restoreCode !== 0) throw new Error("pg_restore archive TOC failed");
      if (gpg.exitCode === null) gpg.kill("SIGTERM");
      await Promise.race([
        gpg.exitCode === null ? once(gpg, "close") : Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      const toc = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      return toc;
    };

    const tocBytes = await readArchiveToc();
    const archivePlan = planRecoveryArchiveToc(tocBytes);
    tocBytes.fill(0);
    await runArchive({
      args: ["--exit-on-error", "--file=-", "--use-list=/dev/fd/3"],
      toc: archivePlan.schemas,
      output: psql.stdin,
      endOutput: false,
    });
    const extensionTransform = new RecoveryExtensionSqlTransform();
    extensionTransform.pipe(psql.stdin, { end: false });
    await runArchive({
      args: ["--exit-on-error", "--file=-", "--use-list=/dev/fd/3"],
      toc: archivePlan.extensions,
      output: extensionTransform,
      endOutput: true,
    });
    await runArchive({
      args: ["--exit-on-error", "--file=-", "--use-list=/dev/fd/3"],
      toc: archivePlan.remainder,
      output: psql.stdin,
      endOutput: false,
    });
    archivePlan.schemas.fill(0);
    archivePlan.extensions.fill(0);
    archivePlan.remainder.fill(0);
    psql.stdin.end("COMMIT;\n");
    const [psqlCode] = await psqlClosed;
    if (psqlCode !== 0) throw new Error("single-session restore failed");
    return {
      roles: input.rolesPlaintextSha256,
      adaptedRoles,
      database: verifiedDatabaseHash,
      extensions: {
        ...extensionTransform.proof(),
        archiveTocSha256: archivePlan.archiveTocSha256,
      },
    };
  } finally {
    await abortPipeline();
    fs.rmSync(gpgHome, { recursive: true, force: true });
  }
}

async function decryptBuffer(
  copy: PrivateArtifactCopy,
  passphrase: string,
  gpgCommand: TrustedExecutable,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const gpgHome = fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-gpg-"));
  fs.chmodSync(gpgHome, 0o700);
  try {
    const encrypted = privateCopyReadStream(copy);
    const gpg = spawnTrusted(
      gpgCommand,
      [
        "--batch",
        "--quiet",
        "--no-options",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "3",
        "--decrypt",
      ],
      {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          LANG: "C",
          LC_ALL: "C",
          GNUPGHOME: gpgHome,
        },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    encrypted.pipe(gpg.stdin!);
    gpg.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
    gpg.stderr!.resume();
    (gpg.stdio[3] as NodeJS.WritableStream).end(`${passphrase}\n`);
    const [code] = (await once(gpg, "close")) as [number];
    if (code !== 0) throw new Error("gpg decrypt failed");
    return Buffer.concat(chunks);
  } finally {
    fs.rmSync(gpgHome, { recursive: true, force: true });
  }
}

export async function rehearseNeutralProductionRecovery(
  dependencies: {
    verifyInstalledFixture?: typeof assertManagedExtensionFixtureInstalled;
    resolveRuntimeExecutable?: (file: string) => TrustedExecutable;
  } = {},
): Promise<void> {
  const verifyInstalledFixture =
    dependencies.verifyInstalledFixture ??
    assertManagedExtensionFixtureInstalled;
  const resolveRuntimeExecutable =
    dependencies.resolveRuntimeExecutable ??
    ((file: string) =>
      resolveTrustedExecutable(file, { allowStickyAncestors: true }));
  const receiptPath = process.env.OT_NEUTRAL_PRODUCTION_RECOVERY_RECEIPT;
  const targetUrl = process.env.OT_NEUTRAL_RECOVERY_REHEARSAL_DATABASE_URL;
  const passphrase = process.env.OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE;
  const authenticationKey = process.env.OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY;
  const sentinelPath = process.env.OT_NEUTRAL_RECOVERY_REHEARSAL_SENTINEL;
  const runtimeRoot = process.env[PRIVATE_RUNTIME_ROOT_VAR];
  const gpgPath = process.env[OT_PRODUCTION_RECOVERY_GPG_PATH_VAR];
  if (
    !receiptPath ||
    !targetUrl ||
    !passphrase ||
    !authenticationKey ||
    !sentinelPath ||
    !runtimeRoot ||
    !gpgPath
  )
    throw new Error(
      "Receipt, target, passphrase, authentication key and cluster sentinel are required",
    );
  const resolvedTarget = await resolveRecoveryTarget(targetUrl);
  const installedFixture = verifyInstalledFixture(runtimeRoot);
  const gpgCommand = resolveTrustedExecutable(gpgPath);
  const psqlCommand = resolveRuntimeExecutable(
    path.join(installedFixture.privateBinaryDirectory, "psql"),
  );
  const pgRestoreCommand = resolveRuntimeExecutable(
    path.join(installedFixture.privateBinaryDirectory, "pg_restore"),
  );
  const receiptBytes = readProtectedFile(receiptPath);
  const receipt = JSON.parse(
    receiptBytes.toString("utf8"),
  ) as ProductionRecoveryReceipt;
  assertRecoveryReceipt(receipt);
  assertReceiptAuthenticator(receipt, authenticationKey);
  const sentinel = JSON.parse(
    readProtectedFile(sentinelPath).toString("utf8"),
  ) as RehearsalClusterSentinel;
  if (sentinel.schema !== OT_PRODUCTION_REHEARSAL_SENTINEL_SCHEMA)
    throw new Error("Rehearsal cluster sentinel schema is invalid");
  assertReceiptAuthenticator(sentinel, authenticationKey);
  assertFreshRehearsalSentinelTimestamp(sentinel.createdAt);
  if (
    sentinel.managedExtensionFixture?.policy !==
      OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY ||
    canonicalJson(sentinel.managedExtensionFixture.filesSha256) !==
      canonicalJson(OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES) ||
    sentinel.managedExtensionFixture.privateSharedDirectory !==
      installedFixture.privateSharedDirectory ||
    sentinel.managedExtensionFixture.postgresSha256 !==
      installedFixture.postgresSha256 ||
    sentinel.managedExtensionFixture.initdbSha256 !==
      installedFixture.initdbSha256 ||
    sentinel.managedExtensionFixture.privateBinaryTreeSha256 !==
      installedFixture.privateBinaryTreeSha256 ||
    sentinel.managedExtensionFixture.privateSharedTreeSha256 !==
      installedFixture.privateSharedTreeSha256 ||
    sentinel.managedExtensionFixture.sourcePgConfigSha256 !==
      installedFixture.sourcePgConfigSha256 ||
    sentinel.managedExtensionFixture.sourceBinaryTreeSha256 !==
      installedFixture.sourceBinaryTreeSha256 ||
    sentinel.managedExtensionFixture.sourceSharedTreeSha256 !==
      installedFixture.sourceSharedTreeSha256
  )
    throw new Error("Rehearsal managed extension fixture proof is invalid");

  const directory = path.dirname(path.resolve(receiptPath));
  const byFormat = Object.fromEntries(
    receipt.artifacts.map((artifact) => [artifact.format, artifact]),
  );
  const privateArtifacts = new Map<
    string,
    ReturnType<typeof materializePrivateCopy>
  >();
  let target: Client | undefined;
  let targetEnded = false;
  let pristineTargetManagedMembershipCount = -1;
  try {
    for (const artifact of receipt.artifacts) {
      const bytes = readProtectedFile(path.join(directory, artifact.file));
      if (
        bytes.byteLength !== artifact.ciphertextBytes ||
        sha256(bytes) !== artifact.ciphertextSha256
      )
        throw new Error(
          `Encrypted recovery artifact changed: ${artifact.file}`,
        );
      privateArtifacts.set(artifact.file, materializePrivateCopy(bytes));
    }
    const pgEnv = resolvedTarget.pgEnvironment;
    target = new Client(resolvedTarget.clientConfig);
    await target.connect();
    const identity = (
      await target.query(`select current_user username, current_setting('server_version_num')::int version,
      (pg_control_system()).system_identifier::text system_identifier, current_setting('data_directory') data_directory,
      (select setting from pg_config where name='SHAREDIR') shared_directory,
      coalesce(shobj_description(oid,'pg_database'),'') database_comment from pg_database where datname=current_database()`)
    ).rows[0]!;
    const major = Math.floor(Number(identity.version) / 10_000);
    if (major !== 17 && major !== 18)
      throw new Error(`Restore target PostgreSQL ${major} is unsupported`);
    if (
      sentinel.targetServerMajor !== major ||
      installedFixture.major !== major ||
      String(identity.shared_directory) !==
        installedFixture.privateSharedDirectory ||
      sentinel.systemIdentifier !== String(identity.system_identifier) ||
      sentinel.dataDirectorySha256 !==
        sha256(String(identity.data_directory)) ||
      sentinel.databaseName !== resolvedTarget.database ||
      sentinel.temporarySuperuser !== String(identity.username) ||
      String(identity.database_comment) !== canonicalJson(sentinel)
    )
      throw new Error(
        "Rehearsal cluster sentinel does not match the live cluster",
      );
    const rolesBefore = (
      await target.query(
        "select rolname from pg_roles where rolname !~ '^pg_' order by 1",
      )
    ).rows.map((row) => String(row.rolname));
    const dbsBefore = (
      await target.query(
        "select datname from pg_database where not datistemplate order by 1",
      )
    ).rows.map((row) => String(row.datname));
    if (
      rolesBefore.length !== 1 ||
      rolesBefore[0] !== sentinel.temporarySuperuser
    )
      throw new Error(
        "Rehearsal cluster contains unexpected roles before globals restore",
      );
    if (
      dbsBefore.length !== 2 ||
      !dbsBefore.includes("postgres") ||
      !dbsBefore.includes(sentinel.databaseName)
    )
      throw new Error(
        "Rehearsal cluster contains unexpected databases before globals restore",
      );
    const emptiness = await target.query(
      "select count(*)::int objects from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'",
    );
    if (Number(emptiness.rows[0]!.objects) !== 0)
      throw new Error("Restore rehearsal target is not empty");
    const pristineTargetCatalog = (
      await target.query(OT_PRODUCTION_RECOVERY_CATALOG_SQL, [
        OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
        [sentinel.temporarySuperuser],
        [
          ...OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
          sentinel.temporarySuperuser,
        ],
      ])
    ).rows[0]!.snapshot;
    pristineTargetManagedMembershipCount = countNormalizedManagedMemberships(
      pristineTargetCatalog,
    );
    await target.end();
    targetEnded = true;

    // Deterministic adversarial integration hook only; never available in an
    // operator/Production process. It lets the suite replace a loopback
    // listener after the preliminary Node inspection and prove the psql guard
    // refuses that replacement before consuming restore SQL.
    const testHook = process.env.OT_TEST_RECOVERY_AFTER_NODE_VALIDATION_HOOK;
    if (process.env.NODE_ENV === "test" && testHook) {
      fs.writeFileSync(`${testHook}.ready`, "ready", {
        flag: "wx",
        mode: 0o600,
      });
      const deadline = Date.now() + 10_000;
      while (!fs.existsSync(`${testHook}.continue`)) {
        if (Date.now() > deadline)
          throw new Error("Recovery swap test hook timed out");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    const roles = byFormat["postgres-roles-sql"]!;
    const catalog = byFormat["catalog-json"]!;
    const rolesPlaintext = await decryptBuffer(
      privateArtifacts.get(roles.file)!,
      passphrase,
      gpgCommand,
    );
    if (sha256(rolesPlaintext) !== roles.plaintextSha256)
      throw new Error(
        `Decrypted recovery artifact checksum mismatch: ${roles.file}`,
      );
    const sourceCatalog = await decryptBuffer(
      privateArtifacts.get(catalog.file)!,
      passphrase,
      gpgCommand,
    );
    if (
      sha256(sourceCatalog) !== catalog.plaintextSha256 ||
      sha256(sourceCatalog) !== receipt.catalogDigest
    )
      throw new Error(
        `Decrypted recovery artifact checksum mismatch: ${catalog.file}`,
      );
    const sourceCatalogSnapshot = JSON.parse(
      sourceCatalog.toString("utf8"),
    ) as unknown;
    const sourceExtensionPortability = recoveryExtensionPortability(
      sourceCatalogSnapshot,
    );
    assertRecoveryExtensionPortability(
      receipt.extensionPortability,
      sourceCatalogSnapshot,
    );
    const normalizedSourceCount = countNormalizedManagedMemberships(
      sourceCatalogSnapshot,
    );
    const adaptedRoles = adaptManagedRoleMembershipGrantors(rolesPlaintext);
    assertManagedRoleMembershipPortabilityCounts({
      authenticatedSourceCount:
        receipt.roleMembershipPortability.managedMembershipCount,
      sourceCatalogCount: normalizedSourceCount,
      pristineTargetCount: pristineTargetManagedMembershipCount,
      adaptedStatementCount: adaptedRoles.managedMembershipCount,
    });

    const database = byFormat["postgres-custom"]!;
    verifyInstalledFixture(runtimeRoot);
    const restoredArtifactHashes = await decryptRestoreSingleSession({
      rolesSql: adaptedRoles.bytes,
      rolesPlaintextSha256: sha256(rolesPlaintext),
      databaseEncrypted: privateArtifacts.get(database.file)!,
      passphrase,
      env: pgEnv,
      sentinel,
      psqlCommand,
      pgRestoreCommand,
      gpgCommand,
      expectedDatabaseSha256: database.plaintextSha256,
    });
    const observed: Record<string, string> = {
      [roles.file]: restoredArtifactHashes.roles,
      [database.file]: restoredArtifactHashes.database,
    };
    observed[catalog.file] = sha256(sourceCatalog);
    for (const artifact of receipt.artifacts)
      if (observed[artifact.file] !== artifact.plaintextSha256)
        throw new Error(
          `Decrypted recovery artifact checksum mismatch: ${artifact.file}`,
        );

    const verifier = new Client(resolvedTarget.clientConfig);
    await verifier.connect();
    try {
      const restored = (
        await verifier.query(OT_PRODUCTION_RECOVERY_CATALOG_SQL, [
          OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
          [sentinel.temporarySuperuser],
          [
            ...OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
            sentinel.temporarySuperuser,
          ],
        ])
      ).rows[0]!.snapshot;
      const restoredDigest = sha256(canonicalJson(restored));
      const restoredExtensionPortability =
        recoveryExtensionPortability(restored);
      if (
        restoredDigest !== receipt.catalogDigest ||
        sha256(sourceCatalog) !== receipt.catalogDigest ||
        canonicalJson(restoredExtensionPortability) !==
          canonicalJson(sourceExtensionPortability)
      )
        throw new Error(
          `Restored catalog/role/ACL snapshot does not match the source receipt (sections=${
            [
              ...new Set([
                ...Object.keys(
                  sourceCatalogSnapshot as Record<string, unknown>,
                ),
                ...Object.keys(restored as Record<string, unknown>),
              ]),
            ]
              .filter(
                (key) =>
                  canonicalJson(
                    (sourceCatalogSnapshot as Record<string, unknown>)[key],
                  ) !==
                  canonicalJson((restored as Record<string, unknown>)[key]),
              )
              .sort()
              .join(",") || "unknown"
          })`,
        );
      const rehearsal: RestoreRehearsalReceipt = {
        schema: OT_PRODUCTION_RESTORE_SCHEMA,
        backupId: receipt.backupId,
        backupReceiptSha256: sha256(receiptBytes),
        targetServerMajor: major,
        restoredAt: new Date().toISOString(),
        artifactPlaintextSha256: observed,
        sourceCatalogDigest: receipt.catalogDigest,
        restoredCatalogDigest: restoredDigest,
        roleMembershipPortability: {
          policy: receipt.roleMembershipPortability.policy,
          authenticatedSourceCount:
            receipt.roleMembershipPortability.managedMembershipCount,
          pristineTargetCount: pristineTargetManagedMembershipCount,
          adaptedStatementCount: adaptedRoles.managedMembershipCount,
          adaptedRolesSha256: restoredArtifactHashes.adaptedRoles,
        },
        extensionPortability: {
          ...sourceExtensionPortability,
          ...restoredArtifactHashes.extensions,
        },
        verified: true,
        clusterSystemIdentifier: sentinel.systemIdentifier,
        clusterSentinelNonce: sentinel.nonce,
        authenticator: "",
      };
      rehearsal.authenticator = authenticateReceipt(
        rehearsal,
        authenticationKey,
      );
      const output = path.join(directory, `restore-rehearsal-pg${major}.json`);
      fs.writeFileSync(output, canonicalJson(rehearsal), {
        mode: 0o600,
        flag: "wx",
      });
      const descriptor = fs.openSync(output, "r");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      process.stdout.write(
        `neutral-report PRODUCTION recovery rehearsal: PASS backup_id=${receipt.backupId} target_pg=${major} catalog=verified artifacts=verified\n`,
      );
    } finally {
      await verifier.end();
    }
  } finally {
    if (target && !targetEnded) await target.end().catch(() => undefined);
    for (const artifact of privateArtifacts.values()) artifact.cleanup();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  rehearseNeutralProductionRecovery().catch((error: unknown) => {
    process.stderr.write(
      `neutral-report PRODUCTION recovery rehearsal: FAIL\n${redactProductionDiagnostic(
        error,
        Object.values(process.env).filter((v): v is string => Boolean(v)),
      )}\n`,
    );
    process.exitCode = 1;
  });
