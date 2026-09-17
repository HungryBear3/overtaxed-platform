/** @jest-environment node */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OT_PRODUCTION_RECOVERY_RECEIPT_VAR,
  OT_PRODUCTION_RECOVERY_SCHEMA,
  OT_PRODUCTION_RESTORE_SCHEMA,
  authenticateReceipt,
  assertFreshRehearsalSentinelTimestamp,
  canonicalJson,
  sha256,
  type ProductionRecoveryReceipt,
} from "@/lib/fulfillment/neutral-production-recovery";
import {
  assertProductionRecoveryGate,
  materializePrivateCopy,
  readProtectedFile,
} from "@/scripts/neutral-production-recovery-gate";
import { resolveRecoveryTarget } from "@/scripts/neutral-recovery-target";
import { withRecoveryDirectory } from "@/lib/fulfillment/neutral-recovery-directory";

const PROJECT = "kdvjiijzgflumgkndxsl";
const INSTANCE = "6a5c0f2e-3b1d-4e7a-9c88-2f4b6d0a1e33";
const AUTH = "unit-authentication-key-at-least-thirty-two-bytes";
const PASSPHRASE = "unit-recovery-passphrase-at-least-24";

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-gate-"));
  fs.chmodSync(directory, 0o700);
  const formats = [
    ["database.dump.gpg", "postgres-custom"],
    ["roles.sql.gpg", "postgres-roles-sql"],
    ["catalog.json.gpg", "catalog-json"],
  ] as const;
  const receipt: ProductionRecoveryReceipt = {
    schema: OT_PRODUCTION_RECOVERY_SCHEMA,
    backupId: "b8a7fd53-f611-45d6-bad8-690a277647cb",
    createdAt: "2026-09-17T18:00:00.000Z",
    backupStartedAt: "2026-09-17T18:00:00.000Z",
    backupCompletedAt: "2026-09-17T18:05:00.000Z",
    projectRef: PROJECT,
    markerInstanceId: INSTANCE,
    sourceServerMajor: 17,
    encryption: {
      implementation: "gpg-symmetric-aes256",
      plaintextAtRest: false,
    },
    artifacts: formats.map(([file, format], index) => {
      const plain = Buffer.from(`plain-${index}`);
      const absolute = path.join(directory, file);
      execFileSync(
        "gpg",
        [
          "--batch",
          "--yes",
          "--pinentry-mode",
          "loopback",
          "--passphrase",
          PASSPHRASE,
          "--symmetric",
          "--cipher-algo",
          "AES256",
          "--s2k-mode",
          "3",
          "--s2k-digest-algo",
          "SHA512",
          "--s2k-count",
          "65011712",
          "--output",
          absolute,
        ],
        { input: plain, stdio: ["pipe", "ignore", "ignore"] },
      );
      fs.chmodSync(absolute, 0o600);
      const cipher = fs.readFileSync(absolute);
      return {
        file,
        format,
        plaintextSha256: sha256(plain),
        ciphertextSha256: sha256(cipher),
        ciphertextBytes: cipher.length,
      };
    }),
    catalogDigest: sha256("catalog"),
    authenticator: "",
  };
  receipt.authenticator = authenticateReceipt(receipt, AUTH);
  const receiptPath = path.join(directory, "backup-receipt.json");
  fs.writeFileSync(receiptPath, canonicalJson(receipt), { mode: 0o600 });
  const receiptDigest = sha256(fs.readFileSync(receiptPath));
  for (const major of [17, 18] as const) {
    const rehearsal = {
      schema: OT_PRODUCTION_RESTORE_SCHEMA,
      backupId: receipt.backupId,
      backupReceiptSha256: receiptDigest,
      targetServerMajor: major,
      restoredAt: "2026-09-17T18:10:00.000Z",
      artifactPlaintextSha256: Object.fromEntries(
        receipt.artifacts.map((artifact) => [
          artifact.file,
          artifact.plaintextSha256,
        ]),
      ),
      sourceCatalogDigest: receipt.catalogDigest,
      restoredCatalogDigest: receipt.catalogDigest,
      verified: true as const,
      clusterSystemIdentifier: `system-${major}`,
      clusterSentinelNonce: `nonce-${major}`,
      authenticator: "",
    };
    rehearsal.authenticator = authenticateReceipt(rehearsal, AUTH);
    fs.writeFileSync(
      path.join(directory, `restore-rehearsal-pg${major}.json`),
      canonicalJson(rehearsal),
      { mode: 0o600 },
    );
  }
  return { directory, receipt, receiptPath };
}

const envFor = (receiptPath: string) => ({
  [OT_PRODUCTION_RECOVERY_RECEIPT_VAR]: receiptPath,
  OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY: AUTH,
  OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE: PASSPHRASE,
});

describe("Production no-PITR recovery gate", () => {
  test("accepts authenticated, decryptable evidence with both restore proofs", async () => {
    const value = fixture();
    try {
      await expect(
        assertProductionRecoveryGate({
          env: envFor(value.receiptPath),
          projectRef: PROJECT,
          markerInstanceId: INSTANCE,
          now: new Date("2026-09-17T18:30:00Z"),
        }),
      ).resolves.toMatchObject({ backupId: value.receipt.backupId });
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test("rejects forged receipt fields even when attacker recomputes plain SHA-256 fields", async () => {
    const value = fixture();
    try {
      const forged = JSON.parse(fs.readFileSync(value.receiptPath, "utf8"));
      forged.markerInstanceId = "attacker-marker";
      fs.writeFileSync(value.receiptPath, canonicalJson(forged), {
        mode: 0o600,
      });
      await expect(
        assertProductionRecoveryGate({
          env: envFor(value.receiptPath),
          projectRef: PROJECT,
          markerInstanceId: "attacker-marker",
          now: new Date("2026-09-17T18:30:00Z"),
        }),
      ).rejects.toThrow(/authentication failed/);
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test("rejects wrong passphrase, ciphertext tamper, stale replay, and missing matrix proof", async () => {
    for (const mutation of [
      "passphrase",
      "cipher",
      "stale",
      "matrix",
    ] as const) {
      const value = fixture();
      try {
        const env = envFor(value.receiptPath);
        if (mutation === "passphrase")
          env.OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE =
            "wrong-passphrase-still-long-enough";
        if (mutation === "cipher")
          fs.appendFileSync(
            path.join(value.directory, "database.dump.gpg"),
            "x",
          );
        if (mutation === "matrix")
          fs.rmSync(path.join(value.directory, "restore-rehearsal-pg18.json"));
        const now =
          mutation === "stale"
            ? new Date("2026-09-17T19:00:01Z")
            : new Date("2026-09-17T18:30:00Z");
        await expect(
          assertProductionRecoveryGate({
            env,
            projectRef: PROJECT,
            markerInstanceId: INSTANCE,
            now,
          }),
        ).rejects.toThrow();
      } finally {
        fs.rmSync(value.directory, { recursive: true, force: true });
      }
    }
  });

  test("canonical receipts are stable across insertion order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
    );
  });

  test("rejects invalid, future, and stale rehearsal sentinel timestamps", () => {
    const now = new Date("2026-09-17T18:30:00.000Z");
    expect(() =>
      assertFreshRehearsalSentinelTimestamp("not-a-date", now),
    ).toThrow(/invalid, future, or stale/);
    expect(() =>
      assertFreshRehearsalSentinelTimestamp("2026-09-17T18:30:00.001Z", now),
    ).toThrow(/invalid, future, or stale/);
    expect(() =>
      assertFreshRehearsalSentinelTimestamp("2026-09-17T18:14:59.999Z", now),
    ).toThrow(/invalid, future, or stale/);
  });

  test.each([
    "?host=evil.example",
    "?host=%2Ftmp%2Fevil.sock",
    "?%68ost=evil.example",
    "?hostaddr=203.0.113.7",
    "?port=6543",
    "?dbname=valuable",
    "?user=attacker",
    "?password=attacker",
    "?sslmode=require",
    "?sslcert=%2Ftmp%2Fevil",
  ])("rejects ambiguous target override %s", async (suffix) => {
    await expect(
      resolveRecoveryTarget(
        `postgresql://temporary@127.0.0.1:5432/ot_neutral_recovery_rehearsal_unit${suffix}`,
      ),
    ).rejects.toThrow(/unambiguous/);
  });

  test("uses one canonical target for validation, Node, and libpq", async () => {
    const target = await resolveRecoveryTarget(
      "postgresql://temporary:secret@127.0.0.1:5544/ot_neutral_recovery_rehearsal_unit",
    );
    expect(target.clientConfig).toMatchObject({
      host: target.host,
      port: target.port,
      database: target.database,
      user: target.user,
      password: target.password,
      ssl: false,
    });
    expect(target.pgEnvironment).toMatchObject({
      PGHOST: target.host,
      PGPORT: String(target.port),
      PGDATABASE: target.database,
      PGUSER: target.user,
      PGPASSWORD: target.password,
      PGSSLMODE: "disable",
    });
  });

  test("pins the validated resolver answer and never reconnects by hostname", async () => {
    let calls = 0;
    const target = await resolveRecoveryTarget(
      "postgresql://temporary@localhost:5544/ot_neutral_recovery_rehearsal_rebind",
      async () => {
        calls += 1;
        return [{ address: "127.0.0.9", family: 4 }];
      },
    );
    expect(calls).toBe(1);
    expect(target).toMatchObject({ host: "127.0.0.9", family: 4 });
    expect(target.clientConfig.host).toBe("127.0.0.9");
    expect(target.pgEnvironment.PGHOST).toBe("127.0.0.9");
  });

  test.each([
    [
      "postgresql://temporary@127.0.0.1:5544/ot_neutral_recovery_rehearsal_v4",
      "127.0.0.1",
      4,
    ],
    [
      "postgresql://temporary@[::1]:5544/ot_neutral_recovery_rehearsal_v6",
      "::1",
      6,
    ],
  ] as const)(
    "normalizes and pins literal target %s",
    async (url, address, family) => {
      const target = await resolveRecoveryTarget(url);
      expect(target).toMatchObject({ host: address, family });
      expect(target.clientConfig.host).toBe(address);
      expect(target.pgEnvironment.PGHOST).toBe(address);
    },
  );

  test("private verified bytes survive pathname swap and symlinks are refused", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ot-recovery-race-"),
    );
    fs.chmodSync(directory, 0o700);
    const original = path.join(directory, "artifact.gpg");
    const replacement = path.join(directory, "replacement.gpg");
    fs.writeFileSync(original, "verified", { mode: 0o600 });
    fs.writeFileSync(replacement, "attacker", { mode: 0o600 });
    const privateCopy = materializePrivateCopy(readProtectedFile(original));
    try {
      fs.renameSync(replacement, original);
      expect(fs.readFileSync(privateCopy.file, "utf8")).toBe("verified");
      const link = path.join(directory, "link.gpg");
      fs.symlinkSync(original, link);
      expect(() => readProtectedFile(link)).toThrow(/unsafe/);
      const hardlink = path.join(directory, "hardlink.gpg");
      fs.linkSync(original, hardlink);
      expect(() => readProtectedFile(original)).toThrow(
        /permissions are unsafe/,
      );
    } finally {
      privateCopy.cleanup();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects a rename swap between pre-open stat and opened-fd identity", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ot-recovery-open-race-"),
    );
    fs.chmodSync(directory, 0o700);
    const artifact = path.join(directory, "artifact.gpg");
    const replacement = path.join(directory, "replacement.gpg");
    fs.writeFileSync(artifact, "verified", { mode: 0o600 });
    fs.writeFileSync(replacement, "attacker", { mode: 0o600 });
    try {
      expect(() =>
        readProtectedFile(artifact, () => {
          fs.renameSync(replacement, artifact);
        }),
      ).toThrow(/identity changed/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("opens the child beneath the held parent across swap-to-attacker and swap-back", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "ot-recovery-parent-race-"),
    );
    fs.chmodSync(root, 0o700);
    const directory = path.join(root, "evidence");
    const moved = path.join(root, "held-original");
    const attacker = path.join(root, "attacker");
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.mkdirSync(attacker, { mode: 0o700 });
    const artifact = path.join(directory, "artifact.gpg");
    const attackerArtifact = path.join(attacker, "artifact.gpg");
    fs.writeFileSync(artifact, "verified", { mode: 0o600 });
    fs.writeFileSync(attackerArtifact, "attacker", { mode: 0o600 });
    try {
      const bytes = readProtectedFile(artifact, () => {
        fs.renameSync(directory, moved);
        fs.renameSync(attacker, directory);
      });
      fs.renameSync(directory, attacker);
      fs.renameSync(moved, directory);
      expect(bytes.toString("utf8")).toBe("verified");
      expect(fs.readFileSync(artifact, "utf8")).toBe("verified");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects authenticated invalid and future restore timestamps", async () => {
    for (const restoredAt of ["not-a-date", "2026-09-17T18:30:00.001Z"]) {
      const value = fixture();
      try {
        const proofPath = path.join(
          value.directory,
          "restore-rehearsal-pg17.json",
        );
        const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
        proof.restoredAt = restoredAt;
        proof.authenticator = authenticateReceipt(proof, AUTH);
        fs.writeFileSync(proofPath, canonicalJson(proof), { mode: 0o600 });
        await expect(
          assertProductionRecoveryGate({
            env: envFor(value.receiptPath),
            projectRef: PROJECT,
            markerInstanceId: INSTANCE,
            now: new Date("2026-09-17T18:30:00Z"),
          }),
        ).rejects.toThrow(/restore time is out of bounds/);
      } finally {
        fs.rmSync(value.directory, { recursive: true, force: true });
      }
    }
  });

  test("rejects capture duration beyond the hard 60-minute bound", async () => {
    const value = fixture();
    try {
      const delayed = JSON.parse(fs.readFileSync(value.receiptPath, "utf8"));
      delayed.backupCompletedAt = "2026-09-17T19:00:01.000Z";
      delayed.createdAt = delayed.backupCompletedAt;
      delayed.authenticator = authenticateReceipt(delayed, AUTH);
      fs.writeFileSync(value.receiptPath, canonicalJson(delayed), {
        mode: 0o600,
      });
      await expect(
        assertProductionRecoveryGate({
          env: envFor(value.receiptPath),
          projectRef: PROJECT,
          markerInstanceId: INSTANCE,
          now: new Date("2026-09-17T19:00:01Z"),
        }),
      ).rejects.toThrow(/capture window|duration/);
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test("removes the recovery directory when initial connection work fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-root-"));
    fs.chmodSync(root, 0o700);
    try {
      await expect(
        withRecoveryDirectory(root, async () => {
          throw new Error("synthetic initial connection failure");
        }),
      ).rejects.toThrow(/connection failure/);
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
