import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { Client } from "pg";
import {
  OT_PRODUCTION_RECOVERY_SCHEMA,
  OT_PRODUCTION_RECOVERY_CATALOG_SQL,
  OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
  OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
  OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
  OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
  canonicalJson,
  authenticateReceipt,
  countNormalizedManagedMemberships,
  newBackupId,
  sha256,
  type ProductionRecoveryReceipt,
  type RecoveryArtifact,
} from "../lib/fulfillment/neutral-production-recovery";
import {
  readApprovedProductionDatabase,
  readNeutralProductionConnectionConfig,
} from "../lib/fulfillment/neutral-production-identity";
import { assertNeutralFeatureFlagsOff } from "../lib/fulfillment/neutral-production-flags";
import { redactProductionDiagnostic } from "../lib/fulfillment/neutral-production-verifier";
import {
  openPrivateRecoveryArtifact,
  sealPrivateRecoveryArtifact,
  withRecoveryDirectory,
} from "../lib/fulfillment/neutral-recovery-directory";

const secrets = () =>
  Object.values(process.env).filter((value): value is string => Boolean(value));

function fsyncDirectory(directory: string): void {
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function pgEnvironment(connectionString: string): NodeJS.ProcessEnv {
  const parsed = new URL(connectionString);
  return {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    LANG: "C",
    LC_ALL: "C",
    // Credentials stay out of argv/process listings. Explicitly preserve the
    // libpq TLS/session parameters the reviewed URL is allowed to carry.
    PGDATABASE: parsed.pathname.replace(/^\//, ""),
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get("sslmode") ?? "verify-full",
    PGSSLROOTCERT: parsed.searchParams.get("sslrootcert") ?? undefined,
    PGSSLCERT: parsed.searchParams.get("sslcert") ?? undefined,
    PGSSLKEY: parsed.searchParams.get("sslkey") ?? undefined,
    PGOPTIONS: parsed.searchParams.get("options") ?? undefined,
  };
}

async function encryptCommand(input: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  output: string;
  passphrase: string;
  format: RecoveryArtifact["format"];
}): Promise<RecoveryArtifact> {
  const gpgHome = fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-gpg-"));
  fs.chmodSync(gpgHome, 0o700);
  const outputDescriptor = openPrivateRecoveryArtifact(input.output);
  let producer: ReturnType<typeof spawn> | undefined;
  let gpg: ReturnType<typeof spawn> | undefined;
  let complete = false;
  const plaintext = createHash("sha256");
  try {
    producer = spawn(input.command, input.args, {
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    gpg = spawn(
      "gpg",
      [
        "--batch",
        "--yes",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "3",
        "--symmetric",
        "--cipher-algo",
        "AES256",
        "--s2k-mode",
        "3",
        "--s2k-digest-algo",
        "SHA512",
        "--s2k-count",
        "65011712",
        "--compress-algo",
        "none",
      ],
      {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          LANG: "C",
          LC_ALL: "C",
          GNUPGHOME: gpgHome,
        },
        // Stream ciphertext into our already-opened, explicitly chmod(0600)
        // descriptor. This avoids GnuPG/platform umask differences entirely.
        stdio: ["pipe", outputDescriptor, "pipe", "pipe"],
        shell: false,
      },
    );
    let producerError = "";
    let gpgError = "";
    producer.stderr!.setEncoding("utf8");
    producer.stderr!.on("data", (chunk) => (producerError += chunk));
    gpg.stderr!.setEncoding("utf8");
    gpg.stderr!.on("data", (chunk) => (gpgError += chunk));
    producer.stdout!.on("data", (chunk: Buffer) => plaintext.update(chunk));
    producer.stdout!.pipe(gpg.stdin!);
    (gpg.stdio[3] as NodeJS.WritableStream).end(`${input.passphrase}\n`);
    let producerCode: number;
    let gpgCode: number;
    [[producerCode], [gpgCode]] = await Promise.all([
      once(producer, "close") as Promise<[number]>,
      once(gpg, "close") as Promise<[number]>,
    ]);
    if (producerCode !== 0 || gpgCode !== 0)
      throw new Error(
        `${input.command}/gpg failed: ${redactProductionDiagnostic(`${producerError}\n${gpgError}`, secrets())}`,
      );
    sealPrivateRecoveryArtifact(outputDescriptor, input.output);
    complete = true;
  } finally {
    if (!complete) {
      producer?.kill();
      gpg?.kill();
    }
    fs.closeSync(outputDescriptor);
    fs.rmSync(gpgHome, { recursive: true, force: true });
    if (!complete) fs.rmSync(input.output, { force: true });
  }
  const ciphertext = fs.readFileSync(input.output);
  return {
    file: path.basename(input.output),
    format: input.format,
    plaintextSha256: plaintext.digest("hex"),
    ciphertextSha256: sha256(ciphertext),
    ciphertextBytes: ciphertext.byteLength,
  };
}

async function encryptBuffer(input: {
  bytes: Buffer;
  output: string;
  passphrase: string;
  format: RecoveryArtifact["format"];
}): Promise<RecoveryArtifact> {
  const temporary = path.join(os.tmpdir(), `ot-recovery-${randomUUIDSafe()}`);
  // A named pipe, not a regular file: catalog plaintext is never at rest.
  const mkfifo = spawn("mkfifo", [temporary], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      LANG: "C",
      LC_ALL: "C",
    },
    stdio: "ignore",
    shell: false,
  });
  const [code] = (await once(mkfifo, "close")) as [number];
  if (code !== 0) throw new Error("Could not create recovery catalog pipe");
  try {
    const promise = encryptCommand({
      command: "cat",
      args: [temporary],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        LANG: "C",
        LC_ALL: "C",
      },
      output: input.output,
      passphrase: input.passphrase,
      format: input.format,
    });
    const stream = fs.createWriteStream(temporary, { mode: 0o600 });
    stream.end(input.bytes);
    return await promise;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function randomUUIDSafe(): string {
  return newBackupId().replaceAll("-", "");
}

async function main(): Promise<void> {
  const backupStartedAt = new Date().toISOString();
  assertNeutralFeatureFlagsOff(process.env);
  const connection = readNeutralProductionConnectionConfig(process.env);
  const expected = readApprovedProductionDatabase(process.env);
  const passphrase = process.env.OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE;
  const authenticationKey = process.env.OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY;
  if (!passphrase || passphrase.length < 24)
    throw new Error(
      "OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE must contain at least 24 characters",
    );
  if (!authenticationKey || Buffer.byteLength(authenticationKey, "utf8") < 32)
    throw new Error(
      "OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY must contain at least 32 bytes",
    );
  if (authenticationKey === passphrase)
    throw new Error(
      "Recovery authentication key and encryption passphrase must be independent",
    );
  const outputRoot = process.env.OT_NEUTRAL_PRODUCTION_RECOVERY_OUTPUT_DIR;
  if (!outputRoot)
    throw new Error("OT_NEUTRAL_PRODUCTION_RECOVERY_OUTPUT_DIR is required");
  const rootStat = fs.lstatSync(path.resolve(outputRoot));
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    fs.realpathSync(path.resolve(outputRoot)) !== path.resolve(outputRoot) ||
    (typeof process.getuid === "function" &&
      rootStat.uid !== process.getuid()) ||
    (rootStat.mode & 0o077) !== 0
  )
    throw new Error("Recovery output root must be owner-only and symlink-free");

  await withRecoveryDirectory(outputRoot, async (directory) => {
    const client = new Client({ connectionString: connection.urls.owner });
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const beforeResult = await client.query(
        OT_PRODUCTION_RECOVERY_CATALOG_SQL,
        [
          OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
          OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
        ],
      );
      if (beforeResult.rows.length !== 1)
        throw new Error("Recovery catalog snapshot did not return one row");
      const before = beforeResult.rows[0]!.snapshot as Record<string, unknown>;
      const markerResult = await client.query(
        "select coalesce(shobj_description(oid,'pg_database'),'') marker from pg_database where datname=current_database()",
      );
      const comment = JSON.parse(
        String(markerResult.rows[0]?.marker ?? ""),
      ) as Record<string, unknown>;
      if (
        comment.projectRef !== expected.projectRef ||
        comment.instanceId !== expected.markerInstanceId
      )
        throw new Error(
          "Recovery source database marker does not match the approved Production database",
        );
      const versionResult = await client.query(
        "select current_setting('server_version_num')::int value",
      );
      const major = Math.floor(Number(versionResult.rows[0]!.value) / 10_000);
      if (major !== 17 && major !== 18)
        throw new Error(`Recovery source PostgreSQL ${major} is unsupported`);

      const pgEnv = pgEnvironment(connection.urls.owner);
      const artifacts: RecoveryArtifact[] = [];
      artifacts.push(
        await encryptCommand({
          command: "pg_dump",
          args: ["--format=custom", "--no-password"],
          env: pgEnv,
          output: path.join(directory, "database.dump.gpg"),
          passphrase,
          format: "postgres-custom",
        }),
      );
      artifacts.push(
        await encryptCommand({
          command: "pg_dumpall",
          args: ["--roles-only", "--no-role-passwords", "--no-password"],
          env: pgEnv,
          output: path.join(directory, "roles.sql.gpg"),
          passphrase,
          format: "postgres-roles-sql",
        }),
      );
      const catalogBytes = Buffer.from(canonicalJson(before));
      artifacts.push(
        await encryptBuffer({
          bytes: catalogBytes,
          output: path.join(directory, "catalog.json.gpg"),
          passphrase,
          format: "catalog-json",
        }),
      );

      const after = (
        await client.query(OT_PRODUCTION_RECOVERY_CATALOG_SQL, [
          OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
          OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
        ])
      ).rows[0]!.snapshot;
      if (sha256(canonicalJson(after)) !== sha256(catalogBytes))
        throw new Error(
          "Recovery catalog changed while backup artifacts were captured",
        );

      const backupCompletedAt = new Date().toISOString();
      if (
        Date.parse(backupCompletedAt) - Date.parse(backupStartedAt) >
        60 * 60_000
      )
        throw new Error("Recovery capture exceeded the hard 60-minute window");
      const receipt: ProductionRecoveryReceipt = {
        schema: OT_PRODUCTION_RECOVERY_SCHEMA,
        backupId: newBackupId(),
        createdAt: backupCompletedAt,
        backupStartedAt,
        backupCompletedAt,
        projectRef: expected.projectRef,
        markerInstanceId: expected.markerInstanceId,
        sourceServerMajor: major,
        encryption: {
          implementation: "gpg-symmetric-aes256",
          plaintextAtRest: false,
        },
        artifacts,
        catalogDigest: sha256(catalogBytes),
        roleMembershipPortability: {
          policy: OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
          sourceGrantors: [...OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS],
          normalizedGrantor: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
          managedMembershipCount: countNormalizedManagedMemberships(before),
        },
        authenticator: "",
      };
      receipt.authenticator = authenticateReceipt(receipt, authenticationKey);
      const receiptPath = path.join(directory, "backup-receipt.json");
      const receiptDescriptor = openPrivateRecoveryArtifact(receiptPath);
      try {
        fs.writeFileSync(receiptDescriptor, canonicalJson(receipt));
        sealPrivateRecoveryArtifact(receiptDescriptor, receiptPath);
      } finally {
        fs.closeSync(receiptDescriptor);
      }
      fsyncDirectory(directory);
      process.stdout.write(
        `neutral-report PRODUCTION recovery backup: PASS backup_id=${receipt.backupId} receipt_sha256=${sha256(fs.readFileSync(receiptPath))} encrypted_artifacts=3 plaintext_at_rest=false\n`,
      );
    } finally {
      if (connected) await client.end();
    }
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `neutral-report PRODUCTION recovery backup: FAIL\n${redactProductionDiagnostic(error, secrets())}\n`,
  );
  process.exitCode = 1;
});
