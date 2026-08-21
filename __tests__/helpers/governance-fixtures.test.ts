/** @jest-environment node */

/**
 * Isolation and portability primitives for the governance suites.
 *
 * Two defects live here, both inherited:
 *
 * 1. **Shared-worktree mutation.** The blog and page-route mutation suites used
 *    to write, rename and delete files inside the real checkout — probe posts in
 *    `content/blog`, probe routes under `app/`, edited component sources — and
 *    revert them in `finally`. Reversion was byte-exact, but Jest's default
 *    parallel workers meant another worker was enumerating and reading that same
 *    tree at the same time. The result was a nondeterministic `npx jest`
 *    (`ENOENT` on a transient probe, drifting test totals) that only passed
 *    under `--runInBand`, and a crash mid-mutation would have left a real source
 *    file corrupted. The fix is structural, not serialisation: every mutation
 *    now happens in a fresh per-test temporary tree that no other worker can
 *    see, so there is no window to race and no real file to corrupt.
 *
 * 2. **Absolute-path binding.** The suites read the frozen QA packet and the
 *    canonical lexicon through hardcoded home-directory paths, so they could
 *    only ever pass on one machine, from one checkout, under one username.
 *    Resolution here is relative to the repository plus an environment override,
 *    and fails closed with a deterministic message when the artefact is absent
 *    or malformed.
 *
 * It lives under `__tests__` and carries its own tests because Jest's `testMatch`
 * treats every file in this tree as a suite — the same reason
 * `banned-claims.test.ts` does. What is worth proving about an isolation helper
 * is exactly that it isolates: the tests below cover fail-closed resolution,
 * cleanup after a thrown assertion, and the write boundary itself.
 *
 * Nothing here reads or writes the authoritative `qa/` packet. It is opened
 * read-only and never copied, re-hashed, re-stamped or chmod'd.
 */
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"

export const REPO_ROOT = resolve(__dirname, "../..")

/**
 * The suites bound to the frozen packet or the lexicon, or that mutate to prove
 * a governance invariant. The portability scan below covers all of them.
 */
export const GOVERNANCE_SUITE_FILES = [
  "__tests__/helpers/governance-fixtures.test.ts",
  "__tests__/lexicon/banned-claims.test.ts",
  "__tests__/blog/served-blog-governance.test.ts",
  "__tests__/blog/served-blog-governance-mutations.test.ts",
  "__tests__/acceptance/page-route-rules.test.tsx",
  "__tests__/acceptance/page-route-governance.test.tsx",
  "__tests__/acceptance/page-route-governance-mutations.test.tsx",
  "__tests__/acceptance/governed-public-surfaces.test.tsx",
  "__tests__/acceptance/named-surfaces.test.tsx",
  "__tests__/acceptance/freshness-corpus.test.tsx",
]

/* ── Portable resolution of frozen external artefacts ─────────────────────── */

/**
 * Self-contained, exact-byte test fixtures.
 *
 * The authoritative controller packet remains external and read-only. Tests use
 * exact-byte fixture copies pinned to the authoritative source hashes, so a Git
 * archive or checkout at any path has everything needed to run. Operators still
 * verify the live controller packet separately with its own checksums/runner.
 */
const GOVERNANCE_FIXTURES = join(REPO_ROOT, "__tests__/fixtures/governance")
const QA_MATRIX_FIXTURE = join(GOVERNANCE_FIXTURES, "acceptance-matrix.json")
const LEXICON_FIXTURE = join(GOVERNANCE_FIXTURES, "04-CANONICAL-COPY-AND-BANNED-CLAIMS.md")

function resolveFixture(defaultPath: string, envVar: string, what: string): string {
  const override = process.env[envVar]
  if (override) {
    if (!existsSync(override)) {
      throw new Error(
        `${what}: ${envVar} is set to "${override}" but nothing exists there. ` +
          `Unset it to fall back to repository-relative resolution.`,
      )
    }
    return override
  }
  if (!existsSync(defaultPath)) {
    throw new Error(
      `${what}: self-contained test fixture is missing at "${defaultPath}". ` +
        `Restore the hash-pinned fixture or set ${envVar} to an explicit test fixture.`,
    )
  }
  return defaultPath
}

/** The frozen QA packet directory. Read-only; never written, copied or re-stamped. */
export function qaPacketDir(): string {
  const matrix = resolveFixture(QA_MATRIX_FIXTURE, "OT_QA_MATRIX_PATH", "Frozen QA matrix")
  return dirname(matrix)
}

/** The canonical banned-claims document the lexicon is bound to. */
export function lexiconPath(): string {
  return resolveFixture(LEXICON_FIXTURE, "OT_LEXICON_PATH", "Canonical banned-claims lexicon")
}

export type AcceptanceMatrix = {
  accepted_routes: Array<{ path: string }>
  named_surfaces: Array<{ path: string }>
}

/**
 * The frozen acceptance matrix, parsed and shape-checked.
 *
 * Fails closed and loudly: an absent, unparseable or structurally wrong packet
 * must never read as "no declared routes", which would silently turn every
 * controller-declared page into an ungoverned one and pass reconciliation.
 */
export function readAcceptanceMatrix(dir: string = qaPacketDir()): AcceptanceMatrix {
  const path = join(dir, "acceptance-matrix.json")
  if (!existsSync(path)) {
    throw new Error(`Frozen QA packet: "acceptance-matrix.json" is missing from "${dir}".`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    throw new Error(`Frozen QA packet: "${path}" is not valid JSON (${(err as Error).message}).`)
  }
  const matrix = parsed as AcceptanceMatrix
  for (const key of ["accepted_routes", "named_surfaces"] as const) {
    if (!Array.isArray(matrix?.[key])) {
      throw new Error(`Frozen QA packet: "${path}" has no "${key}" array — the packet is malformed.`)
    }
    if (!matrix[key].every((entry) => typeof entry?.path === "string")) {
      throw new Error(`Frozen QA packet: every "${key}" entry must carry a string "path" — the packet is malformed.`)
    }
  }
  return matrix
}

/** Route and surface paths the frozen controller declares. */
export function controllerDeclaredPaths(dir?: string): Set<string> {
  const matrix = readAcceptanceMatrix(dir)
  return new Set([...matrix.accepted_routes.map((r) => r.path), ...matrix.named_surfaces.map((s) => s.path)])
}

/* ── Per-test temporary fixture trees ─────────────────────────────────────── */

/**
 * Run `body` against a fresh temporary root, removed afterwards no matter what.
 *
 * The root is created through `mkdtempSync` under the OS temp directory, so it
 * is unique per call and never collides between parallel workers. Removal is in
 * `finally`, so a thrown assertion cleans up as thoroughly as a passing one —
 * proven by "removes the fixture tree even when the callback throws" below.
 */
export async function withFixtureRoot<T>(prefix: string, body: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), `ot-${prefix}-`))
  try {
    return await body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** Write a file into the fixture, creating parent directories as needed. */
export function writeFixtureFile(root: string, rel: string, contents: string): string {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents, "utf8")
  return path
}

/**
 * Copy source bytes from the repository into the fixture.
 *
 * Used wherever fidelity matters — real posts, the real `robots.ts` — so the
 * fixture exercises the same bytes production does. The repository copy is only
 * ever read.
 */
export function copyIntoFixture(root: string, rel: string, fromRoot: string = REPO_ROOT): string {
  const dest = join(root, rel)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(join(fromRoot, rel), dest)
  return dest
}

/** Copy every file in a repository directory into the same relative place in the fixture. */
export function copyDirIntoFixture(root: string, relDir: string, filter: (name: string) => boolean = () => true): string[] {
  const from = join(REPO_ROOT, relDir)
  mkdirSync(join(root, relDir), { recursive: true })
  const copied: string[] = []
  for (const name of readdirSync(from).sort()) {
    if (!statSync(join(from, name)).isFile() || !filter(name)) continue
    copyFileSync(join(from, name), join(root, relDir, name))
    copied.push(name)
  }
  return copied
}

/* ── Write boundary ───────────────────────────────────────────────────────── */

const WRITE_METHODS = [
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmSync",
  "rmdirSync",
  "unlinkSync",
  "copyFileSync",
  "renameSync",
  "truncateSync",
  "writeSync",
  "openSync",
] as const

/** Paths a write may legitimately touch inside the repository root. */
const WRITE_ALLOWED = [`${sep}node_modules${sep}`, `${sep}.next${sep}`, `${sep}.git${sep}`, `${sep}.swc${sep}`]

export function repoWriteViolation(target: unknown, repoRoot: string = REPO_ROOT): string | null {
  if (typeof target !== "string") return null
  const abs = resolve(target)
  const rel = relative(repoRoot, abs)
  if (rel.startsWith("..") || rel === "" || resolve(repoRoot, rel) !== abs) return null
  if (WRITE_ALLOWED.some((allowed) => `${sep}${rel}`.includes(allowed))) return null
  return rel
}

/**
 * Fail any test that writes inside the repository.
 *
 * This is the structural half of the fix. The suites are written to use fixture
 * trees, and this makes that binding enforced rather than conventional: if a
 * future edit reaches for a real path, the test dies at the call site naming the
 * file, instead of silently reintroducing the race for another suite to trip
 * over. Installed for the whole file by `guardRepoWrites()`.
 */
export function installRepoWriteGuard(repoRoot: string = REPO_ROOT): () => void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as Record<string, unknown>
  const original = new Map<string, unknown>()
  for (const method of WRITE_METHODS) {
    const fn = fs[method]
    if (typeof fn !== "function") continue
    original.set(method, fn)
    fs[method] = function guarded(this: unknown, ...args: unknown[]) {
      // `openSync`/`writeSync` only offend when opening for writing.
      if (method === "openSync") {
        const flags = String(args[1] ?? "r")
        if (!/[wa+]/.test(flags)) return (fn as (...a: unknown[]) => unknown).apply(this, args)
      }
      // Which argument names the thing being written varies: `copyFileSync`
      // reads its first path and writes its second, `renameSync` mutates both
      // ends, and everything else writes its first. Reading a repository file
      // into a fixture is exactly what the fixtures are built from, so only the
      // written side is guarded.
      const written =
        method === "copyFileSync" ? [args[1]] : method === "renameSync" ? [args[0], args[1]] : [args[0]]
      if (method !== "writeSync") {
        for (const target of written) {
          const offender = repoWriteViolation(target, repoRoot)
          if (offender) {
            throw new Error(
              `Repository write boundary violated: ${method}("${offender}"). ` +
                `Governance mutation tests must operate on a temporary fixture tree, never the real checkout.`,
            )
          }
        }
      }
      return (fn as (...a: unknown[]) => unknown).apply(this, args)
    }
  }
  return () => {
    for (const [method, fn] of original) fs[method] = fn
  }
}

/** Install the repository write guard for the lifetime of the calling suite. */
export function guardRepoWrites(): void {
  let restore: (() => void) | null = null
  beforeAll(() => {
    restore = installRepoWriteGuard()
  })
  afterAll(() => {
    restore?.()
    restore = null
  })
}

/* ── Smoke ────────────────────────────────────────────────────────────────── */

/**
 * This file is imported by most of the governance family, and Jest re-runs an
 * imported suite's tests inside every importer. So it carries one cheap
 * assertion; the real proofs live in `isolation-and-portability.test.ts`, which
 * nothing imports and which therefore runs exactly once.
 */
describe("governance fixture helpers load", () => {
  it("resolves the frozen packet from the repository, without an absolute path", () => {
    expect(existsSync(join(qaPacketDir(), "acceptance-matrix.json"))).toBe(true)
  })
})
