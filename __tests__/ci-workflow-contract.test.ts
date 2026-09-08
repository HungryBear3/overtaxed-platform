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

type Step = {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}
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
    it("uses Node 24 because Prisma 7 requires Node 22.12 or newer and Vercel production runs 24", () => {
      const setupNode = steps().find((step) => step.uses === "actions/setup-node@v4")
      expect(setupNode?.with?.["node-version"]).toBe("24")
    })

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

    it("triggers on pull_request and never on pull_request_target", () => {
      // pull_request_target runs in the BASE repository's context: it gets a
      // writable token and access to secrets, while the ref being tested is
      // the fork's. Combined with a checkout of the PR head that is arbitrary
      // code execution with the repository's own credentials. A gate that runs
      // untrusted contributor code must stay on pull_request.
      const triggers = Object.keys(workflow().on ?? {})
      expect(triggers).toContain("pull_request")
      expect(triggers).not.toContain("pull_request_target")
    })

    it("checks out without leaving credentials behind in the git config", () => {
      // actions/checkout persists the token into .git/config by default, where
      // every later step — including anything a dependency's lifecycle script
      // reaches — can reuse it to push. Nothing here writes to the repository,
      // so the credential should not outlive the checkout.
      const checkouts = steps().filter((step) => step.uses?.startsWith("actions/checkout"))
      expect(checkouts).not.toHaveLength(0)
      for (const checkout of checkouts) {
        expect(checkout.with?.["persist-credentials"]).toBe(false)
      }
    })

    it("uses only the first-party actions this gate needs", () => {
      // An allowlist rather than a denylist: a third-party action is opaque
      // code running with the job's token, and a deploy or publish action
      // smuggled in as a `uses:` would bypass every `run:`-based check below.
      const allowed = ["actions/checkout", "actions/setup-node"]
      const used = steps().flatMap((step) => (step.uses ? [step.uses] : []))
      expect(used).not.toHaveLength(0)
      expect(used.filter((ref) => !allowed.includes(ref.split("@")[0]))).toEqual([])
    })

    it("runs no database migration or schema mutation", () => {
      // Broader than `prisma migrate`, because that is only the spelling this
      // repo happens to use: every one of these mutates a live schema, and
      // package.json defines db:migrate, db:push and db:reset as one-word paths
      // to exactly that.
      const migration =
        /prisma\s+(migrate|db\s+(push|execute|seed|pull))|migrate\s+(deploy|dev|reset|resolve)|\bdb:(migrate|push|reset|baseline)\b|enforce-rls/
      expect(commands().filter((command) => migration.test(command))).toEqual([])
    })

    it("invokes no database, provider or deployment CLI", () => {
      // The gate builds and tests; it never reaches a running service. `npm ci`
      // legitimately talks to the registry, so this targets the specific tools
      // that would touch a database, a vendor account, or a deployment — not
      // network access in general.
      const services =
        /\b(psql|pg_dump|pg_restore|mysql|redis-cli|supabase|vercel|netlify|fly|heroku|stripe|resend|sendgrid|aws|gcloud|az|docker|ssh|scp|gh)\s/
      expect(commands().filter((command) => services.test(command))).toEqual([])
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
