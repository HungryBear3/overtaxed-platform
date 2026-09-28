import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  createQualificationHarness,
  createRunId,
  PINNED,
  QualificationRefusal,
  resolveQualificationTarget,
  RUN_ID,
  sha256,
  type HarnessPorts,
  type Journal,
  type JournalStore,
  type SourceFacts,
  type TargetMode,
} from "@/lib/social/official-calendar-qualification";

/**
 * Operator entry for [[createQualificationHarness]]. Credentials come only
 * from the environment; argv is restricted to commands, a mode, a run ID and a
 * run directory outside the repository, and anything that looks like a URL,
 * credential or assignment is refused before the environment is even read.
 */

export const COMMANDS = [
  "preflight",
  "run",
  "resume",
  "cleanup",
  "status",
  "verify",
] as const;
export type Command = (typeof COMMANDS)[number];
export type CliArgs = {
  command: Command;
  mode: TargetMode;
  runDir: string | null;
  runId: string | null;
};

export class UsageError extends Error {}
const SAFE_ARG = /^[A-Za-z0-9._/~-]+$/;

export function parseQualificationArgs(argv: readonly string[]): CliArgs {
  for (const arg of argv)
    if (!SAFE_ARG.test(arg) || arg.includes("://") || arg.length > 512)
      throw new UsageError(
        "Refused argument: argv may carry only a command, flags, a run ID and a path",
      );
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command as Command))
    throw new UsageError(`Command must be one of: ${COMMANDS.join(", ")}`);
  const args: CliArgs = {
    command: command as Command,
    mode: "isolated-preview",
    runDir: null,
    runId: null,
  };
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (value === undefined || value.startsWith("--"))
      throw new UsageError(`Flag ${flag} needs a value`);
    if (
      flag === "--mode" &&
      (value === "isolated-preview" || value === "local-rehearsal")
    )
      args.mode = value;
    else if (flag === "--run-dir") args.runDir = value;
    else if (flag === "--run-id" && RUN_ID.test(value)) args.runId = value;
    else throw new UsageError(`Unknown or invalid flag ${flag}`);
  }
  const needsDir = args.command !== "preflight";
  const needsId = ["resume", "cleanup", "status", "verify"].includes(
    args.command,
  );
  if (needsDir && !args.runDir) throw new UsageError("--run-dir is required");
  if (needsId && !args.runId) throw new UsageError("--run-id is required");
  if (args.command === "run" && args.runId)
    throw new UsageError("run mints its own run ID; use resume");
  return args;
}

/** Evidence lives outside the repository so it can never be committed by accident. */
export function assertRunDir(runDir: string, repoRoot: string): string {
  const resolved = path.resolve(runDir);
  if (!path.isAbsolute(runDir))
    throw new UsageError("--run-dir must be absolute");
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative)))
    throw new UsageError("--run-dir must be outside the repository");
  return resolved;
}

/** Atomic 0600 files in a 0700 directory; `*.tmp` are the only temporary artifacts. */
export function fileJournal(dir: string): JournalStore & { dir: string } {
  const write = async (name: string, text: string) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(
      dir,
      `.${name}.${randomBytes(6).toString("hex")}.tmp`,
    );
    await fs.writeFile(tmp, text, { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, path.join(dir, name));
  };
  return {
    dir,
    async read() {
      try {
        return JSON.parse(
          await fs.readFile(path.join(dir, "journal.json"), "utf8"),
        ) as Journal;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new QualificationRefusal(
          "journal_mismatch",
          "Journal is unreadable; nothing was changed",
        );
      }
    },
    async write(journal) {
      await write("journal.json", `${JSON.stringify(journal, null, 2)}\n`);
    },
    async writeReceipt(receipt, digest) {
      await write("receipt.json", receipt);
      await write("receipt.sha256", `${digest}  receipt.json\n`);
    },
    async removeTemporary() {
      let removed = 0;
      for (const name of await fs.readdir(dir).catch(() => [] as string[]))
        if (name.endsWith(".tmp")) {
          await fs.rm(path.join(dir, name), { force: true });
          removed++;
        }
      return removed;
    },
  };
}

/** An untrusted receipt file, probed field by field. */
type ReceiptProbe = {
  phases?: {
    proof?: {
      evidence?: {
        rendered?: { renderedText?: unknown };
        sourceContentSha256?: unknown;
      };
    };
    cleanup?: { absentOnFreshConnection?: unknown };
    defaultOff?: { checks?: Record<string, unknown> };
  };
};

/** Offline receipt check: digest, journal binding, and the pinned outcome. */
export async function verifyReceipt(
  dir: string,
): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  const read = (name: string) =>
    fs.readFile(path.join(dir, name), "utf8").catch(() => null);
  const [receipt, digestLine, journalText] = await Promise.all([
    read("receipt.json"),
    read("receipt.sha256"),
    read("journal.json"),
  ]);
  if (!receipt || !digestLine || !journalText)
    return { ok: false, problems: ["receipt_or_journal_missing"] };
  const digest = sha256(receipt);
  if (digestLine.split(/\s+/)[0] !== digest)
    problems.push("receipt_digest_mismatch");
  let journal: Journal;
  let parsed: ReceiptProbe;
  try {
    journal = JSON.parse(journalText) as Journal;
    parsed = JSON.parse(receipt);
  } catch {
    return {
      ok: false,
      problems: [...problems, "receipt_or_journal_unparseable"],
    };
  }
  if (journal.receiptSha256 !== digest)
    problems.push("journal_receipt_mismatch");
  if (canonicalJson(parsed) !== receipt) problems.push("receipt_not_canonical");
  const proof = parsed.phases?.proof?.evidence;
  if (proof?.rendered?.renderedText !== PINNED.renderedText)
    problems.push("rendered_text_mismatch");
  if (proof?.sourceContentSha256 !== PINNED.fixtureSha256)
    problems.push("source_digest_mismatch");
  if (parsed.phases?.cleanup?.absentOnFreshConnection !== true)
    problems.push("cleanup_unproven");
  const off = parsed.phases?.defaultOff?.checks;
  if (
    !off?.routeNotFound ||
    !off?.storeDisabled ||
    !off?.snapshotKeysAbsent ||
    !off?.flagsUnsetInProcess
  )
    problems.push("default_off_unproven");
  return { ok: problems.length === 0, problems };
}

export type CliDeps = {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  repoRoot: string;
  source(): SourceFacts;
  /** Wires the real store, route, collector and database for a validated target. */
  ports(
    resolved: ReturnType<typeof resolveQualificationTarget>,
    journal: JournalStore,
  ): Promise<HarnessPorts>;
  preflightDb(
    resolved: ReturnType<typeof resolveQualificationTarget>,
  ): Promise<HarnessPorts["openDb"]>;
  out(line: string): void;
};

export async function runQualificationCli(deps: CliDeps): Promise<number> {
  let args: CliArgs;
  try {
    args = parseQualificationArgs(deps.argv);
  } catch (error) {
    deps.out(`USAGE ${(error as Error).message}`);
    return 2;
  }
  try {
    const dir = args.runDir ? assertRunDir(args.runDir, deps.repoRoot) : null;
    if (args.command === "status" || args.command === "verify") {
      const runDir = path.join(dir!, args.runId!);
      if (args.command === "verify") {
        const { ok, problems } = await verifyReceipt(runDir);
        deps.out(ok ? "verify: PASS" : `verify: FAIL ${problems.join(",")}`);
        return ok ? 0 : 1;
      }
      const journal = await fileJournal(runDir).read();
      if (!journal)
        throw new QualificationRefusal(
          "journal_missing",
          "No journal for this run",
        );
      deps.out(
        `status: ${Object.keys(journal.phases).join(" > ") || "created"}` +
          ` | failures: ${journal.failures.map((f) => `${f.phase}:${f.code}`).join(",") || "none"}` +
          ` | receipt: ${journal.receiptSha256 ?? "none"}`,
      );
      return 0;
    }
    const resolved = resolveQualificationTarget(deps.env, args.mode);
    const secrets = [resolved.connectionString, resolved.password];
    if (args.command === "preflight") {
      const harness = createQualificationHarness(
        { openDb: await deps.preflightDb(resolved) } as HarnessPorts,
        {
          runId: createRunId(),
          target: resolved.target,
          secrets,
          source: deps.source(),
          requireCleanSource: false,
        },
      );
      await harness.preflight();
      deps.out(
        `preflight: PASS mode=${args.mode} fingerprint=${resolved.target.fingerprint}`,
      );
      return 0;
    }
    const runId = args.runId ?? createRunId();
    const journal = fileJournal(path.join(dir!, runId));
    if (args.command !== "run" && !(await journal.read()))
      throw new QualificationRefusal(
        "journal_missing",
        "No journal for this run; nothing was changed",
      );
    deps.out(`run-id: ${runId}`);
    const harness = createQualificationHarness(
      await deps.ports(resolved, journal),
      {
        runId,
        target: resolved.target,
        secrets,
        source: deps.source(),
        requireCleanSource: args.mode === "isolated-preview",
      },
    );
    const outcome =
      args.command === "cleanup"
        ? await harness.recover()
        : await harness.run();
    deps.out(
      `${args.command}: PASS phase=${outcome.phase} receipt=${outcome.receiptSha256 ?? "none"} dir=${journal.dir}`,
    );
    return 0;
  } catch (error) {
    if (error instanceof QualificationRefusal) {
      deps.out(
        `FAIL ${error.code}${error.detail ? `:${error.detail}` : ""}: ${error.message}`,
      );
      return 1;
    }
    if (error instanceof UsageError) {
      deps.out(`USAGE ${error.message}`);
      return 2;
    }
    // Driver errors can carry hosts or user names; only the class and code are shown.
    const code = (error as { code?: unknown })?.code;
    deps.out(
      `FAIL unexpected_error (${(error as Error)?.name ?? "Error"}${
        typeof code === "string" && /^[A-Z0-9_]{2,24}$/.test(code)
          ? ` ${code}`
          : ""
      })`,
    );
    return 1;
  }
}
