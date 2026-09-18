/** @jest-environment node */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OT_PRODUCTION_RECOVERY_RECEIPT_VAR,
  OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
  OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
  OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
  OT_PRODUCTION_RECOVERY_SCHEMA,
  OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS,
  OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_MEMBERS,
  OT_PRODUCTION_RECOVERY_CATALOG_SQL,
  OT_PRODUCTION_RECOVERY_GPG_PATH_VAR,
  OT_PRODUCTION_NATIVE_VAULT_PROOF_VAR,
  OT_PRODUCTION_NATIVE_VAULT_PROOF_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_TRANSCRIPT_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
  OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256,
  OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256,
  OT_PRODUCTION_NATIVE_VAULT_APPROVED_PLATFORM_RECEIPT_SHA256,
  OT_PRODUCTION_RECOVERY_CANDIDATE_COMMIT_VAR,
  OT_PRODUCTION_RECOVERY_CANDIDATE_MANIFEST_VAR,
  OT_PRODUCTION_RESTORE_SCHEMA,
  adaptManagedRoleMembershipGrantors,
  authenticateReceipt,
  assertFreshRehearsalSentinelTimestamp,
  assertManagedRoleMembershipPortabilityCounts,
  assertRecoveryReceipt,
  canonicalJson,
  recoveryExtensionPortability,
  sha256,
  type ProductionRecoveryReceipt,
} from "@/lib/fulfillment/neutral-production-recovery";
import {
  adaptRecoveryExtensionSql,
  expectedExtensionSqlPortabilityProof,
  planRecoveryArchiveToc,
  stockExtensionOwnersFromCatalog,
} from "@/lib/fulfillment/neutral-production-extension-portability";
import {
  assertManagedExtensionFixtureSource,
  assertManagedExtensionFixtureInstalled,
  prepareManagedExtensionRuntime,
} from "@/scripts/neutral-production-extension-fixture-files";
import {
  assertApprovedPlatformReceiptPins,
  assertProductionRecoveryGate as assertProductionRecoveryGateRaw,
  materializePrivateCopy,
  verifyPrivateCopy,
  readProtectedFile,
} from "@/scripts/neutral-production-recovery-gate";
import { assertProductionRecoveryEvidenceForTests } from "@/test-support/neutral-production-recovery-gate";
import { resolveRecoveryTarget } from "@/scripts/neutral-recovery-target";
import {
  alignRestoredCatalogAclOrdering,
  planTemporaryPostgresOwnerPromotion,
} from "@/scripts/rehearse-neutral-production-recovery";
import { withRecoveryDirectory } from "@/lib/fulfillment/neutral-recovery-directory";
import {
  assertTrustedExecutable,
  resolveTrustedExecutable,
  unitTestTrustedExecutablePolicy,
} from "@/scripts/trusted-executable";

const PROJECT = "kdvjiijzgflumgkndxsl";
const INSTANCE = "6a5c0f2e-3b1d-4e7a-9c88-2f4b6d0a1e33";
const AUTH = "unit-authentication-key-at-least-thirty-two-bytes";
const PASSPHRASE = "unit-recovery-passphrase-at-least-24";
const CANDIDATE_COMMIT = "a".repeat(40);
const CANDIDATE_MANIFEST = sha256("unit-candidate-manifest");
const TEST_EXECUTABLE_POLICY = unitTestTrustedExecutablePolicy(
  process.getuid!(),
);

function fixture() {
  const directory = fs.mkdtempSync(
    path.join(process.cwd(), ".ot-recovery-gate-"),
  );
  fs.chmodSync(directory, 0o700);
  const gpgSource = execFileSync("/usr/bin/which", ["gpg"], {
    encoding: "utf8",
  }).trim();
  const trustedGpg = path.join(directory, "trusted-gpg");
  fs.copyFileSync(fs.realpathSync(gpgSource), trustedGpg);
  fs.chmodSync(trustedGpg, 0o500);
  const rolesPlaintext = Buffer.from(
    "GRANT anon TO authenticator WITH INHERIT TRUE GRANTED BY supabase_admin;\n",
  );
  const catalogSnapshot = {
    extensions: OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS.map(
      ({ portability: _ignored, ...extension }) => ({
        ...extension,
        owner_role:
          extension.extname === "supabase_vault"
            ? OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR
            : "postgres",
      }),
    ),
    managed_extension_members:
      OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_MEMBERS.map((row) => ({
        extname: "supabase_vault",
        ...row,
      })),
    managed_extension_schema: [
      { owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
    ],
    managed_extension_relations: [
      { owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
    ],
    managed_extension_columns: [],
    managed_extension_functions: [
      "crypto-decrypt",
      "crypto-encrypt",
      "crypto-noncegen",
      "create-secret",
      "update-secret",
    ].map((profile) => ({
      owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
      implementation_profile: `supabase-vault-v0.3.1:${profile}`,
    })),
    managed_extension_types: [
      { owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
    ],
    managed_extension_indexes: [],
    managed_extension_constraints: [],
    managed_extension_config: [],
    managed_extension_acls: [],
  };
  const catalogPlaintext = Buffer.from(canonicalJson(catalogSnapshot));
  const adaptedRoles = adaptManagedRoleMembershipGrantors(rolesPlaintext);
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
      const plain =
        format === "postgres-roles-sql"
          ? rolesPlaintext
          : format === "catalog-json"
            ? catalogPlaintext
            : Buffer.from(`plain-${index}`);
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
    catalogDigest: sha256(catalogPlaintext),
    roleMembershipPortability: {
      policy: OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
      sourceGrantors: [OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS[0]],
      normalizedGrantor: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
      managedMembershipCount: 1,
    },
    extensionPortability: recoveryExtensionPortability(catalogSnapshot),
    authenticator: "",
  };
  receipt.authenticator = authenticateReceipt(receipt, AUTH);
  const receiptPath = path.join(directory, "backup-receipt.json");
  fs.writeFileSync(receiptPath, canonicalJson(receipt), { mode: 0o600 });
  const receiptDigest = sha256(fs.readFileSync(receiptPath));
  const platformReceipts = (["darwin", "linux"] as const).map((platform) => {
    const sourceArchive = Buffer.from(`vault-source-${platform}`);
    const nativeLibrary = Buffer.from(`vault-native-library-${platform}`);
    const sourceArchiveFile = `vault-source-${platform}.tar`;
    const nativeLibraryFile = `supabase_vault-${platform}.bin`;
    const transcriptFile = `native-vault-transcript-${platform}.json`;
    fs.writeFileSync(path.join(directory, sourceArchiveFile), sourceArchive, {
      mode: 0o600,
    });
    fs.writeFileSync(path.join(directory, nativeLibraryFile), nativeLibrary, {
      mode: 0o600,
    });
    const transcript = {
      schema: OT_PRODUCTION_NATIVE_VAULT_TRANSCRIPT_SCHEMA,
      platform,
      backupId: receipt.backupId,
      backupReceiptSha256: receiptDigest,
      candidateCommit: CANDIDATE_COMMIT,
      candidateManifestSha256: CANDIDATE_MANIFEST,
      upstreamCommit: OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
      sourceArchiveSha256: sha256(sourceArchive),
      nativeLibrarySha256: sha256(nativeLibrary),
      nativeSourceCatalogSha256: sha256(`native-catalog-${platform}`),
      functionalSecretRoundTripSha256: sha256(`round-trip-${platform}`),
      operations: [
        "build",
        "install",
        "create_secret",
        "read_decrypted_secret",
        "update_secret",
        "read_updated_secret",
        "drop_secret",
      ],
      result: "PASS",
    };
    fs.writeFileSync(
      path.join(directory, transcriptFile),
      canonicalJson(transcript),
      { mode: 0o600 },
    );
    const platformReceipt = {
      schema: OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA,
      platform,
      backupId: receipt.backupId,
      backupReceiptSha256: receiptDigest,
      candidateCommit: CANDIDATE_COMMIT,
      candidateManifestSha256: CANDIDATE_MANIFEST,
      upstreamCommit: OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
      baseSqlSha256: OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256,
      upgradeSqlSha256: OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256,
      toolchain: {
        postgresVersion: "PostgreSQL 17.6",
        pgConfigSha256: sha256(`pg-config-${platform}`),
        compilerVersion: "unit-compiler 1.0",
        compilerSha256: sha256(`compiler-${platform}`),
        pgxsTreeSha256: sha256(`pgxs-${platform}`),
        dependencyHeaderTreeSha256: sha256(`sodium-headers-${platform}`),
        sodiumStaticLibrarySha256: sha256(`sodium-static-${platform}`),
      },
      evidence: {
        sourceArchive: {
          file: sourceArchiveFile,
          sha256: sha256(sourceArchive),
        },
        nativeLibrary: {
          file: nativeLibraryFile,
          sha256: sha256(nativeLibrary),
        },
        transcript: {
          file: transcriptFile,
          sha256: sha256(fs.readFileSync(path.join(directory, transcriptFile))),
        },
      },
      nativeSourceCatalogSha256: transcript.nativeSourceCatalogSha256,
      functionalSecretRoundTripSha256:
        transcript.functionalSecretRoundTripSha256,
      verifiedAt: "2026-09-17T18:09:00.000Z",
      authenticator: "",
    };
    platformReceipt.authenticator = authenticateReceipt(platformReceipt, AUTH);
    const file = `native-vault-platform-${platform}.json`;
    fs.writeFileSync(
      path.join(directory, file),
      canonicalJson(platformReceipt),
      {
        mode: 0o600,
      },
    );
    return {
      platform,
      file,
      sha256: sha256(fs.readFileSync(path.join(directory, file))),
    };
  });
  const nativeProof = {
    schema: OT_PRODUCTION_NATIVE_VAULT_PROOF_SCHEMA,
    backupId: receipt.backupId,
    backupReceiptSha256: receiptDigest,
    candidateCommit: CANDIDATE_COMMIT,
    candidateManifestSha256: CANDIDATE_MANIFEST,
    platformReceipts,
    authenticator: "",
  };
  nativeProof.authenticator = authenticateReceipt(nativeProof, AUTH);
  fs.writeFileSync(
    path.join(directory, "native-vault-proof.json"),
    canonicalJson(nativeProof),
    { mode: 0o600 },
  );
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
      roleMembershipPortability: {
        policy: OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
        authenticatedSourceCount: 1,
        pristineTargetCount: 0,
        adaptedStatementCount: 1,
        adaptedRolesSha256: sha256(adaptedRoles.bytes),
      },
      extensionPortability: {
        ...receipt.extensionPortability,
        ...expectedExtensionSqlPortabilityProof(),
        archiveTocSha256: sha256("unit-archive-toc"),
      },
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
  [OT_PRODUCTION_RECOVERY_GPG_PATH_VAR]: path.join(
    path.dirname(receiptPath),
    "trusted-gpg",
  ),
  [OT_PRODUCTION_NATIVE_VAULT_PROOF_VAR]: path.join(
    path.dirname(receiptPath),
    "native-vault-proof.json",
  ),
  [OT_PRODUCTION_RECOVERY_CANDIDATE_COMMIT_VAR]: CANDIDATE_COMMIT,
  [OT_PRODUCTION_RECOVERY_CANDIDATE_MANIFEST_VAR]: CANDIDATE_MANIFEST,
  OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY: AUTH,
  OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE: PASSPHRASE,
});

function testOnlyPolicyFor(receiptPath: string) {
  const proof = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(receiptPath), "native-vault-proof.json"),
      "utf8",
    ),
  );
  return {
    ownershipPolicy: TEST_EXECUTABLE_POLICY,
    approvedPlatformReceiptSha256: {
      darwin: proof.platformReceipts[0].sha256 as string,
      linux: proof.platformReceipts[1].sha256 as string,
    },
  };
}

/**
 * The Production gate itself is closed and unreachable from a unit process: it
 * requires a root-owned gpg binary and exact released platform-receipt pins.
 * These cases exercise the same lower-level proof validation through the
 * test-only boundary, which can relax gpg ownership and nothing else.
 */
function assertProductionRecoveryGate(
  input: Parameters<typeof assertProductionRecoveryGateRaw>[0],
) {
  return assertProductionRecoveryEvidenceForTests(input);
}

function rewriteAuthenticatedJson(
  file: string,
  mutate: (value: Record<string, any>) => void,
): void {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(value);
  value.authenticator = authenticateReceipt(value, AUTH);
  fs.writeFileSync(file, canonicalJson(value), { mode: 0o600 });
}

function rewritePlatformReceiptAndBundle(
  directory: string,
  platform: "darwin" | "linux",
  mutate: (value: Record<string, any>) => void,
): void {
  const receiptFile = path.join(
    directory,
    `native-vault-platform-${platform}.json`,
  );
  rewriteAuthenticatedJson(receiptFile, mutate);
  const proofFile = path.join(directory, "native-vault-proof.json");
  rewriteAuthenticatedJson(proofFile, (proof) => {
    const reference = proof.platformReceipts.find(
      (entry: { platform: string }) => entry.platform === platform,
    );
    reference.sha256 = sha256(fs.readFileSync(receiptFile));
  });
}

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

  test("the exported Production gate ignores caller-supplied policy and uses only release pins", async () => {
    const value = fixture();
    try {
      // Exactly the shape the gate used to honour: a replacement ownership
      // policy and replacement approved receipt hashes that match this
      // fixture's own proof.
      const smuggled = {
        env: envFor(value.receiptPath),
        projectRef: PROJECT,
        markerInstanceId: INSTANCE,
        now: new Date("2026-09-17T18:30:00Z"),
        testOnlyPolicy: testOnlyPolicyFor(value.receiptPath),
      };
      await expect(
        assertProductionRecoveryGateRaw(smuggled as never),
      ).rejects.toThrow();

      // The release pins are the only source the Production gate compares
      // against; caller-supplied substitutes remain impossible.
      expect(
        OT_PRODUCTION_NATIVE_VAULT_APPROVED_PLATFORM_RECEIPT_SHA256,
      ).toEqual({
        darwin:
          "284bcccb451fca0887e9a049178e8693596d5798057c405772390a988622b824",
        linux:
          "e0071ccbc8cd4e44763c525da67b2ed2396448a18606955ce833e86123ea9f7b",
      });

      const gateSource = fs.readFileSync(
        path.join(process.cwd(), "scripts/neutral-production-recovery-gate.ts"),
        "utf8",
      );
      const gate = gateSource.slice(
        gateSource.indexOf(
          "export async function assertProductionRecoveryGate(",
        ),
      );
      expect(gate).not.toContain("testOnly");
      expect(gate).not.toContain("ownershipPolicy");
      expect(gate).toContain("resolveTrustedExecutable(gpgPath)");

      // No production module accepts or forwards a replacement pin or policy.
      for (const directory of ["scripts", "lib"])
        for (const file of fs
          .readdirSync(path.join(process.cwd(), directory), {
            recursive: true,
            encoding: "utf8",
          })
          .filter((name) => name.endsWith(".ts"))) {
          const body = fs.readFileSync(
            path.join(process.cwd(), directory, file),
            "utf8",
          );
          expect(body).not.toContain("testOnlyPolicy");
          if (body.includes("approvedPlatformReceiptSha256"))
            expect(path.join(directory, file).replace(/\\/g, "/")).toBe(
              "scripts/neutral-production-recovery-gate.ts",
            );
        }
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test("rejects authentic fixture receipts that differ from the reviewed release pins", async () => {
    const value = fixture();
    try {
      // Authentic, fully authenticated fixture evidence still cannot substitute
      // for the exact separately reviewed receipt bytes pinned by the release.
      await expect(
        assertProductionRecoveryGate({
          env: envFor(value.receiptPath),
          projectRef: PROJECT,
          markerInstanceId: INSTANCE,
          now: new Date("2026-09-17T18:30:00Z"),
        }),
      ).resolves.toMatchObject({ backupId: value.receipt.backupId });
      const proof = JSON.parse(
        fs.readFileSync(
          path.join(value.directory, "native-vault-proof.json"),
          "utf8",
        ),
      );
      expect(() => assertApprovedPlatformReceiptPins(proof)).toThrow(
        /not pinned by the released candidate/,
      );

      const pinned = structuredClone(proof);
      pinned.platformReceipts[0].sha256 =
        OT_PRODUCTION_NATIVE_VAULT_APPROVED_PLATFORM_RECEIPT_SHA256.darwin;
      pinned.platformReceipts[1].sha256 =
        OT_PRODUCTION_NATIVE_VAULT_APPROVED_PLATFORM_RECEIPT_SHA256.linux;
      expect(() => assertApprovedPlatformReceiptPins(pinned)).not.toThrow();

      for (const index of [0, 1] as const) {
        const wrong = structuredClone(pinned);
        wrong.platformReceipts[index].sha256 = "0".repeat(64);
        expect(() => assertApprovedPlatformReceiptPins(wrong)).toThrow(
          /not pinned by the released candidate/,
        );
      }
      const entrypoint = fs.readFileSync(
        path.join(
          process.cwd(),
          "scripts/neutral-production-baseline-entrypoint.ts",
        ),
        "utf8",
      );
      expect(entrypoint).not.toContain("testOnlyPolicy");
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test("rejects mutually agreeing restore proofs that do not match independently adapted roles bytes", async () => {
    const value = fixture();
    try {
      for (const major of [17, 18] as const)
        rewriteAuthenticatedJson(
          path.join(value.directory, `restore-rehearsal-pg${major}.json`),
          (proof) => {
            proof.roleMembershipPortability.pristineTargetCount = 1;
            proof.roleMembershipPortability.adaptedStatementCount = 0;
            proof.roleMembershipPortability.adaptedRolesSha256 = sha256(
              "mutually-agreeing-forgery",
            );
          },
        );
      await expect(
        assertProductionRecoveryGate({
          env: envFor(value.receiptPath),
          projectRef: PROJECT,
          markerInstanceId: INSTANCE,
          now: new Date("2026-09-17T18:30:00Z"),
        }),
      ).rejects.toThrow(/portability proof is invalid/);
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test("rejects mutually agreeing extension proofs that do not match the independently decrypted catalog", async () => {
    const value = fixture();
    try {
      const forgedCatalogDigest = sha256("mutually-agreeing-extension-forgery");
      rewriteAuthenticatedJson(value.receiptPath, (receipt) => {
        receipt.extensionPortability.managedExtensionCatalogSha256 =
          forgedCatalogDigest;
      });
      const changedReceiptDigest = sha256(fs.readFileSync(value.receiptPath));
      for (const major of [17, 18] as const)
        rewriteAuthenticatedJson(
          path.join(value.directory, `restore-rehearsal-pg${major}.json`),
          (proof) => {
            proof.backupReceiptSha256 = changedReceiptDigest;
            proof.extensionPortability.managedExtensionCatalogSha256 =
              forgedCatalogDigest;
          },
        );
      await expect(
        assertProductionRecoveryGate({
          env: envFor(value.receiptPath),
          projectRef: PROJECT,
          markerInstanceId: INSTANCE,
          now: new Date("2026-09-17T18:30:00Z"),
        }),
      ).rejects.toThrow(/extension portability evidence is invalid/);
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test.each(["adapted-count", "adapted-digest"] as const)(
    "rejects PostgreSQL 18 portability evidence that differs from PostgreSQL 17: %s",
    async (mutation) => {
      const value = fixture();
      try {
        rewriteAuthenticatedJson(
          path.join(value.directory, "restore-rehearsal-pg18.json"),
          (proof) => {
            if (mutation === "adapted-count") {
              proof.roleMembershipPortability.pristineTargetCount = 1;
              proof.roleMembershipPortability.adaptedStatementCount = 0;
            } else {
              proof.roleMembershipPortability.adaptedRolesSha256 = "0".repeat(
                64,
              );
            }
          },
        );
        await expect(
          assertProductionRecoveryGate({
            env: envFor(value.receiptPath),
            projectRef: PROJECT,
            markerInstanceId: INSTANCE,
            now: new Date("2026-09-17T18:30:00Z"),
          }),
        ).rejects.toThrow(/portability proof is invalid/);
      } finally {
        fs.rmSync(value.directory, { recursive: true, force: true });
      }
    },
  );

  test.each(["missing", "tampered"] as const)(
    "rejects %s authenticated backup portability evidence",
    async (mutation) => {
      const value = fixture();
      try {
        rewriteAuthenticatedJson(value.receiptPath, (receipt) => {
          if (mutation === "missing") delete receipt.roleMembershipPortability;
          else receipt.roleMembershipPortability.managedMembershipCount = 2;
        });
        if (mutation === "tampered") {
          const changedReceiptDigest = sha256(
            fs.readFileSync(value.receiptPath),
          );
          for (const major of [17, 18] as const)
            rewriteAuthenticatedJson(
              path.join(value.directory, `restore-rehearsal-pg${major}.json`),
              (proof) => {
                proof.backupReceiptSha256 = changedReceiptDigest;
              },
            );
        }
        await expect(
          assertProductionRecoveryGate({
            env: envFor(value.receiptPath),
            projectRef: PROJECT,
            markerInstanceId: INSTANCE,
            now: new Date("2026-09-17T18:30:00Z"),
          }),
        ).rejects.toThrow(/portability|native Vault/);
      } finally {
        fs.rmSync(value.directory, { recursive: true, force: true });
      }
    },
  );

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
      "portability",
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
        if (mutation === "portability") {
          const proofPath = path.join(
            value.directory,
            "restore-rehearsal-pg17.json",
          );
          const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
          proof.roleMembershipPortability.adaptedStatementCount = 2;
          proof.authenticator = authenticateReceipt(proof, AUTH);
          fs.writeFileSync(proofPath, canonicalJson(proof), { mode: 0o600 });
        }
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

  test("requires an authenticated native Vault proof before apply", async () => {
    const value = fixture();
    try {
      const env: Record<string, string | undefined> = envFor(value.receiptPath);
      delete env[OT_PRODUCTION_NATIVE_VAULT_PROOF_VAR];
      await expect(
        assertProductionRecoveryGate({
          env,
          projectRef: PROJECT,
          markerInstanceId: INSTANCE,
          now: new Date("2026-09-17T18:30:00Z"),
        }),
      ).rejects.toThrow(/native Vault proof is required/);
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test.each([
    "missing-receipt",
    "fabricated-artifact",
    "cross-backup",
    "cross-candidate",
    "basename-collision",
    "case-variant-alias",
    "missing-sodium-hash",
    "missing-pgxs-hash",
  ] as const)("rejects %s native Vault platform evidence", async (mutation) => {
    const value = fixture();
    try {
      if (mutation === "missing-receipt")
        fs.rmSync(
          path.join(value.directory, "native-vault-platform-linux.json"),
        );
      if (mutation === "fabricated-artifact")
        fs.writeFileSync(
          path.join(value.directory, "supabase_vault-darwin.bin"),
          "fabricated-native-library",
        );
      if (mutation === "cross-backup")
        rewritePlatformReceiptAndBundle(
          value.directory,
          "darwin",
          (receipt) => {
            receipt.backupId = "e4b321d5-bd02-4b76-8462-7aeb802f57c0";
          },
        );
      if (mutation === "cross-candidate")
        rewritePlatformReceiptAndBundle(value.directory, "linux", (receipt) => {
          receipt.candidateCommit = "b".repeat(40);
        });
      if (mutation === "basename-collision")
        rewritePlatformReceiptAndBundle(value.directory, "linux", (receipt) => {
          receipt.evidence.nativeLibrary.file = "supabase_vault-darwin.bin";
        });
      if (mutation === "case-variant-alias")
        rewritePlatformReceiptAndBundle(
          value.directory,
          "darwin",
          (receipt) => {
            receipt.evidence.nativeLibrary.file = "VAULT-SOURCE-DARWIN.TAR";
          },
        );
      if (mutation === "missing-sodium-hash")
        rewritePlatformReceiptAndBundle(value.directory, "linux", (receipt) => {
          delete receipt.toolchain.sodiumStaticLibrarySha256;
        });
      if (mutation === "missing-pgxs-hash")
        rewritePlatformReceiptAndBundle(value.directory, "linux", (receipt) => {
          delete receipt.toolchain.pgxsTreeSha256;
        });
      await expect(
        assertProductionRecoveryGate({
          env: envFor(value.receiptPath),
          projectRef: PROJECT,
          markerInstanceId: INSTANCE,
          now: new Date("2026-09-17T18:30:00Z"),
        }),
      ).rejects.toThrow(
        mutation === "case-variant-alias"
          ? /basename is colliding/
          : /native Vault|evidence|ENOENT/i,
      );
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test("rejects unprotected or changed secret-bearing executables", () => {
    const value = fixture();
    const unsafe = fs.mkdtempSync(path.join("/tmp", "ot-unsafe-gpg-"));
    try {
      expect(() =>
        resolveTrustedExecutable(path.join(value.directory, "trusted-gpg")),
      ).toThrow(/unsafe/);
      expect(() =>
        resolveTrustedExecutable(path.join(value.directory, "trusted-gpg"), {
          ownershipPolicy: TEST_EXECUTABLE_POLICY,
        }),
      ).not.toThrow();
      const executable = resolveTrustedExecutable(
        path.join(value.directory, "trusted-gpg"),
        { ownershipPolicy: TEST_EXECUTABLE_POLICY },
      );
      fs.chmodSync(executable.path, 0o700);
      fs.appendFileSync(executable.path, "changed");
      fs.chmodSync(executable.path, 0o500);
      expect(() => assertTrustedExecutable(executable)).toThrow(/changed/);

      const unsafeExecutable = path.join(unsafe, "gpg");
      fs.writeFileSync(unsafeExecutable, "#!/bin/sh\nexit 0\n", {
        mode: 0o500,
      });
      expect(() => resolveTrustedExecutable(unsafeExecutable)).toThrow(
        /ancestry is unsafe/,
      );
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
      fs.rmSync(unsafe, { recursive: true, force: true });
    }
  });

  test("restores stock extensions as postgres while leaving managed extensions under the managed owner", () => {
    const source = [
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;",
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;',
      "",
    ].join("\n");
    const adapted = adaptRecoveryExtensionSql(source).sql;
    expect(adapted).toContain(
      "SET ROLE postgres;\nCREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions VERSION '1.3';\nRESET ROLE;",
    );
    expect(adapted).toContain(
      "CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault VERSION '0.3.1';",
    );
    expect(adapted).not.toContain(
      "SET ROLE postgres;\nCREATE EXTENSION IF NOT EXISTS supabase_vault",
    );
  });

  test("restores stock extensions under authenticated source owners", () => {
    const owners = stockExtensionOwnersFromCatalog({
      roles: [{ rolname: "supabase_admin" }],
      extensions: [
        { extname: "pg_stat_statements", extversion: "1.11", schema_name: "extensions", owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
        { extname: "pgcrypto", extversion: "1.3", schema_name: "extensions", owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
        { extname: "uuid-ossp", extversion: "1.1", schema_name: "extensions", owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
      ],
    });
    const source = [
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;",
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;',
      "",
    ].join("\n");
    expect(adaptRecoveryExtensionSql(source, owners).sql).toContain(
      "SET ROLE supabase_admin;\nCREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions VERSION '1.3';\nRESET ROLE;",
    );
    expect(() =>
      stockExtensionOwnersFromCatalog({
        roles: [{ rolname: "postgres" }],
        extensions: [],
      }),
    ).toThrow(/source extension ownership is invalid/);
  });

  test("pins every exact authenticated extension statement and proves the transformed set", () => {
    const source = [
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;",
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;',
      "",
    ].join("\n");
    const adapted = adaptRecoveryExtensionSql(source);
    expect(adapted.sql).toContain(
      "CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault VERSION '0.3.1';",
    );
    expect(adapted.sql).toContain(
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions VERSION '1.11';",
    );
    expect(adapted.proof).toEqual(expectedExtensionSqlPortabilityProof());
  });

  test.each([
    "CREATE EXTENSION IF NOT EXISTS attacker_extension WITH SCHEMA public;",
    "CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA public;",
    "CREATE EXTENSION supabase_vault WITH SCHEMA vault;",
  ])("rejects unknown or mismatched extension SQL: %s", (statement) => {
    const supported = [
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;",
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;',
    ];
    supported[2] = statement;
    expect(() =>
      adaptRecoveryExtensionSql(`${supported.join("\n")}\n`),
    ).toThrow(/unknown or mismatched CREATE EXTENSION/);
  });

  test("rejects missing and repeated authenticated extension SQL", () => {
    const supported = [
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;",
      "CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;",
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;',
    ];
    expect(() =>
      adaptRecoveryExtensionSql(`${supported.slice(1).join("\n")}\n`),
    ).toThrow(/missing CREATE EXTENSION/);
    expect(() =>
      adaptRecoveryExtensionSql(`${[...supported, supported[0]].join("\n")}\n`),
    ).toThrow(/repeats CREATE EXTENSION/);
  });

  test("partitions archive TOC so only extension entries reach the strict SQL adapter", () => {
    const toc = Buffer.from(
      [
        "; archive header",
        "1; 0 0 SCHEMA - extensions postgres",
        "2; 0 0 SCHEMA - vault supabase_admin",
        "20; 0 0 SCHEMA - unrelated postgres",
        "3; 0 0 EXTENSION - pg_stat_statements supabase_admin",
        "4; 0 0 EXTENSION - pgcrypto supabase_admin",
        "5; 0 0 EXTENSION - supabase_vault supabase_admin",
        "6; 0 0 EXTENSION - uuid-ossp supabase_admin",
        "7; 1255 1 FUNCTION public audit_text() postgres",
        "8; 0 0 TABLE DATA public audit_log postgres",
        "",
      ].join("\n"),
    );
    const plan = planRecoveryArchiveToc(toc);
    expect(plan.schemas.toString("utf8")).toContain(
      "1; 0 0 SCHEMA - extensions postgres",
    );
    expect(plan.extensions.toString("utf8")).toContain(
      "5; 0 0 EXTENSION - supabase_vault supabase_admin",
    );
    expect(plan.extensions.toString("utf8")).toContain(
      ";7; 1255 1 FUNCTION public audit_text() postgres",
    );
    expect(plan.remainder.toString("utf8")).toContain(
      "7; 1255 1 FUNCTION public audit_text() postgres",
    );
    expect(plan.schemas.toString("utf8")).toContain(
      ";20; 0 0 SCHEMA - unrelated postgres",
    );
    expect(plan.remainder.toString("utf8")).toContain(
      "20; 0 0 SCHEMA - unrelated postgres",
    );
    expect(plan.archiveTocSha256).toBe(sha256(toc));
  });

  test("rejects an unknown extension in the authenticated archive TOC", () => {
    const toc = Buffer.from(
      [
        "10; 0 0 SCHEMA - extensions postgres",
        "11; 0 0 SCHEMA - vault postgres",
        "1; 0 0 EXTENSION - pg_stat_statements postgres",
        "2; 0 0 EXTENSION - pgcrypto postgres",
        "3; 0 0 EXTENSION - supabase_vault postgres",
        "4; 0 0 EXTENSION - uuid-ossp postgres",
        "5; 0 0 EXTENSION - attacker postgres",
        "",
      ].join("\n"),
    );
    expect(() => planRecoveryArchiveToc(toc)).toThrow(
      /unknown, missing, or repeated/,
    );
  });

  test.each([
    '5; 0 0 EXTENSION - "supabase_vault" postgres',
    "5; 0 0 EXTENSION - Supabase_Vault postgres",
    '5; 0 0 EXTENSION - "attacker extension" postgres',
    "5; 0 0 EXTENSION - attacker postgres unexpected-owner-token",
  ])("rejects every unsupported EXTENSION TOC row: %s", (hostileRow) => {
    const toc = Buffer.from(
      [
        "10; 0 0 SCHEMA - extensions postgres",
        "11; 0 0 SCHEMA - vault postgres",
        "1; 0 0 EXTENSION - pg_stat_statements postgres",
        "2; 0 0 EXTENSION - pgcrypto postgres",
        hostileRow,
        "4; 0 0 EXTENSION - uuid-ossp postgres",
        "",
      ].join("\n"),
    );
    expect(() => planRecoveryArchiveToc(toc)).toThrow(/extension/i);
  });

  test.each(["unknown", "version", "schema", "members"] as const)(
    "rejects unsupported source extension catalog state: %s",
    (mutation) => {
      const value = fixture();
      try {
        const encryptedCatalog = value.receipt.artifacts.find(
          (artifact) => artifact.format === "catalog-json",
        );
        expect(encryptedCatalog).toBeDefined();
        const snapshot = {
          extensions: OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS.map(
            ({ portability: _ignored, ...extension }) => ({
              ...extension,
              owner_role:
                extension.extname === "supabase_vault"
                  ? OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR
                  : "postgres",
            }),
          ) as Array<{
            extname: string;
            extversion: string;
            schema_name: string;
          }>,
          managed_extension_members:
            OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_MEMBERS.map((row) => ({
              extname: "supabase_vault",
              ...row,
            })),
          managed_extension_schema: [
            { owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
          ],
          managed_extension_relations: [
            { owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
          ],
          managed_extension_columns: [],
          managed_extension_functions: [
            "crypto-decrypt",
            "crypto-encrypt",
            "crypto-noncegen",
            "create-secret",
            "update-secret",
          ].map((profile) => ({
            owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
            implementation_profile: `supabase-vault-v0.3.1:${profile}`,
          })),
          managed_extension_types: [
            { owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
          ],
          managed_extension_indexes: [],
          managed_extension_constraints: [],
          managed_extension_config: [],
          managed_extension_acls: [],
        };
        if (mutation === "unknown")
          snapshot.extensions.push({
            extname: "unknown_extension",
            extversion: "1.0",
            schema_name: "public",
          });
        if (mutation === "version")
          snapshot.extensions[3]!.extversion = "0.3.0";
        if (mutation === "schema")
          snapshot.extensions[3]!.schema_name = "public";
        if (mutation === "members") snapshot.managed_extension_members.pop();
        expect(() => recoveryExtensionPortability(snapshot)).toThrow(
          /unsupported/,
        );
      } finally {
        fs.rmSync(value.directory, { recursive: true, force: true });
      }
    },
  );

  test("pins the checked-in managed extension fixture bytes", () => {
    expect(() => assertManagedExtensionFixtureSource()).not.toThrow();
    const stale = fs.mkdtempSync(
      path.join(os.tmpdir(), "ot-stale-vault-fixture-"),
    );
    try {
      const fixtureRoot = path.join(stale, "fixtures", "postgresql");
      fs.mkdirSync(fixtureRoot, { recursive: true });
      for (const name of [
        "supabase_vault.control",
        "supabase_vault--0.3.1.sql",
      ])
        fs.copyFileSync(
          path.join(process.cwd(), "fixtures", "postgresql", name),
          path.join(fixtureRoot, name),
        );
      fs.appendFileSync(
        path.join(fixtureRoot, "supabase_vault--0.3.1.sql"),
        "\n-- stale pin\n",
      );
      expect(() => assertManagedExtensionFixtureSource(stale)).toThrow(
        /fixture source changed/,
      );
    } finally {
      fs.rmSync(stale, { recursive: true, force: true });
    }
  });

  test("binds native Vault profiles to the pinned upstream 0.3.1 entry points", () => {
    expect(OT_PRODUCTION_RECOVERY_CATALOG_SQL).toContain(
      "p.probin='$libdir/supabase_vault' and p.prosrc='pgsodium_crypto_aead_det_encrypt_by_id'",
    );
    expect(OT_PRODUCTION_RECOVERY_CATALOG_SQL).toContain(
      "p.probin='$libdir/supabase_vault' and p.prosrc='pgsodium_crypto_aead_det_decrypt_by_id'",
    );
    expect(OT_PRODUCTION_RECOVERY_CATALOG_SQL).toContain(
      "p.probin='$libdir/supabase_vault' and p.prosrc='pgsodium_crypto_aead_det_noncegen'",
    );
    expect(OT_PRODUCTION_RECOVERY_CATALOG_SQL).not.toContain(
      "p.probin='$libdir/vault'",
    );
    expect(OT_PRODUCTION_RECOVERY_CATALOG_SQL).not.toContain(
      "p.prosrc='pgsodium_crypto_aead_det_encrypt'",
    );
    expect(OT_PRODUCTION_RECOVERY_CATALOG_SQL).not.toContain(
      "p.prosrc='pgsodium_crypto_aead_det_decrypt'",
    );
    expect(OT_PRODUCTION_RECOVERY_CATALOG_SQL).not.toMatch(
      /p\.proname='(?:create_secret|update_secret)'[\s\S]{0,200}\blike\b/i,
    );
    expect(OT_PRODUCTION_RECOVERY_CATALOG_SQL).not.toContain(
      "regexp_replace(p.prosrc",
    );
    for (const digest of [
      "4804be82df1e759cec455b5d234cd7c96dc19382be281b93fcc0b29c897bf286",
      "54841098ee3262ffb0c449160b924623bbfb60da68f88156a760e397b71cdfcd",
      "45c3edf8140259654aee1807a4ffe9d7afbe55d39676572cf608e79f5bb9d8ed",
      "f4769f52bc723eed76644ed7c5a1dd224d7f2b8232d9ec998f1e9dfbfb88bac2",
      "26037d4292c5a86ea1ef932dd3286e628aacb2473f09e349636ef92d3b1afd04",
      "dd7be892de94e335d2e282b69b192258950df43261ed11ca42aee0931f63d5ab",
    ])
      expect(OT_PRODUCTION_RECOVERY_CATALOG_SQL).toContain(digest);
  });

  test("canonicalizes only PostgreSQL ACL-array ordering drift", () => {
    const source = {
      default_acls: [
        {
          owner_role: "postgres",
          acl: "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}",
        },
      ],
    };
    const reordered = {
      default_acls: [
        {
          owner_role: "postgres",
          acl: "{anon=X/postgres,authenticated=X/postgres,postgres=X/postgres}",
        },
      ],
    };
    expect(alignRestoredCatalogAclOrdering(source, reordered)).toEqual(source);
    const changed = structuredClone(reordered);
    changed.default_acls[0]!.acl =
      "{anon=X/postgres,authenticated=r/postgres,postgres=X/postgres}";
    expect(alignRestoredCatalogAclOrdering(source, changed)).toEqual(changed);
  });

  test("temporarily promotes only an authenticated non-superuser postgres owner", () => {
    expect(
      planTemporaryPostgresOwnerPromotion({
        roles: [{ rolname: "postgres", rolsuper: false }],
      }),
    ).toEqual({
      promoteSql: "ALTER ROLE postgres SUPERUSER;\n",
      restoreSql: "ALTER ROLE postgres NOSUPERUSER;\n",
    });
    expect(
      planTemporaryPostgresOwnerPromotion({
        roles: [{ rolname: "postgres", rolsuper: true }],
      }),
    ).toEqual({ promoteSql: "", restoreSql: "" });
    for (const invalid of [
      {},
      { roles: [] },
      { roles: [{ rolname: "postgres" }] },
      { roles: [{ rolname: "postgres", rolsuper: "false" }] },
      { roles: [{ rolname: "postgres", rolsuper: null }] },
      { roles: [{ rolname: "postgres", rolsuper: false }, { rolname: "postgres", rolsuper: false }] },
      { roles: [{ rolname: "postgres", rolsuper: false }, { rolname: "postgres", rolsuper: "false" }] },
      { roles: [{ rolname: "postgres", rolsuper: true }, { rolname: "postgres" }] },
    ])
      expect(() => planTemporaryPostgresOwnerPromotion(invalid)).toThrow(
        /authenticated postgres owner/,
      );
  });

  test("keeps restore row diagnostics opaque and verifies database bytes before COMMIT", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "scripts/rehearse-neutral-production-recovery.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("errors +=");
    expect(source).not.toContain("${errors}");
    expect(source).not.toContain("pg_restore SQL emission failed:");
    expect(source).not.toContain("single-session restore failed:");
    const checksumGate = source.indexOf(
      "verifiedDatabaseHash !== input.expectedDatabaseSha256",
    );
    const promote = source.indexOf(
      "psql.stdin.write(input.ownerPromotion.promoteSql)",
    );
    const firstArchiveRestore = source.indexOf("const runArchive = async");
    const restoreOwner = source.indexOf(
      "psql.stdin.end(`${input.ownerPromotion.restoreSql}COMMIT;\\n`)",
    );
    expect(checksumGate).toBeGreaterThan(0);
    expect(promote).toBeGreaterThan(0);
    expect(promote).toBeLessThan(firstArchiveRestore);
    expect(checksumGate).toBeLessThan(firstArchiveRestore);
    expect(firstArchiveRestore).toBeLessThan(restoreOwner);
    const canary = "customer-row-secret@example.invalid";
    const opaqueFailure = new Error("pg_restore SQL emission failed");
    expect(opaqueFailure.message).not.toContain(canary);
  });

  test("streams catalog bytes directly to trusted gpg without a plaintext FIFO", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts/create-neutral-production-recovery.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/mkfifo|createWriteStream\(temporary/);
    expect(source).toContain("gpg.stdin!.end(input.bytes)");
  });

  test("prepares a private hash-pinned PostgreSQL runtime without touching the source installation", () => {
    const root = fs.mkdtempSync(
      path.join(process.cwd(), ".ot-extension-source-"),
    );
    const strictRuntime = fs.mkdtempSync(path.join("/tmp", "otpg17-strict."));
    const runtime = fs.mkdtempSync(path.join("/tmp", "otpg17."));
    const maliciousRuntime = fs.mkdtempSync(
      path.join("/tmp", "otpg17-malicious."),
    );
    fs.chmodSync(strictRuntime, 0o700);
    fs.chmodSync(runtime, 0o700);
    fs.chmodSync(maliciousRuntime, 0o700);
    try {
      const shared = path.join(root, "source-share");
      const library = path.join(root, "source-lib");
      const bin = path.join(root, "source-bin");
      const extension = path.join(shared, "extension");
      fs.mkdirSync(extension, { recursive: true, mode: 0o700 });
      fs.mkdirSync(library, { mode: 0o700 });
      fs.writeFileSync(
        path.join(library, "dict_snowball.so"),
        "standard-module",
        {
          mode: 0o500,
        },
      );
      fs.mkdirSync(bin, { mode: 0o700 });
      const dictionaryDirectory = path.join(shared, "tsearch_data");
      fs.mkdirSync(dictionaryDirectory, { mode: 0o700 });
      const externalDictionary = path.join(root, "external-en_us.affix");
      fs.writeFileSync(externalDictionary, "must-not-be-copied", {
        mode: 0o600,
      });
      fs.symlinkSync(
        externalDictionary,
        path.join(dictionaryDirectory, "en_us.affix"),
      );
      fs.symlinkSync(
        externalDictionary,
        path.join(dictionaryDirectory, "en_us.dict"),
      );
      const compiledPath = Buffer.concat([
        Buffer.from("synthetic-binary"),
        Buffer.from([0]),
        Buffer.from(shared),
        Buffer.from([0]),
        Buffer.from(library),
        Buffer.from([0]),
        Buffer.from("tail"),
      ]);
      for (const name of ["postgres", "initdb"])
        fs.writeFileSync(path.join(bin, name), compiledPath, { mode: 0o500 });
      fs.writeFileSync(path.join(bin, "pg_ctl"), "synthetic", {
        mode: 0o500,
      });
      const pgConfig = path.join(bin, "pg_config");
      fs.writeFileSync(
        pgConfig,
        `#!/bin/sh\ncase "$1" in\n  --version) printf '%s\\n' 'PostgreSQL 17.11';;\n  --sharedir) printf '%s\\n' '${shared}';;\n  --pkglibdir) printf '%s\\n' '${library}';;\n  *) exit 1;;\nesac\n`,
        { mode: 0o700 },
      );
      expect(() =>
        prepareManagedExtensionRuntime({
          runtimeRoot: strictRuntime,
          sourcePgConfig: pgConfig,
        }),
      ).toThrow(/Trusted executable ancestry is unsafe/);
      expect(fs.readdirSync(strictRuntime)).toEqual([]);
      const prepared = prepareManagedExtensionRuntime({
        runtimeRoot: runtime,
        sourcePgConfig: pgConfig,
        testOnlyOwnershipPolicy: TEST_EXECUTABLE_POLICY,
      });
      expect(prepared.privateSharedDirectory).toBe(
        path.join(fs.realpathSync(runtime), "s"),
      );
      expect(
        fs.existsSync(path.join(runtime, "s", "tsearch_data", "en_us.affix")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(runtime, "s", "tsearch_data", "en_us.dict")),
      ).toBe(false);
      expect(fs.readFileSync(externalDictionary, "utf8")).toBe(
        "must-not-be-copied",
      );
      expect(prepared.privateLibraryDirectory).toBe(
        path.join(fs.realpathSync(runtime), "l"),
      );
      expect(
        fs.readFileSync(path.join(runtime, "l", "dict_snowball.so"), "utf8"),
      ).toBe("standard-module");
      for (const name of [
        "supabase_vault.control",
        "supabase_vault--0.3.1.sql",
      ])
        expect(
          fs.statSync(path.join(runtime, "s", "extension", name)).mode & 0o777,
        ).toBe(0o444);
      expect(fs.readdirSync(extension)).toEqual([]);
      expect(() =>
        prepareManagedExtensionRuntime({
          runtimeRoot: runtime,
          sourcePgConfig: pgConfig,
          testOnlyOwnershipPolicy: TEST_EXECUTABLE_POLICY,
        }),
      ).toThrow();

      expect(() => assertManagedExtensionFixtureInstalled(runtime)).toThrow(
        /runtime root is unsafe/,
      );

      const changed = path.join(
        runtime,
        "s",
        "extension",
        "supabase_vault.control",
      );
      fs.chmodSync(changed, 0o644);
      fs.appendFileSync(changed, "# tampered\n");
      expect(() =>
        assertManagedExtensionFixtureInstalled(
          runtime,
          process.cwd(),
          TEST_EXECUTABLE_POLICY,
        ),
      ).toThrow(/runtime tree changed|fixture is invalid/);

      const unapprovedSymlink = path.join(
        dictionaryDirectory,
        "unapproved-link",
      );
      fs.symlinkSync(externalDictionary, unapprovedSymlink);
      expect(() =>
        prepareManagedExtensionRuntime({
          runtimeRoot: maliciousRuntime,
          sourcePgConfig: pgConfig,
          testOnlyOwnershipPolicy: TEST_EXECUTABLE_POLICY,
        }),
      ).toThrow(/tree entry is unsafe/);
      expect(fs.readdirSync(maliciousRuntime)).toEqual([]);
      fs.unlinkSync(unapprovedSymlink);

      fs.unlinkSync(path.join(bin, "postgres"));
      fs.symlinkSync(externalDictionary, path.join(bin, "postgres"));
      expect(() =>
        prepareManagedExtensionRuntime({
          runtimeRoot: maliciousRuntime,
          sourcePgConfig: pgConfig,
          testOnlyOwnershipPolicy: TEST_EXECUTABLE_POLICY,
        }),
      ).toThrow();
      expect(fs.readdirSync(maliciousRuntime)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(strictRuntime, { recursive: true, force: true });
      fs.rmSync(runtime, { recursive: true, force: true });
      fs.rmSync(maliciousRuntime, { recursive: true, force: true });
    }
  });

  test("rejects pre-portability v1 backup receipts", () => {
    const value = fixture();
    try {
      expect(() =>
        assertRecoveryReceipt({
          ...value.receipt,
          schema: "ot.neutral-production-recovery.v1",
        }),
      ).toThrow(/schema is unknown/);
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  });

  test("adapts only strict Supabase-managed membership grantors and preserves every option", () => {
    const source = Buffer.from(
      [
        "CREATE ROLE anon;",
        "GRANT anon TO authenticator WITH INHERIT TRUE GRANTED BY supabase_admin;",
        'GRANT \"Case Role\" TO \"Case Member\" WITH ADMIN OPTION, INHERIT FALSE, SET FALSE GRANTED BY \"supabase_admin\";',
        "GRANT authenticated TO service_role WITH SET FALSE GRANTED BY postgres;",
        "",
      ].join("\n"),
    );
    const adapted = adaptManagedRoleMembershipGrantors(source);
    expect(adapted.managedMembershipCount).toBe(2);
    expect(adapted.bytes.toString("utf8")).toBe(
      [
        "CREATE ROLE anon;",
        "GRANT anon TO authenticator WITH INHERIT TRUE;",
        'GRANT \"Case Role\" TO \"Case Member\" WITH ADMIN OPTION, INHERIT FALSE, SET FALSE;',
        "GRANT authenticated TO service_role WITH SET FALSE GRANTED BY postgres;",
        "",
      ].join("\n"),
    );
  });

  test.each([
    "GRANT anon, authenticated TO authenticator GRANTED BY supabase_admin;",
    "GRANT SELECT ON secrets TO authenticator GRANTED BY supabase_admin;",
    "GRANT anon TO authenticator GRANTED BY supabase_admin; -- trailing",
    "GRANT anon TO authenticator GRANTED BY supabase_admin; GRANT authenticated TO service_role;",
  ])("rejects ambiguous managed grant syntax: %s", (statement) => {
    expect(() =>
      adaptManagedRoleMembershipGrantors(Buffer.from(`${statement}\n`)),
    ).toThrow(/ambiguous GRANTED BY/);
  });

  test("passes non-GRANT statements containing GRANTED BY text through byte-for-byte", () => {
    const source = Buffer.from(
      [
        "COMMENT ON ROLE anon IS 'managed by text: GRANTED BY supabase_admin';",
        "ALTER ROLE anon SET application_name = 'GRANTED BY supabase_admin';",
        "grant anon to authenticator granted by supabase_admin;",
        "",
      ].join("\n"),
    );
    const adapted = adaptManagedRoleMembershipGrantors(source);
    expect(adapted.managedMembershipCount).toBe(0);
    expect(adapted.bytes).toEqual(source);
  });

  test("does not hide a well-formed arbitrary explicit grantor", () => {
    const source = Buffer.from(
      "GRANT anon TO authenticator WITH INHERIT TRUE GRANTED BY attacker_admin;\n",
    );
    const adapted = adaptManagedRoleMembershipGrantors(source);
    expect(adapted.managedMembershipCount).toBe(0);
    expect(adapted.bytes).toEqual(source);
  });

  test("binds managed dump adaptation to source and pristine-target catalog counts", () => {
    expect(() =>
      assertManagedRoleMembershipPortabilityCounts({
        authenticatedSourceCount: 24,
        sourceCatalogCount: 24,
        pristineTargetCount: 3,
        adaptedStatementCount: 21,
      }),
    ).not.toThrow();
    for (const mismatch of [
      {
        authenticatedSourceCount: 23,
        sourceCatalogCount: 24,
        pristineTargetCount: 3,
        adaptedStatementCount: 21,
      },
      {
        authenticatedSourceCount: 24,
        sourceCatalogCount: 24,
        pristineTargetCount: 3,
        adaptedStatementCount: 20,
      },
      {
        authenticatedSourceCount: 24,
        sourceCatalogCount: 24,
        pristineTargetCount: 4,
        adaptedStatementCount: 21,
      },
    ])
      expect(() =>
        assertManagedRoleMembershipPortabilityCounts(mismatch),
      ).toThrow(/portability count/);
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

  test("holds encrypted artifact identity and rejects swaps between restore passes", () => {
    const copy = materializePrivateCopy(Buffer.from("encrypted-database"));
    const moved = `${copy.file}.moved`;
    try {
      verifyPrivateCopy(copy);
      fs.renameSync(copy.file, moved);
      fs.writeFileSync(copy.file, "attacker", { mode: 0o400 });
      expect(() => verifyPrivateCopy(copy)).toThrow(/identity changed/);
    } finally {
      copy.cleanup();
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

  test("fails closed when the protected parent is swapped before open", () => {
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
      expect(() =>
        readProtectedFile(artifact, () => {
          fs.renameSync(directory, moved);
          fs.renameSync(attacker, directory);
        }),
      ).toThrow(/identity changed/);
      fs.renameSync(directory, attacker);
      fs.renameSync(moved, directory);
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

describe("Production rollout runbook", () => {
  const runbook = () =>
    fs.readFileSync(
      path.join(
        process.cwd(),
        "docs/ops/ot-neutral-production-rollout-packet-2026-09-17.md",
      ),
      "utf8",
    );

  test("seals every private runtime tree the restore validator re-measures", () => {
    // `assertManagedExtensionFixtureInstalled` re-measures b, s and l under
    // root-or-runtime-root ownership with no group/world write, so a procedure
    // that seals only two of the three cannot pass its own gate.
    const seal =
      /sudo chown -R root ([^\n]*)\n\s*sudo chmod -R go-w ([^\n]*)/.exec(
        runbook(),
      );
    expect(seal).not.toBeNull();
    for (const group of [seal![1]!, seal![2]!])
      for (const tree of ['"$pg_bin"', '"$root/s"', '"$root/l"'])
        expect(group).toContain(tree);
  });

  test("keeps the native Vault recorder's non-root policy distinct from the restored-runtime seal", () => {
    expect(runbook()).toContain(
      "The recorder must not be run as root or under sudo",
    );
  });
});
