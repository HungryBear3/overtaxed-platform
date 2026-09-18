/** @jest-environment node */
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import {
  OT_PRODUCTION_RECOVERY_CATALOG_SQL,
  OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
  OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
  OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
  OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
  OT_PRODUCTION_RECOVERY_SCHEMA,
  canonicalJson,
  authenticateReceipt,
  countNormalizedManagedMemberships,
  recoveryExtensionPortability,
  sha256,
  type ProductionRecoveryReceipt,
  type RecoveryArtifact,
} from "@/lib/fulfillment/neutral-production-recovery";
import { assertManagedExtensionFixtureInstalled } from "@/scripts/neutral-production-extension-fixture-files";
import { unitTestTrustedExecutablePolicy } from "@/scripts/trusted-executable";

const TEST_EXECUTABLE_POLICY = unitTestTrustedExecutablePolicy(
  process.getuid!(),
);

function available(): boolean {
  try {
    for (const bin of [
      process.env.OT_TEST_SOURCE_PG_BIN,
      process.env.OT_TEST_TARGET_PG_BIN,
    ])
      execFileSync(bin ? path.join(bin, "initdb") : "initdb", ["--version"], {
        stdio: "ignore",
      });
    for (const runtime of [
      process.env.OT_TEST_SOURCE_PG_RUNTIME,
      process.env.OT_TEST_TARGET_PG_RUNTIME,
    ])
      assertManagedExtensionFixtureInstalled(
        runtime ?? "",
        process.cwd(),
        TEST_EXECUTABLE_POLICY,
      );
    execFileSync("gpg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const suite = available() ? describe : describe.skip;

suite("no-PITR encrypted recovery on disposable PostgreSQL", () => {
  const roots: Array<{ root: string; bin?: string }> = [];
  const passphrase = "synthetic-recovery-passphrase-32-chars";
  const authenticationKey = "synthetic-authentication-key-at-least-32-bytes";
  const vaultSecretId = "11111111-2222-4333-8444-555555555555";
  const vaultCiphertext = "ZW5jcnlwdGVkLXNlY3JldC1ieXRlcw==";
  const vaultNonceHex = "11".repeat(24);
  const vaultTimestamp = "2026-09-17T12:34:56Z";

  const binary = (bin: string | undefined, name: string) =>
    bin ? path.join(bin, name) : name;
  const cluster = (user: string, bin?: string, forcedPort?: number) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-pg-"));
    const data = path.join(root, "data");
    const socket = path.join(root, "socket");
    const port = forcedPort ?? 44000 + Math.floor(Math.random() * 8000);
    fs.mkdirSync(socket);
    execFileSync(
      binary(bin, "initdb"),
      ["-D", data, "-A", "trust", "-U", user],
      {
        stdio: "ignore",
      },
    );
    execFileSync(
      binary(bin, "pg_ctl"),
      ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-w", "start"],
      { stdio: "ignore" },
    );
    roots.push({ root, bin });
    return {
      root,
      data,
      socket,
      port,
      url: `postgresql://${user}@127.0.0.1:${port}/postgres`,
    };
  };

  afterAll(() => {
    roots.forEach(({ root, bin }) => {
      try {
        execFileSync(
          binary(bin, "pg_ctl"),
          ["-D", path.join(root, "data"), "-m", "fast", "-w", "stop"],
          { stdio: "ignore" },
        );
      } catch {}
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  test("decrypts, restores and proves artifacts plus role/ACL catalog", async () => {
    const sourceBin = process.env.OT_TEST_SOURCE_PG_BIN;
    const targetBin = process.env.OT_TEST_TARGET_PG_BIN;
    const source = cluster("supabase_admin", sourceBin);
    const target = cluster("restore_admin", targetBin);
    const targetDatabase = "ot_neutral_recovery_rehearsal_test";
    execFileSync(
      binary(targetBin, "createdb"),
      [
        "--host=127.0.0.1",
        `--port=${target.port}`,
        "--username=restore_admin",
        targetDatabase,
      ],
      { stdio: "ignore" },
    );
    const targetUrl = `postgresql://restore_admin@127.0.0.1:${target.port}/${targetDatabase}`;
    const sourceClient = new Client({ connectionString: source.url });
    await sourceClient.connect();
    await sourceClient.query(`
      create role postgres login superuser;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create role portable_admin login;
      create role ot_prod_app login inherit;
      create role ot_prod_neutral_runtime login inherit;
      create role ot_prod_neutral_delivery login inherit;
      create schema extensions authorization postgres;
      create schema vault authorization supabase_admin;
      create extension pg_stat_statements with schema extensions version '1.11';
      create extension pgcrypto with schema extensions version '1.3';
      create extension supabase_vault with schema vault version '0.3.1';
      create extension "uuid-ossp" with schema extensions version '1.1';
      alter schema public owner to postgres;
      set role postgres;
      create table public.recovery_fixture(id text primary key, value text not null);
      insert into public.recovery_fixture values ('one','unchanged');
      create table public.recovery_backpressure(id integer primary key, payload text not null);
      insert into public.recovery_backpressure
      select n, md5(n::text) || md5((n+1)::text) || md5((n+2)::text) || md5((n+3)::text)
      from generate_series(1,131072) n;
      revoke all on public.recovery_fixture from public;
      revoke all on public.recovery_backpressure from public;
      grant select on public.recovery_fixture to ot_prod_app;
      grant select on public.recovery_backpressure to ot_prod_app;
      reset role;
      grant anon to authenticated with inherit true, set false;
      grant anon to portable_admin with admin option, inherit true, set true;
    `);
    await sourceClient.query(
      `insert into vault.secrets(
         id,name,description,secret,key_id,nonce,created_at,updated_at
       ) values ($1::uuid,$2,$3,$4,null,decode($5,'hex'),$6::timestamptz,$6::timestamptz)`,
      [
        vaultSecretId,
        "synthetic-config-row",
        "encrypted fixture",
        vaultCiphertext,
        vaultNonceHex,
        vaultTimestamp,
      ],
    );
    const sourceVaultRows = (
      await sourceClient.query(
        `select id::text, name, description, secret, key_id::text,
                encode(nonce,'hex') nonce_hex,
                to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') created_at,
                to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') updated_at
         from vault.secrets order by id`,
      )
    ).rows;
    expect(sourceVaultRows).toEqual([
      {
        id: vaultSecretId,
        name: "synthetic-config-row",
        description: "encrypted fixture",
        secret: vaultCiphertext,
        key_id: null,
        nonce_hex: vaultNonceHex,
        created_at: vaultTimestamp,
        updated_at: vaultTimestamp,
      },
    ]);
    const portableSource = new Client({
      connectionString: `postgresql://portable_admin@127.0.0.1:${source.port}/postgres`,
    });
    await portableSource.connect();
    await portableSource.query(
      "grant anon to service_role with inherit false, set true",
    );
    await portableSource.end();
    const catalog = (
      await sourceClient.query(OT_PRODUCTION_RECOVERY_CATALOG_SQL, [
        OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
        OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
        OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
      ])
    ).rows[0]!.snapshot;
    await sourceClient.end();

    const directory = path.join(source.root, "backup");
    fs.mkdirSync(directory, { mode: 0o700 });
    const pgEnv = {
      ...process.env,
      PGDATABASE: "postgres",
      PGHOST: "127.0.0.1",
      PGPORT: String(source.port),
      PGUSER: "supabase_admin",
      PGPASSWORD: undefined,
    };
    const plaintext = [
      [
        "database.dump",
        "postgres-custom",
        [binary(sourceBin, "pg_dump"), ["--format=custom", "--no-password"]],
      ],
      [
        "roles.sql",
        "postgres-roles-sql",
        [
          binary(sourceBin, "pg_dumpall"),
          ["--roles-only", "--no-role-passwords", "--no-password"],
        ],
      ],
    ] as const;
    const artifacts: RecoveryArtifact[] = [];
    for (const [name, format, [command, args]] of plaintext) {
      const bytes = execFileSync(command, [...args], {
        env: pgEnv,
        maxBuffer: 32 * 1024 * 1024,
      });
      if (format === "postgres-roles-sql") {
        const rolesSql = bytes.toString("utf8");
        expect(rolesSql).toMatch(
          /GRANT anon TO authenticated .*GRANTED BY supabase_admin;/,
        );
        expect(rolesSql).toMatch(
          /GRANT anon TO service_role .*GRANTED BY portable_admin;/,
        );
      }
      const encrypted = `${name}.gpg`;
      execFileSync(
        "gpg",
        [
          "--batch",
          "--yes",
          "--pinentry-mode",
          "loopback",
          "--passphrase",
          passphrase,
          "--symmetric",
          "--cipher-algo",
          "AES256",
          "--compress-algo",
          "none",
          "--output",
          path.join(directory, encrypted),
        ],
        { input: bytes, stdio: ["pipe", "ignore", "ignore"] },
      );
      fs.chmodSync(path.join(directory, encrypted), 0o400);
      const cipher = fs.readFileSync(path.join(directory, encrypted));
      artifacts.push({
        file: encrypted,
        format,
        plaintextSha256: sha256(bytes),
        ciphertextSha256: sha256(cipher),
        ciphertextBytes: cipher.length,
      });
    }
    const catalogBytes = Buffer.from(canonicalJson(catalog));
    const catalogFile = "catalog.json.gpg";
    execFileSync(
      "gpg",
      [
        "--batch",
        "--yes",
        "--pinentry-mode",
        "loopback",
        "--passphrase",
        passphrase,
        "--symmetric",
        "--cipher-algo",
        "AES256",
        "--compress-algo",
        "none",
        "--output",
        path.join(directory, catalogFile),
      ],
      { input: catalogBytes, stdio: ["pipe", "ignore", "ignore"] },
    );
    fs.chmodSync(path.join(directory, catalogFile), 0o400);
    const catalogCipher = fs.readFileSync(path.join(directory, catalogFile));
    artifacts.push({
      file: catalogFile,
      format: "catalog-json",
      plaintextSha256: sha256(catalogBytes),
      ciphertextSha256: sha256(catalogCipher),
      ciphertextBytes: catalogCipher.length,
    });
    const sourceMajor = Number(
      execFileSync(binary(sourceBin, "pg_config"), ["--version"], {
        encoding: "utf8",
      }).match(/(\d+)/)![1],
    );
    const targetMajor = Number(
      execFileSync(binary(targetBin, "pg_config"), ["--version"], {
        encoding: "utf8",
      }).match(/(\d+)/)![1],
    );
    const receipt: ProductionRecoveryReceipt = {
      schema: OT_PRODUCTION_RECOVERY_SCHEMA,
      backupId: "0b4a298d-f955-4ff4-831e-e61767a45fe1",
      createdAt: new Date().toISOString(),
      backupStartedAt: new Date().toISOString(),
      backupCompletedAt: new Date().toISOString(),
      projectRef: "synthetic",
      markerInstanceId: "synthetic-marker",
      sourceServerMajor: sourceMajor as 17 | 18,
      encryption: {
        implementation: "gpg-symmetric-aes256",
        plaintextAtRest: false,
      },
      artifacts,
      catalogDigest: sha256(catalogBytes),
      roleMembershipPortability: {
        policy: OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
        sourceGrantors: [OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS[0]],
        normalizedGrantor: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
        managedMembershipCount: countNormalizedManagedMemberships(catalog),
      },
      extensionPortability: recoveryExtensionPortability(catalog),
      authenticator: "",
    };
    receipt.authenticator = authenticateReceipt(receipt, authenticationKey);
    const receiptPath = path.join(directory, "backup-receipt.json");
    fs.writeFileSync(receiptPath, canonicalJson(receipt), { mode: 0o600 });

    const sentinelPath = path.join(target.root, "cluster-sentinel.json");
    execFileSync(
      "node_modules/.bin/tsx",
      ["__tests__/helpers/run-neutral-recovery-ci-command.mts", "setup"],
      {
        cwd: process.cwd(),
        stdio: "ignore",
        env: {
          ...process.env,
          PATH: targetBin
            ? `${targetBin}:${process.env.PATH}`
            : process.env.PATH,
          OT_NEUTRAL_RECOVERY_REHEARSAL_DATABASE_URL: targetUrl,
          OT_NEUTRAL_RECOVERY_REHEARSAL_SUPERUSER: "restore_admin",
          OT_NEUTRAL_RECOVERY_REHEARSAL_SENTINEL: sentinelPath,
          OT_NEUTRAL_RECOVERY_REHEARSAL_RUNTIME_ROOT:
            process.env.OT_TEST_TARGET_PG_RUNTIME,
          OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY: authenticationKey,
        },
      },
    );

    const output = execFileSync(
      "node_modules/.bin/tsx",
      ["__tests__/helpers/run-neutral-recovery-ci-command.mts", "rehearse"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: targetBin
            ? `${targetBin}:${process.env.PATH}`
            : process.env.PATH,
          OT_NEUTRAL_PRODUCTION_RECOVERY_RECEIPT: receiptPath,
          OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE: passphrase,
          OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY: authenticationKey,
          OT_NEUTRAL_RECOVERY_REHEARSAL_SENTINEL: sentinelPath,
          OT_NEUTRAL_RECOVERY_REHEARSAL_DATABASE_URL: targetUrl,
          OT_NEUTRAL_RECOVERY_REHEARSAL_RUNTIME_ROOT:
            process.env.OT_TEST_TARGET_PG_RUNTIME,
        },
      },
    );
    expect(output).toMatch(
      new RegExp(
        `PASS.*target_pg=${targetMajor}.*catalog=verified.*artifacts=verified`,
      ),
    );
    expect(
      fs.existsSync(
        path.join(directory, `restore-rehearsal-pg${targetMajor}.json`),
      ),
    ).toBe(true);
    const restoreReceipt = JSON.parse(
      fs.readFileSync(
        path.join(directory, `restore-rehearsal-pg${targetMajor}.json`),
        "utf8",
      ),
    );
    expect(
      restoreReceipt.roleMembershipPortability.pristineTargetCount,
    ).toBeGreaterThan(0);
    const restored = new Client({ connectionString: targetUrl });
    await restored.connect();
    expect(
      (
        await restored.query(
          "select value from public.recovery_fixture where id='one'",
        )
      ).rows[0]!.value,
    ).toBe("unchanged");
    expect(
      (
        await restored.query(
          `select id::text, name, description, secret, key_id::text,
                  encode(nonce,'hex') nonce_hex,
                  to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') created_at,
                  to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') updated_at
           from vault.secrets order by id`,
        )
      ).rows,
    ).toEqual(sourceVaultRows);
    expect(
      (
        await restored.query(
          "select decrypted_secret from vault.decrypted_secrets where id=$1",
          [vaultSecretId],
        )
      ).rows[0]!.decrypted_secret,
    ).toBeNull();
    expect(
      (
        await restored.query(`
          select grantor.rolname grantor_role, m.admin_option, m.inherit_option, m.set_option
          from pg_auth_members m
          join pg_roles granted on granted.oid=m.roleid
          join pg_roles member on member.oid=m.member
          join pg_roles grantor on grantor.oid=m.grantor
          where granted.rolname='anon' and member.rolname='authenticated'
        `)
      ).rows,
    ).toEqual([
      {
        grantor_role: "restore_admin",
        admin_option: false,
        inherit_option: true,
        set_option: false,
      },
    ]);
    expect(
      (
        await restored.query(`
          select grantor.rolname grantor_role, m.admin_option, m.inherit_option, m.set_option
          from pg_auth_members m
          join pg_roles granted on granted.oid=m.roleid
          join pg_roles member on member.oid=m.member
          join pg_roles grantor on grantor.oid=m.grantor
          where granted.rolname='anon' and member.rolname='service_role'
        `)
      ).rows,
    ).toEqual([
      {
        grantor_role: "portable_admin",
        admin_option: false,
        inherit_option: false,
        set_option: true,
      },
    ]);
    await restored.end();

    // A replacement listener can appear after the preliminary Node inspection.
    // The definitive guard and all restore SQL share one psql connection, so
    // the replacement must be refused before any object lands there.
    const guarded = cluster("swap_admin", targetBin);
    const swapDatabase = "ot_neutral_recovery_rehearsal_swap";
    execFileSync(binary(targetBin, "createdb"), [
      "--host=127.0.0.1",
      `--port=${guarded.port}`,
      "--username=swap_admin",
      swapDatabase,
    ]);
    const swapUrl = `postgresql://swap_admin@127.0.0.1:${guarded.port}/${swapDatabase}`;
    const swapSentinel = path.join(guarded.root, "swap-sentinel.json");
    execFileSync(
      "node_modules/.bin/tsx",
      ["__tests__/helpers/run-neutral-recovery-ci-command.mts", "setup"],
      {
        cwd: process.cwd(),
        stdio: "ignore",
        env: {
          ...process.env,
          PATH: targetBin
            ? `${targetBin}:${process.env.PATH}`
            : process.env.PATH,
          OT_NEUTRAL_RECOVERY_REHEARSAL_DATABASE_URL: swapUrl,
          OT_NEUTRAL_RECOVERY_REHEARSAL_SUPERUSER: "swap_admin",
          OT_NEUTRAL_RECOVERY_REHEARSAL_SENTINEL: swapSentinel,
          OT_NEUTRAL_RECOVERY_REHEARSAL_RUNTIME_ROOT:
            process.env.OT_TEST_TARGET_PG_RUNTIME,
          OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY: authenticationKey,
        },
      },
    );
    const hook = path.join(guarded.root, "listener-swap");
    const rehearsal = spawn(
      "node_modules/.bin/tsx",
      ["__tests__/helpers/run-neutral-recovery-ci-command.mts", "rehearse"],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          PATH: targetBin
            ? `${targetBin}:${process.env.PATH}`
            : process.env.PATH,
          OT_TEST_RECOVERY_AFTER_NODE_VALIDATION_HOOK: hook,
          OT_NEUTRAL_PRODUCTION_RECOVERY_RECEIPT: receiptPath,
          OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE: passphrase,
          OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY: authenticationKey,
          OT_NEUTRAL_RECOVERY_REHEARSAL_SENTINEL: swapSentinel,
          OT_NEUTRAL_RECOVERY_REHEARSAL_DATABASE_URL: swapUrl,
          OT_NEUTRAL_RECOVERY_REHEARSAL_RUNTIME_ROOT:
            process.env.OT_TEST_TARGET_PG_RUNTIME,
        },
      },
    );
    let rehearsalErrors = "";
    let rehearsalOutput = "";
    rehearsal.stdout!.setEncoding("utf8");
    rehearsal.stdout!.on("data", (chunk) => (rehearsalOutput += chunk));
    rehearsal.stderr!.setEncoding("utf8");
    rehearsal.stderr!.on("data", (chunk) => (rehearsalErrors += chunk));
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(`${hook}.ready`)) {
      if (Date.now() > deadline)
        throw new Error("listener swap hook was not reached");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    execFileSync(
      binary(targetBin, "pg_ctl"),
      ["-D", guarded.data, "-m", "fast", "-w", "stop"],
      { stdio: "ignore" },
    );
    const attacker = cluster("swap_admin", targetBin, guarded.port);
    execFileSync(binary(targetBin, "createdb"), [
      "--host=127.0.0.1",
      `--port=${attacker.port}`,
      "--username=swap_admin",
      swapDatabase,
    ]);
    fs.writeFileSync(`${hook}.continue`, "continue", { mode: 0o600 });
    const refusalStartedAt = Date.now();
    let refusalTimer: NodeJS.Timeout | undefined;
    const boundedRefusal = new Promise<never>((_resolve, reject) => {
      refusalTimer = setTimeout(() => {
        rehearsal.kill("SIGKILL");
        reject(
          new Error(
            "backpressured sentinel refusal did not terminate within 10 seconds",
          ),
        );
      }, 10_000);
    });
    const [swapCode, swapSignal] = (await Promise.race([
      once(rehearsal, "close"),
      boundedRefusal,
    ]).finally(() => {
      if (refusalTimer) clearTimeout(refusalTimer);
    })) as [number | null, NodeJS.Signals | null];
    expect(Date.now() - refusalStartedAt).toBeLessThan(10_000);
    if (swapCode === 0 && swapSignal === null)
      throw new Error(
        `listener swap unexpectedly succeeded: ${rehearsalOutput} ${rehearsalErrors}`,
      );
    const attackerClient = new Client({ connectionString: swapUrl });
    await attackerClient.connect();
    expect(
      (
        await attackerClient.query(
          "select to_regclass('public.recovery_fixture') value",
        )
      ).rows[0]!.value,
    ).toBeNull();
    expect(
      (
        await attackerClient.query(
          "select to_regclass('public.recovery_backpressure') value",
        )
      ).rows[0]!.value,
    ).toBeNull();
    await attackerClient.end();
  }, 180_000);

  test("setup refuses a merely empty database on a cluster with a valuable role", async () => {
    const targetBin = process.env.OT_TEST_TARGET_PG_BIN;
    const target = cluster("restore_admin_refusal", targetBin);
    const targetDatabase = "ot_neutral_recovery_rehearsal_refusal";
    execFileSync(
      binary(targetBin, "createdb"),
      [
        "--host=127.0.0.1",
        `--port=${target.port}`,
        "--username=restore_admin_refusal",
        targetDatabase,
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      binary(targetBin, "psql"),
      [
        "--host=127.0.0.1",
        `--port=${target.port}`,
        "--username=restore_admin_refusal",
        "--dbname=postgres",
        "--command=create role valuable_existing_role login",
      ],
      { stdio: "ignore" },
    );
    expect(() =>
      execFileSync(
        "node_modules/.bin/tsx",
        ["__tests__/helpers/run-neutral-recovery-ci-command.mts", "setup"],
        {
          cwd: process.cwd(),
          stdio: "pipe",
          env: {
            ...process.env,
            PATH: targetBin
              ? `${targetBin}:${process.env.PATH}`
              : process.env.PATH,
            OT_NEUTRAL_RECOVERY_REHEARSAL_DATABASE_URL: `postgresql://restore_admin_refusal@127.0.0.1:${target.port}/${targetDatabase}`,
            OT_NEUTRAL_RECOVERY_REHEARSAL_SUPERUSER: "restore_admin_refusal",
            OT_NEUTRAL_RECOVERY_REHEARSAL_SENTINEL: path.join(
              target.root,
              "sentinel.json",
            ),
            OT_NEUTRAL_RECOVERY_REHEARSAL_RUNTIME_ROOT:
              process.env.OT_TEST_TARGET_PG_RUNTIME,
            OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY: authenticationKey,
          },
        },
      ),
    ).toThrow();
  }, 180_000);
});
