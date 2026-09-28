/**
 * Isolated-Preview qualification for the official-calendar preview consumer.
 * Operator packet: docs/ops/ot-official-calendar-preview-qualification-2026-09-27.md
 *
 * Run through `npm run official-calendar:preview-qualification -- <command>`;
 * the npm script supplies the acceptance tsconfig that maps `server-only`.
 * Credentials are read from the environment only and never leave this process:
 * child processes get PATH alone, and DATABASE_URL exists only in-process.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runQualificationCli } from "../lib/social/official-calendar-qualification-cli";
import { PINNED } from "../lib/social/official-calendar-qualification";
import { pgQualificationDb } from "../lib/social/official-calendar-qualification-pg";

const repoRoot = process.cwd();
// git sees PATH and nothing else: no credential reaches a child process.
const gitEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  NODE_ENV: "production",
};
const git = (...args: string[]) => {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    env: gitEnv,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
};

let databaseLoaded = false;

async function main() {
  const code = await runQualificationCli({
    argv: process.argv.slice(2),
    env: process.env,
    repoRoot,
    out: (line) => process.stdout.write(`${line}\n`),
    source: () => ({
      commit: git("rev-parse", "HEAD"),
      tree: git("rev-parse", "HEAD^{tree}"),
      clean:
        git("status", "--porcelain", "--untracked-files=normal") === "" &&
        git("rev-parse", "HEAD") !== "",
    }),
    preflightDb: async (resolved) => pgQualificationDb(resolved),
    ports: async (resolved, journal) => {
      // lib/db reads DATABASE_URL once, at first import; set it only now, in-process.
      process.env.DATABASE_URL = resolved.connectionString;
      databaseLoaded = true;
      const [
        { informationalSnapshotStore },
        collector,
        parser,
        informational,
        route,
      ] = await Promise.all([
        import("../lib/deadlines/informational-snapshot-store"),
        import("../lib/deadlines/collect-informational-snapshot"),
        import("../lib/deadlines/assessor-calendar-parser"),
        import("../lib/deadlines/informational-snapshot"),
        import("../app/api/internal/official-calendar-preview/route"),
      ]);
      const { fixtureFetch } =
        await import("../lib/social/official-calendar-qualification");
      return {
        env: process.env,
        openDb: pgQualificationDb(resolved),
        store: informationalSnapshotStore,
        capture: (bytes, now) =>
          collector.collectOfficialDeadlineCapture({
            fetchSource: fixtureFetch(
              bytes,
              informational.INFORMATIONAL_SOURCE_URL,
            ),
            parseHtml: parser.parseInformationalAssessorHtml,
            now: () => now,
          }),
        route: route.POST,
        fixture: async () =>
          new Uint8Array(
            await readFile(path.join(repoRoot, PINNED.fixturePath)),
          ),
        journal,
        now: () => new Date(),
        log: (line) => process.stdout.write(`${line}\n`),
      };
    },
  });
  if (databaseLoaded) {
    try {
      const { prisma } = await import("../lib/db");
      await prisma.$disconnect();
    } catch {
      /* The pool is already closed. */
    }
  }
  process.exit(code);
}

void main();
