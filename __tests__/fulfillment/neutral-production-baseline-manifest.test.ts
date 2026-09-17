import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  OT_LOCAL_PRISMA_BINARY,
  OT_NEUTRAL_PRODUCTION_BASELINE_ARTIFACTS,
  OT_NEUTRAL_PRODUCTION_CHECKSUM_FILE,
  OT_NEUTRAL_PRODUCTION_CHECKSUM_SCHEMA,
  OT_NEUTRAL_PRODUCTION_DEPLOYABLE_AFTER_BASELINE,
  OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST,
  OT_PRODUCTION_LAST_APPLIED_MIGRATION,
  assertResolveChecksums,
  coveredMigrationNames,
  flattenResolveChecksums,
  manifestPinnedPaths,
  parseResolveChecksumFile,
  planResolveCommands,
} from "@/lib/fulfillment/neutral-production-baseline-manifest";
import {
  assertProductionArtifactIntegrity,
  observedManifestDigests,
  pinnedManifestDigests,
} from "@/lib/fulfillment/neutral-production-artifact-integrity";

const root = process.cwd();
const PRISMA_BINARY = `/repo/${OT_LOCAL_PRISMA_BINARY}`;
const sha256 = (relative: string) =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(root, relative)))
    .digest("hex");

describe("Production resolve manifest", () => {
  test("covers every migration pending after the last applied one, exactly once, in order", () => {
    const applied = OT_PRODUCTION_LAST_APPLIED_MIGRATION;
    const onDisk = fs
      .readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const pending = onDisk.filter((name) => name > applied);

    expect(coveredMigrationNames()).toEqual(pending);
    expect(new Set(coveredMigrationNames()).size).toBe(pending.length);
    expect(OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST.map((e) => e.order)).toEqual(
      pending.map((_, index) => index + 1),
    );
  });

  test("names the last applied Production migration that actually exists", () => {
    expect(
      fs.existsSync(
        path.join(root, "prisma/migrations", OT_PRODUCTION_LAST_APPLIED_MIGRATION),
      ),
    ).toBe(true);
  });

  test("marks exactly the three un-runnable migrations as replaced, with a stated reason", () => {
    const replaced = OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST.filter(
      (entry) => entry.disposition === "replaced-incompatible",
    );
    expect(replaced.map((entry) => entry.migration)).toEqual([
      "20260913170000_add_ot_commerce_deadline_capture",
      "20260916120000_reconcile_ot_neutral_qa_delivery_forward",
      "20260916220000_harden_ot_supabase_public_acl",
    ]);
    expect(replaced[0]!.reason).toMatch(/rolsuper/);
    expect(replaced[1]!.reason).toMatch(/ot_preview_app/);
    expect(replaced[2]!.reason).toMatch(/rls_auto_enable/);
  });

  test("states an expected pre and post state for every entry", () => {
    for (const entry of OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST) {
      expect(entry.expectedPre.length).toBeGreaterThan(20);
      expect(entry.expectedPost.length).toBeGreaterThan(20);
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(fs.existsSync(path.join(root, entry.path))).toBe(true);
    }
  });

  test("declares the deployable-after-baseline list explicitly, and it is empty", () => {
    expect(OT_NEUTRAL_PRODUCTION_DEPLOYABLE_AFTER_BASELINE).toEqual([]);
  });

  /**
   * Four lists derive from this manifest: what the checksum file pins, what the
   * ledger must NOT contain beforehand, what it must contain afterwards, and
   * what gets a resolve command. A disposition that opted an entry out of one of
   * them made the four disagree, and the disagreement surfaced as a ledger gate
   * that can never pass. "Deployable after the baseline" is a separate list with
   * separate semantics, not a manifest row.
   */
  test("every manifest entry is covered, pinned and resolved — there is no third disposition", () => {
    const dispositions = new Set(
      OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST.map((entry) => entry.disposition),
    );
    expect([...dispositions].sort()).toEqual([
      "covered-by-baseline",
      "replaced-incompatible",
    ]);

    const covered = coveredMigrationNames();
    const resolved = planResolveCommands(PRISMA_BINARY).map((command) =>
      command.args.at(-1),
    );
    expect(resolved).toEqual(covered);
    expect(covered).toEqual(
      OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST.slice()
        .sort((a, b) => a.order - b.order)
        .map((entry) => entry.migration),
    );
    for (const entry of OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST)
      expect(manifestPinnedPaths()).toContain(entry.path);
  });

  test("the three baseline artifacts exist and are pinned", () => {
    for (const artifact of OT_NEUTRAL_PRODUCTION_BASELINE_ARTIFACTS)
      expect(fs.existsSync(path.join(root, artifact))).toBe(true);
    expect(manifestPinnedPaths()).toHaveLength(
      OT_NEUTRAL_PRODUCTION_BASELINE_ARTIFACTS.length +
        OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST.length,
    );
  });
});

describe("resolve commands", () => {
  test("are exact prisma migrate resolve invocations in manifest order, as argument arrays", () => {
    const commands = planResolveCommands(PRISMA_BINARY);
    expect(commands).toHaveLength(OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST.length);
    expect(commands[0]).toEqual({
      command: PRISMA_BINARY,
      args: [
        "migrate",
        "resolve",
        "--applied",
        "20260912000000_add_ot_order_attribution",
      ],
    });
    for (const command of commands) {
      expect(Array.isArray(command.args)).toBe(true);
      // Nothing that a shell would interpret; the migration name is the last arg.
      for (const arg of command.args) expect(arg).not.toMatch(/[;&|`$><\n]/);
      expect(command.args).not.toContain("--rolled-back");
    }
  });

  /**
   * The executable is the caller's, and it is the Prisma CLI this checkout
   * installed. `npx prisma` downloads one when the cache is cold, which is a
   * network fetch in the middle of the one irreversible phase of the rollout.
   */
  test("run the local Prisma CLI and never npx", () => {
    expect(OT_LOCAL_PRISMA_BINARY).toBe("node_modules/.bin/prisma");
    for (const command of planResolveCommands(PRISMA_BINARY)) {
      expect(command.command).toBe(PRISMA_BINARY);
      expect(command.command).not.toContain("npx");
      expect(command.args).not.toContain("prisma");
    }
  });

  test("never marks anything rolled back and never deploys", () => {
    const flattened = planResolveCommands(PRISMA_BINARY).flatMap(
      (command) => command.args,
    );
    expect(flattened).not.toContain("deploy");
    expect(flattened).not.toContain("dev");
    expect(flattened).not.toContain("reset");
  });
});

describe("artifact checksum integrity", () => {
  const pinnedFor = (paths: string[]) =>
    Object.fromEntries(paths.map((relative) => [relative, sha256(relative)]));

  test("accepts a manifest whose pins match the files on disk", () => {
    const all = manifestPinnedPaths();
    expect(() =>
      assertResolveChecksums(pinnedFor(all), pinnedFor(all)),
    ).not.toThrow();
  });

  test("refuses a tampered artifact", () => {
    const all = manifestPinnedPaths();
    const observed = pinnedFor(all);
    observed[all[1]!] = "0".repeat(64);
    expect(() => assertResolveChecksums(pinnedFor(all), observed)).toThrow(
      /tampered:/,
    );
  });

  test("refuses a missing artifact and an unpinned artifact", () => {
    const all = manifestPinnedPaths();
    const pinned = pinnedFor(all);
    const observed = pinnedFor(all);
    delete observed[all[0]!];
    expect(() => assertResolveChecksums(pinned, observed)).toThrow(/missing:/);

    const short = { ...pinned };
    delete short[all[0]!];
    expect(() => assertResolveChecksums(short, pinnedFor(all))).toThrow(
      /unpinned:/,
    );
  });

  test("refuses a pin for a file the manifest does not describe", () => {
    const all = manifestPinnedPaths();
    expect(() =>
      assertResolveChecksums(
        { ...pinnedFor(all), "prisma/schema.prisma": "0".repeat(64) },
        pinnedFor(all),
      ),
    ).toThrow(/extra-pin:/);
  });

  test("the committed checksum file matches every file it pins", () => {
    const absolute = path.join(root, OT_NEUTRAL_PRODUCTION_CHECKSUM_FILE);
    // A raw ENOENT here reads as "the test is broken". It is not: the pins are a
    // generated, human-reviewed artifact and this is what "nobody has recorded
    // them yet" looks like.
    if (!fs.existsSync(absolute))
      throw new Error(
        `${OT_NEUTRAL_PRODUCTION_CHECKSUM_FILE} has not been recorded. Run: npm run neutral-report:production-record-checksums`,
      );
    const raw = fs.readFileSync(absolute, "utf8");
    const parsed = parseResolveChecksumFile(raw);
    expect(parsed.schema).toBe(OT_NEUTRAL_PRODUCTION_CHECKSUM_SCHEMA);
    const pinned = flattenResolveChecksums(parsed);
    const observed = Object.fromEntries(
      manifestPinnedPaths().map((relative) => [relative, sha256(relative)]),
    );
    expect(() => assertResolveChecksums(pinned, observed)).not.toThrow();
  });

  /**
   * PHASE 7 PROVES ITS OWN BYTES NOW.
   *
   * The apply path has always checksum-verified at Gate 2 before executing. The
   * standalone verifier did not: it read `03_postconditions.sql` off disk, ran
   * whatever was in it, and printed `PASS` — which is the durable receipt the
   * rollout packet files as proof that Production is in the reviewed state. A
   * postcondition file with a loop deleted produces exactly that receipt. Being
   * read-only makes that path safe; it does not make it truthful.
   */
  test("the shared integrity helper accepts this checkout and both operator paths use it", () => {
    expect(() => assertProductionArtifactIntegrity(root)).not.toThrow();

    const observed = observedManifestDigests(root);
    const pinned = pinnedManifestDigests(root);
    for (const relative of manifestPinnedPaths()) {
      expect(observed[relative]).toBe(sha256(relative));
      expect(pinned[relative]).toBe(sha256(relative));
    }
  });

  test("the integrity helper refuses a tampered artifact by path", () => {
    const pinned = pinnedManifestDigests(root);
    const observed = observedManifestDigests(root);
    observed["prisma/production-baseline/03_postconditions.sql"] = "0".repeat(64);
    expect(() => assertResolveChecksums(pinned, observed)).toThrow(
      /tampered:prisma\/production-baseline\/03_postconditions\.sql/,
    );
  });

  test("the standalone Phase 7 verifier proves its artifacts before it connects", () => {
    const source = fs.readFileSync(
      path.join(root, "scripts/verify-neutral-production-postconditions.ts"),
      "utf8",
    );
    expect(source).toContain("assertProductionArtifactIntegrity");
    // Before the datasource is read, before the client is constructed, and
    // before anything can print PASS.
    const integrity = source.indexOf("assertProductionArtifactIntegrity(root)");
    expect(integrity).toBeGreaterThan(-1);
    expect(integrity).toBeLessThan(source.indexOf("new Client("));
    expect(integrity).toBeLessThan(source.indexOf("readFileSync"));
    expect(integrity).toBeLessThan(source.indexOf("PASS ledger="));
    expect(source).toContain("artifacts=checksum-verified");
  });

  /** One helper, so the two operator paths cannot drift apart. */
  test("the apply entrypoint reads its digests from the same helper", () => {
    const source = fs.readFileSync(
      path.join(root, "scripts/neutral-production-baseline-entrypoint.ts"),
      "utf8",
    );
    expect(source).toContain("observedManifestDigests(root)");
    expect(source).toContain("pinnedManifestDigests(root)");
    expect(source).not.toContain("createHash");
  });

  test("refuses a malformed checksum file", () => {
    expect(() => parseResolveChecksumFile("{")).toThrow(/valid JSON/);
    expect(() => parseResolveChecksumFile("[]")).toThrow(/not an object/);
    expect(() =>
      parseResolveChecksumFile(JSON.stringify({ schema: "other" })),
    ).toThrow(/schema is unknown/);
    expect(() =>
      parseResolveChecksumFile(
        JSON.stringify({
          schema: OT_NEUTRAL_PRODUCTION_CHECKSUM_SCHEMA,
          baselineArtifacts: { "a.sql": "not-a-digest" },
          coveredMigrations: {},
        }),
      ),
    ).toThrow(/SHA-256 hex/);
  });
});
