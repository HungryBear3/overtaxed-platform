import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse, stringify } from "yaml"

/**
 * Nothing in the app imports the CI workflow — GitHub reads it, and only on a
 * push. That makes it the one file where a mistake stays invisible until the
 * gate it describes has already stopped gating: an npm script renamed out from
 * under it, a step reordered into a no-op, or a credential added to a job that
 * has never needed one.
 *
 * So this suite parses the workflow and asserts on resolved values rather than
 * matching source text, in both directions — what the gate has to do, and what
 * it must never reach for.
 */

const root = process.cwd()
const WORKFLOW = ".github/workflows/ci.yml"

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, unknown> }
type Job = { "runs-on"?: string; steps?: Step[]; env?: Record<string, unknown> }
type Workflow = {
  on?: Record<string, unknown>
  permissions?: unknown
  env?: Record<string, unknown>
  jobs?: Record<string, Job>
}

function source(): string {
  return readFileSync(join(root, WORKFLOW), "utf8")
}

function workflow(): Workflow {
  return parse(source()) as Workflow
}

/**
 * The workflow re-serialized from its parsed form: every value GitHub would
 * act on, and nothing GitHub would ignore. Scanning this instead of the raw
 * file lets a blanket search cover the places the typed helpers below do not
 * model — `with:` inputs, inline assignments inside a `run:` — without the
 * comments explaining a deliberate omission reading as the thing they omit.
 */
function effectiveSource(): string {
  return stringify(workflow())
}

function jobs(): Job[] {
  return Object.values(workflow().jobs ?? {})
}

function steps(): Step[] {
  return jobs().flatMap((job) => job.steps ?? [])
}

/** Every shell command the workflow would execute, in the order it runs them. */
function commands(): string[] {
  return steps().flatMap((step) => (typeof step.run === "string" ? [step.run] : []))
}

/** Every environment name the workflow binds, across all three scopes GitHub allows. */
function boundEnvNames(): string[] {
  const parsed = workflow()
  const scopes = [parsed.env, ...jobs().map((job) => job.env), ...steps().map((step) => step.env)]
  return scopes.flatMap((scope) => (scope ? Object.keys(scope) : []))
}

function commandIndex(pattern: RegExp): number {
  return commands().findIndex((command) => pattern.test(command))
}

const packageScripts: Record<string, string> = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
).scripts

describe("CI workflow", () => {
  it("exists at the path GitHub Actions reads", () => {
    expect(existsSync(join(root, WORKFLOW))).toBe(true)
  })

  it("declares at least one job", () => {
    expect(Object.keys(workflow().jobs ?? {})).not.toHaveLength(0)
  })

  it("runs on pull requests, so it gates before a merge rather than after one", () => {
    expect(Object.keys(workflow().on ?? {})).toContain("pull_request")
  })

  describe("gates", () => {
    it("installs from the committed lockfile with `npm ci`", () => {
      // `npm ci` is the install that refuses to run when package-lock.json and
      // package.json disagree, and that rebuilds node_modules from the lockfile
      // rather than resolving fresh. `npm install` would do neither.
      expect(commandIndex(/\bnpm ci\b/)).toBeGreaterThanOrEqual(0)
    })

    it("runs the build, type-check and test gates", () => {
      expect(commandIndex(/\bnpm run build\b/)).toBeGreaterThanOrEqual(0)
      expect(commandIndex(/\bnpm run type-check\b/)).toBeGreaterThanOrEqual(0)
      expect(commandIndex(/\bnpm (run )?test\b/)).toBeGreaterThanOrEqual(0)
    })

    it("builds before type-checking, so the gitignored next-env.d.ts exists first", () => {
      // This pins a deliberate ordering rather than a required one: tsc was
      // verified to pass on a cold tree with neither .next nor next-env.d.ts,
      // so the order is insurance against a future file needing Next's ambient
      // declarations. Swapping the steps is a decision, not a bug — but it
      // should be a decision someone makes on purpose, hence this assertion.
      const build = commandIndex(/\bnpm run build\b/)
      const typeCheck = commandIndex(/\bnpm run type-check\b/)
      expect(build).toBeGreaterThanOrEqual(0)
      expect(typeCheck).toBeGreaterThanOrEqual(0)
      expect(build).toBeLessThan(typeCheck)
    })

    it("invokes only npm scripts that package.json actually defines", () => {
      const invoked = commands().flatMap((command) =>
        [...command.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1])
      )
      expect(invoked).not.toHaveLength(0)
      expect(invoked.filter((script) => !(script in packageScripts))).toEqual([])
    })
  })

  describe("safety envelope", () => {
    it("requests no repository secret", () => {
      expect(effectiveSource()).not.toMatch(/secrets\./)
    })

    it("binds no database connection variable", () => {
      // The build needs none: prisma.config.ts falls back to a placeholder URL
      // when DATABASE_URL is unset, and no page reads the database while
      // prerendering. The test run needs none either — the four PostgreSQL
      // suites skip themselves unless TEST_DATABASE_URL is set, and setting it
      // would switch on suites that require a disposable live database.
      // The second assertion covers TEST_DATABASE_URL by construction.
      expect(boundEnvNames().filter((name) => name.includes("DATABASE_URL"))).toEqual([])
      expect(effectiveSource()).not.toMatch(/DATABASE_URL/)
    })

    it("runs no database migration", () => {
      expect(commands().filter((c) => /prisma\s+migrate|db:(migrate|push|reset)/.test(c))).toEqual([])
    })

    it("grants the workflow read-only access to the repository", () => {
      expect(workflow().permissions).toEqual({ contents: "read" })
    })

    it("does not invoke lint, which has no resolvable config in this repo", () => {
      // ESLint 9 resolves a flat `eslint.config.*` and none exists at any path,
      // so `npm run lint` would exit non-zero before linting a single file.
      // Wiring ESLint up is separate work, not something this gate absorbs.
      expect(commands().filter((command) => /npm run lint/.test(command))).toEqual([])
    })
  })
})
