/** @jest-environment node */

/**
 * Proofs for the isolation and portability layer.
 *
 * Separated from `governance-fixtures.test.ts` because that module is imported
 * across the governance family and Jest re-runs an imported suite's tests inside
 * each importer. Nothing imports this file, so these run once.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GOVERNANCE_SUITE_FILES,
  REPO_ROOT,
  controllerDeclaredPaths,
  copyIntoFixture,
  installRepoWriteGuard,
  lexiconPath,
  qaPacketDir,
  readAcceptanceMatrix,
  repoWriteViolation,
  withFixtureRoot,
  writeFixtureFile,
} from "./governance-fixtures.test"

describe("frozen artefacts resolve portably", () => {
  it("finds the QA packet without naming a user, home directory or absolute prefix", () => {
    const dir = qaPacketDir()
    expect(existsSync(join(dir, "acceptance-matrix.json"))).toBe(true)
  })

  it("binds the self-contained matrix fixture to the authoritative frozen hash", () => {
    const bytes = readFileSync(join(qaPacketDir(), "acceptance-matrix.json"))
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "6473de57f64a9fef778694c138ece2e0d3d50ac6ed670a6a5ce6b71c797f297b",
    )
  })

  it("no governance suite names an absolute local path", () => {
    // Comments are stripped first: prose may describe the defect, code may not
    // depend on it. An absolute path here is what bound these suites to a single
    // machine, so the scan covers the whole family rather than one file.
    const offenders: Array<{ file: string; line: string }> = []
    for (const file of GOVERNANCE_SUITE_FILES) {
      const src = readFileSync(join(REPO_ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
      for (const line of src.split("\n")) {
        // Assembled from fragments so the detector cannot match its own source.
        const ABSOLUTE = new RegExp(["/Us", "ers/|/ho", "me/|\\.open", "claw|works", "pace/rex"].join(""))
        if (ABSOLUTE.test(line)) {
          offenders.push({ file, line: line.trim() })
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("finds the canonical lexicon the same way, and it is the frozen document", () => {
    const doc = readFileSync(lexiconPath(), "utf8")
    expect(createHash("sha256").update(doc).digest("hex")).toBe(
      "a7577e68cdd07e79c16e6e53b786bbf579d73afd279e0e39c26ba2ad2932c499",
    )
  })

  it("reads the frozen packet without modifying it", () => {
    const dir = qaPacketDir()
    const before = readdirSync(dir)
      .sort()
      .map((f) => [f, createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")])
    controllerDeclaredPaths()
    readAcceptanceMatrix()
    const after = readdirSync(dir)
      .sort()
      .map((f) => [f, createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")])
    expect(after).toEqual(before)
  })

  it("declares the controller routes and surfaces the frozen packet carries", () => {
    const matrix = readAcceptanceMatrix()
    expect(matrix.accepted_routes).toHaveLength(53)
    expect(matrix.named_surfaces).toHaveLength(22)
  })
})

describe("resolution fails closed", () => {
  it("an absent packet names what was searched instead of reading as empty", async () => {
    await withFixtureRoot("absent", (root) => {
      expect(() => readAcceptanceMatrix(root)).toThrow(/"acceptance-matrix\.json" is missing/)
    })
  })

  it("a malformed packet is rejected rather than parsed into no declared routes", async () => {
    await withFixtureRoot("malformed", (root) => {
      writeFixtureFile(root, "acceptance-matrix.json", "{ not json")
      expect(() => readAcceptanceMatrix(root)).toThrow(/is not valid JSON/)

      writeFixtureFile(root, "acceptance-matrix.json", JSON.stringify({ named_surfaces: [] }))
      expect(() => readAcceptanceMatrix(root)).toThrow(/no "accepted_routes" array/)

      writeFixtureFile(
        root,
        "acceptance-matrix.json",
        JSON.stringify({ accepted_routes: [{ path: "/" }], named_surfaces: [{ nope: 1 }] }),
      )
      expect(() => readAcceptanceMatrix(root)).toThrow(/must carry a string "path"/)
    })
  })

  it("an environment override pointing nowhere is an error, not a silent fallback", () => {
    const previous = process.env.OT_QA_MATRIX_PATH
    process.env.OT_QA_MATRIX_PATH = join(tmpdir(), "ot-definitely-not-here")
    try {
      expect(() => qaPacketDir()).toThrow(/is set to .* but nothing exists there/)
    } finally {
      if (previous === undefined) delete process.env.OT_QA_MATRIX_PATH
      else process.env.OT_QA_MATRIX_PATH = previous
    }
  })

  it("an environment override is honoured when it does exist", async () => {
    const previous = process.env.OT_QA_MATRIX_PATH
    await withFixtureRoot("override", (root) => {
      const matrix = writeFixtureFile(
        root,
        "acceptance-matrix.json",
        JSON.stringify({ accepted_routes: [], named_surfaces: [] }),
      )
      process.env.OT_QA_MATRIX_PATH = matrix
      try {
        expect(qaPacketDir()).toBe(root)
      } finally {
        if (previous === undefined) delete process.env.OT_QA_MATRIX_PATH
        else process.env.OT_QA_MATRIX_PATH = previous
      }
    })
  })
})

describe("fixture trees clean up after themselves", () => {
  it("removes the fixture tree on the happy path", async () => {
    let captured = ""
    await withFixtureRoot("happy", (root) => {
      captured = root
      writeFixtureFile(root, "content/blog/probe.md", "probe")
      expect(existsSync(join(root, "content/blog/probe.md"))).toBe(true)
    })
    expect(existsSync(captured)).toBe(false)
  })

  it("removes the fixture tree even when the callback throws", async () => {
    let captured = ""
    await expect(
      withFixtureRoot("thrower", (root) => {
        captured = root
        writeFixtureFile(root, "app/zz/page.tsx", "export default () => null")
        throw new Error("deliberate failure inside a fixture mutation callback")
      }),
    ).rejects.toThrow(/deliberate failure/)
    expect(captured).not.toBe("")
    expect(existsSync(captured)).toBe(false)
  })

  it("gives every concurrent caller its own root", async () => {
    const roots = await Promise.all(
      Array.from({ length: 8 }, () => withFixtureRoot("unique", async (root) => root)),
    )
    expect(new Set(roots).size).toBe(roots.length)
  })

  it("leaves the repository untouched while a fixture is mutated", async () => {
    const before = createHash("sha256").update(readFileSync(join(REPO_ROOT, "lib/blog.ts"))).digest("hex")
    await withFixtureRoot("untouched", (root) => {
      copyIntoFixture(root, "lib/blog.ts")
      writeFixtureFile(root, "lib/blog.ts", "// mutated copy, not the real file")
      expect(readFileSync(join(root, "lib/blog.ts"), "utf8")).toMatch(/mutated copy/)
    })
    expect(createHash("sha256").update(readFileSync(join(REPO_ROOT, "lib/blog.ts"))).digest("hex")).toBe(before)
  })
})

describe("the repository write boundary is enforced, not merely intended", () => {
  it("rejects writes inside a simulated repository without touching the real checkout", async () => {
    await withFixtureRoot("guard-repo", (root) => {
      const fakeRepo = join(root, "repo")
      const probeFile = writeFixtureFile(fakeRepo, "content/blog/existing.md", "sentinel")
      const privacy = writeFixtureFile(fakeRepo, "app/privacy/page.tsx", "sentinel")
      const probeDir = join(fakeRepo, "app/zz-guard-route")
      const restore = installRepoWriteGuard(fakeRepo)
      try {
        expect(() => writeFileSync(probeFile, "changed", "utf8")).toThrow(
          /Repository write boundary violated: writeFileSync\("content\/blog\/existing\.md"\)/,
        )
        expect(() => rmSync(privacy)).toThrow(/write boundary violated: rmSync/)
        expect(() => mkdirSync(probeDir, { recursive: true })).toThrow(/write boundary violated: mkdirSync/)
      } finally {
        restore()
      }
      expect(readFileSync(probeFile, "utf8")).toBe("sentinel")
      expect(readFileSync(privacy, "utf8")).toBe("sentinel")
      expect(existsSync(probeDir)).toBe(false)
      expect(repoWriteViolation(probeFile, fakeRepo)).toBe("content/blog/existing.md")
      expect(repoWriteViolation(join(root, "outside.md"), fakeRepo)).toBeNull()
    })
  })

  it("still permits reads of the repository, which every derivation depends on", () => {
    const restore = installRepoWriteGuard()
    try {
      expect(readFileSync(join(REPO_ROOT, "lib/blog.ts"), "utf8")).toMatch(/getAllPosts/)
      expect(readdirSync(join(REPO_ROOT, "content/blog")).length).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })

  it("permits writes outside the repository, which is where fixtures live", async () => {
    const restore = installRepoWriteGuard()
    try {
      await withFixtureRoot("permitted", (root) => {
        writeFixtureFile(root, "content/blog/probe.md", "probe")
        expect(readFileSync(join(root, "content/blog/probe.md"), "utf8")).toBe("probe")
      })
    } finally {
      restore()
    }
  })
})
