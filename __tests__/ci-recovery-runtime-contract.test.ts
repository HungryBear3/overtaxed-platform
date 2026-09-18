import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const root = process.cwd();
const helperPath = "__tests__/helpers/prepare-neutral-recovery-ci-runtime.mts";
const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const helper = readFileSync(join(root, helperPath), "utf8");
const productionStage = readFileSync(
  join(root, "scripts/stage-neutral-production-recovery-extension-fixture.ts"),
  "utf8",
);
const packageScripts = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).scripts as Record<string, string>;

type Step = { name?: string; run?: string };
type RecoveryJob = { name?: string; steps?: Step[] };

function recoveryJob(): RecoveryJob {
  const parsed = parse(workflow) as {
    jobs?: { "recovery-restore-matrix"?: RecoveryJob };
  };
  return parsed.jobs?.["recovery-restore-matrix"] ?? {};
}

describe("CI synthetic recovery fixture portability", () => {
  it("labels the matrix as synthetic and invokes only the test helper for preparation", () => {
    const job = recoveryJob();
    expect(job.name).toBe(
      "synthetic fixture portability · PostgreSQL ${{ matrix.postgres }}",
    );
    const restore = job.steps?.find(
      (step) => step.name === "Restore synthetic encrypted recovery fixture",
    );
    expect(restore?.run).toContain(
      "./node_modules/.bin/tsx __tests__/helpers/prepare-neutral-recovery-ci-runtime.mts",
    );
    expect(restore?.run).toContain(
      '"$source_runtime" /usr/lib/postgresql/17/bin/pg_config',
    );
    expect(restore?.run).toContain(
      '"$target_runtime" /usr/lib/postgresql/${{ matrix.postgres }}/bin/pg_config',
    );
    expect(restore?.run).not.toMatch(/\bsudo\b|stage-neutral-production/);
    expect(workflow).not.toMatch(/ot-neutral-postgresql|ot-neutral-pg/);
  });

  it("keeps the ownership exception explicit and structurally test-only", () => {
    expect(existsSync(join(root, helperPath))).toBe(true);
    expect(helperPath.startsWith("__tests__/helpers/")).toBe(true);
    expect(helper).toContain('import { createRequire } from "node:module"');
    expect(helper).toContain("const require = createRequire(import.meta.url)");
    expect(helper).toContain(
      '"../../scripts/neutral-production-extension-fixture-files"',
    );
    expect(helper).toContain('"../../scripts/trusted-executable"');
    expect(helper).toContain(
      "testOnlyOwnershipPolicy: unitTestTrustedExecutablePolicy(process.getuid())",
    );
    expect(helper).not.toMatch(/process\.env|NODE_ENV/);
    expect(productionStage).not.toMatch(
      /unitTestTrustedExecutablePolicy|testOnlyOwnershipPolicy|prepare-neutral-recovery-ci-runtime/,
    );
    expect(
      packageScripts["neutral-report:production-recovery-extension-fixture"],
    ).toBe(
      "tsx scripts/stage-neutral-production-recovery-extension-fixture.ts",
    );
  });

  it("loads through the same tsx executable before rejecting missing argv", () => {
    const result = spawnSync(
      join(root, "node_modules/.bin/tsx"),
      [helperPath],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Synthetic recovery fixture preparation requires runtime-root and pg-config arguments",
    );
    expect(result.stderr).not.toContain("does not provide an export named");
  });

  it("does not promote the synthetic matrix into native or Production evidence", () => {
    expect(helper).toContain("synthetic recovery fixture portability: PASS");
    expect(helper).not.toMatch(/native|receipt|release|pin/i);
    expect(JSON.stringify(recoveryJob())).not.toMatch(
      /OT_NEUTRAL_PRODUCTION_NATIVE|DATABASE_URL|secrets\./,
    );
  });
});
