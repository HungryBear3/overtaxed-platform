/**
 * The ordered Production resolve manifest.
 *
 * Every migration the Production baseline covers is listed here exactly once, in
 * the order Prisma would have applied it, with WHY it is being resolved rather
 * than deployed, what the database must look like before, and what it must look
 * like after. Nothing in this file runs anything: it is the contract the
 * operator runner enforces and the document a reviewer reads.
 *
 * TWO dispositions, and the difference between them is the whole point of the
 * exercise:
 *
 *   covered-by-baseline    the migration WOULD run correctly against Production;
 *                          the baseline simply materializes its end state in the
 *                          same transaction as everything else, so running it
 *                          afterwards would fail on objects that already exist.
 *
 *   replaced-incompatible  the migration CANNOT run against Production at all.
 *                          Each one names the exact precondition Production does
 *                          not satisfy. These are the three the prior review
 *                          found, and resolving them without a replacement would
 *                          be recording work that was never done.
 *
 * There is deliberately no third "deployable-after-baseline" disposition. This
 * manifest has exactly one meaning — every entry in it is covered by the
 * baseline, pinned by checksum, forbidden in the ledger beforehand, required in
 * the ledger afterwards, and resolved by exactly one command. A disposition that
 * opted an entry out of the resolve plan while leaving it in
 * [[coveredMigrationNames]] made those four lists disagree with each other, and
 * the disagreement would have surfaced as a ledger gate that can never pass.
 * Migrations that may simply be deployed live in
 * [[OT_NEUTRAL_PRODUCTION_DEPLOYABLE_AFTER_BASELINE]], which is a separate list
 * precisely because it has separate semantics.
 */

export type ResolveDisposition =
  | "covered-by-baseline"
  | "replaced-incompatible";

export type ResolveManifestEntry = {
  order: number;
  migration: string;
  path: string;
  disposition: ResolveDisposition;
  /** Why this disposition and not another. */
  reason: string;
  /** What must be true of the database before the baseline transaction opens. */
  expectedPre: string;
  /** What the baseline must have made true before the ledger is touched. */
  expectedPost: string;
};

const dir = (migration: string) => `prisma/migrations/${migration}/migration.sql`;

const covered = (
  order: number,
  migration: string,
  reason: string,
  expectedPre: string,
  expectedPost: string,
): ResolveManifestEntry => ({
  order,
  migration,
  path: dir(migration),
  disposition: "covered-by-baseline",
  reason,
  expectedPre,
  expectedPost,
});

const replaced = (
  order: number,
  migration: string,
  reason: string,
  expectedPre: string,
  expectedPost: string,
): ResolveManifestEntry => ({
  order,
  migration,
  path: dir(migration),
  disposition: "replaced-incompatible",
  reason,
  expectedPre,
  expectedPost,
});

export const OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST: readonly ResolveManifestEntry[] =
  [
    covered(
      1,
      "20260912000000_add_ot_order_attribution",
      "Pure additive DDL owned by the migration role; no platform authority is required.",
      "public.ot_order_attribution is absent.",
      "ot_order_attribution exists with its four constraints, immutability trigger, partial campaign index, RLS enabled and zero policies, and no PUBLIC or Supabase API-role privilege.",
    ),
    covered(
      2,
      "20260912120000_add_ot_packet_download_and_orphan_quarantine",
      "Pure additive DDL against relations the owner already owns.",
      "ot_packet_download_capability and ot_artifact_orphan_quarantine are absent.",
      "Both relations exist with their CHECK invariants, unique and lookup indexes, and the two intra-evidence foreign keys.",
    ),
    covered(
      3,
      "20260912140000_deny_packet_api_access",
      "Corrective hardening of the two relations created immediately above.",
      "Neither relation has RLS enabled.",
      "Both have RLS enabled and no PUBLIC or Supabase API-role privilege.",
    ),
    covered(
      4,
      "20260912160000_add_ot_t2_delivery_callbacks",
      "Additive column, index, foreign keys and one new relation.",
      "ot_delivery_attempt.download_capability_id and ot_delivery_provider_callback are absent.",
      "The column, its unique index and foreign key exist, and ot_delivery_provider_callback exists with RLS enabled and closed ACLs.",
    ),
    covered(
      5,
      "20260912180000_widen_ot_admin_event_actions",
      "Constraint reshape only; shape 1 is byte-for-byte the rule it replaces, so no existing row is invalidated and no table is rewritten.",
      "ot_fulfillment_admin_event carries the four single-action CHECK constraints.",
      "The three named shape constraints exist and the superseded single-action CHECK is gone.",
    ),
    covered(
      6,
      "20260912190000_ot_settlement_revocation",
      "Additive private settlement evidence with no replay or backfill.",
      "ot_payment_binding and ot_settlement_reversal are absent.",
      "Both exist with append-only triggers, RLS enabled, and the settlement-hold preservation trigger on ot_order.",
    ),
    replaced(
      7,
      "20260913170000_add_ot_commerce_deadline_capture",
      "REFUSES unless the migration connection has rolsuper, and additionally requires ot_commerce_capture_owner to have a completely empty membership graph. Production postgres has rolsuper=false, and a non-superuser CREATEROLE connection on PostgreSQL 16+ always leaves an unrevokable ADMIN edge on any role it creates. Both preconditions are unsatisfiable in Production simultaneously and by construction.",
      "ot_commerce_deadline_capture, its two functions and ot_commerce_capture_owner are absent.",
      "The same end state, reached by borrowing SET/INHERIT on the owner role under the ADMIN OPTION a CREATEROLE connection already holds: table and both functions owned by ot_commerce_capture_owner, migration role holding SELECT plus a SELECT policy plus EXECUTE on the publish function and nothing more, PUBLIC and all three API roles revoked.",
    ),
    covered(
      8,
      "20260915143000_add_ot_neutral_report_repository",
      "Creates ot_neutral_runtime with CREATEROLE authority the Production owner has. The commerce-table grants and the two commerce policies it creates are deliberately not materialized: migration 11 removes them, and the baseline goes straight to the end state.",
      "The two reservation enums, the three neutral relations and ot_neutral_runtime are absent.",
      "Enums, relations, ENABLE+FORCE RLS, the three runtime policies and the runtime grants exist; ot_neutral_runtime holds no direct commerce-table privilege at any point.",
    ),
    covered(
      9,
      "20260915190000_add_ot_neutral_qa_delivery",
      "Adds the NEUTRAL_RECORDS_REPORT enum label, the QA/refund/customer-ZIP relations, ot_neutral_app_reader and the reversal guard. Its one platform-sensitive step — transferring the SECURITY DEFINER guard function to a NOLOGIN owner — is performed with the same borrow/return pattern, and the PUBLIC revoke is issued by the new owner rather than by the migration role, which is what makes it take effect.",
      "OTFulfillmentKind lacks NEUTRAL_RECORDS_REPORT; the QA, refund and customer-ZIP relations and their roles are absent.",
      "The label, relations, ENABLE+FORCE RLS, the app-reader and reversal-guard grants and policies exist; ot_neutral_hold_on_settlement_reversal is owned by ot_neutral_reversal_guard_owner and is not executable by PUBLIC or any API role.",
    ),
    covered(
      10,
      "20260915220000_add_ot_neutral_delivery_runtime",
      "Creates ot_neutral_delivery_runtime, the kind-scoped policies, the three security-barrier authority views and the single-use capability trigger.",
      "ot_neutral_delivery_runtime and the three authority views are absent.",
      "The role, the column-scoped grants, the kind-scoped policies, the views and the single-use trigger exist.",
    ),
    covered(
      11,
      "20260915230000_constrain_ot_neutral_runtime_commerce_reads",
      "Creates the three runtime commerce views and the refund lookup-audit columns. In the baseline the revokes it performs are unnecessary because the grants they remove were never issued.",
      "The three ot_neutral_runtime_* views and the refund lookup columns are absent.",
      "The views exist and are the ONLY commerce access ot_neutral_runtime has; the lookup columns and their shape constraint exist.",
    ),
    replaced(
      12,
      "20260916120000_reconcile_ot_neutral_qa_delivery_forward",
      "A Preview-only incident reconciliation. It requires a role literally named ot_preview_app with an exact membership graph, and accepts only two catalog digests captured from Preview fixtures. Neither exists in Production, and there is no Preview ledger incident in Production to reconcile because none of these migrations has ever been applied there.",
      "No neutral relation exists, so there is no partially-applied migration to reconcile.",
      "Its one material effect is kept and widened: PUBLIC and all three Supabase API roles hold no privilege on ANY relation the baseline created, not only on the three the Preview incident touched.",
    ),
    covered(
      13,
      "20260916121000_harden_ot_supabase_owner_roles",
      "Its effects — USAGE without CREATE on schema public for both owner roles, and no surviving temporary SET grant — are applied at role-creation time inside the baseline and proved by the postconditions. Running it afterwards would additionally demand that PUBLIC hold no CREATE on schema public, which is a separate, human-gated Production prerequisite rather than something a migration should silently require.",
      "Neither owner role exists.",
      "Both owner roles exist with no login, no inherit, no ambient authority, USAGE but no direct CREATE on schema public, and no membership edge granted by the migration role.",
    ),
    replaced(
      14,
      "20260916220000_harden_ot_supabase_public_acl",
      "Aborts before its first statement unless public.rls_auto_enable() exists. It does not exist in Production, so the migration can only ever raise 'target topology is invalid'.",
      "extensions.pg_stat_statements is readable by PUBLIC and ot_packet_download_capability does not FORCE RLS.",
      "PUBLIC holds no SELECT on either pg_stat_statements view and ot_packet_download_capability is ENABLE+FORCE RLS. public.rls_auto_enable() is never referenced.",
    ),
  ];

/**
 * Migrations that come AFTER the baseline and may go through
 * `prisma migrate deploy` normally, once their independence from the
 * post-baseline state has been proved. Declared, and empty: it exists so the
 * next migration has a stated home instead of an assumption, and it is a
 * separate list rather than a manifest disposition so that nothing in the
 * manifest can ever be something the resolve plan skips.
 */
export const OT_NEUTRAL_PRODUCTION_DEPLOYABLE_AFTER_BASELINE: readonly string[] =
  [];

export const OT_NEUTRAL_PRODUCTION_BASELINE_ARTIFACTS = [
  "prisma/production-baseline/01_preflight.sql",
  "prisma/production-baseline/02_baseline.sql",
  "prisma/production-baseline/03_postconditions.sql",
] as const;

export const OT_NEUTRAL_PRODUCTION_CHECKSUM_FILE =
  "prisma/production-baseline/resolve-manifest.json";

export const OT_NEUTRAL_PRODUCTION_CHECKSUM_SCHEMA =
  "ot.neutral-production-resolve-manifest.v1";

export type ResolveChecksumFile = {
  schema: typeof OT_NEUTRAL_PRODUCTION_CHECKSUM_SCHEMA;
  /** Repo-relative path -> lowercase hex SHA-256 of the file's exact bytes. */
  baselineArtifacts: Record<string, string>;
  coveredMigrations: Record<string, string>;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Every path the manifest pins, in a stable order. */
export function manifestPinnedPaths(): string[] {
  return [
    ...OT_NEUTRAL_PRODUCTION_BASELINE_ARTIFACTS,
    ...OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST.map((entry) => entry.path),
  ];
}

export function parseResolveChecksumFile(raw: string): ResolveChecksumFile {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Production resolve manifest checksums are not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Production resolve manifest checksums are not an object");
  const file = value as Record<string, unknown>;
  if (file.schema !== OT_NEUTRAL_PRODUCTION_CHECKSUM_SCHEMA)
    throw new Error("Production resolve manifest checksum schema is unknown");
  for (const key of ["baselineArtifacts", "coveredMigrations"] as const) {
    const section = file[key];
    if (!section || typeof section !== "object" || Array.isArray(section))
      throw new Error(`Production resolve manifest ${key} is not an object`);
    for (const [path, digest] of Object.entries(section)) {
      if (typeof digest !== "string" || !SHA256_HEX.test(digest))
        throw new Error(
          `Production resolve manifest digest for ${path} is not a SHA-256 hex string`,
        );
    }
  }
  return file as ResolveChecksumFile;
}

export function flattenResolveChecksums(
  file: ResolveChecksumFile,
): Record<string, string> {
  return { ...file.baselineArtifacts, ...file.coveredMigrations };
}

/**
 * Exact in both directions. A pin without a file is a manifest that describes
 * something that is not there; a file without a pin is a file nobody agreed to.
 * Either one means the artifact set on disk is not the one that was reviewed.
 */
export function assertResolveChecksums(
  pinned: Record<string, string>,
  observed: Record<string, string>,
): void {
  const expectedPaths = manifestPinnedPaths();
  const problems: string[] = [];

  for (const path of expectedPaths) {
    const pin = pinned[path];
    const actual = observed[path];
    if (!pin) problems.push(`unpinned:${path}`);
    else if (!actual) problems.push(`missing:${path}`);
    else if (pin !== actual) problems.push(`tampered:${path}`);
  }
  for (const path of Object.keys(pinned))
    if (!expectedPaths.includes(path)) problems.push(`extra-pin:${path}`);

  if (problems.length)
    throw new Error(
      `Production baseline artifact integrity failed: ${problems.sort().join(", ")}`,
    );
}

export type MigrationCommand = {
  command: string;
  args: readonly string[];
};

/**
 * Where the Prisma CLI lives INSIDE this checkout.
 *
 * Never `npx prisma`: on a host whose cache is cold, `npx` resolves a missing
 * package by downloading one from the network, and an operator path that can
 * fetch and execute a fresh binary mid-rollout is a supply chain the rollout
 * packet never reviewed. The local binary is the one `npm ci` installed, pinned
 * by the committed lockfile, and its absence is a refusal rather than a fetch.
 */
export const OT_LOCAL_PRISMA_BINARY = "node_modules/.bin/prisma";

/**
 * The exact `prisma migrate resolve` invocations, in manifest order, as argument
 * ARRAYS. Nothing is ever interpolated into a shell string: a migration name is
 * repo data, and repo data must not be able to become a command.
 *
 * `executable` has no default on purpose. The only correct value is an absolute
 * path the caller has already proved exists, and a default would be a way to
 * accidentally ship the `npx` behaviour back.
 */
export function planResolveCommands(
  executable: string,
  manifest: readonly ResolveManifestEntry[] = OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST,
): MigrationCommand[] {
  return manifest
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((entry) => ({
      command: executable,
      args: ["migrate", "resolve", "--applied", entry.migration],
    }));
}

/**
 * The migrations the ledger must not already contain when the baseline runs,
 * and must contain exactly once when it is done. Same set, same order and same
 * source as [[planResolveCommands]] — there is no manifest entry that is one but
 * not the other.
 */
export function coveredMigrationNames(): string[] {
  return OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST.slice()
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.migration);
}

/** The last migration Production has actually applied. Verified read-only. */
export const OT_PRODUCTION_LAST_APPLIED_MIGRATION =
  "20260809120000_add_ot_artifact_provenance";
