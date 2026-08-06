/**
 * @jest-environment node
 *
 * Matrix row 14: no PII / secrets / raw provider payloads may appear in the new
 * evidence schema fields or in the fulfillment library source. Content locators
 * must be private, never public bearer URLs.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import * as ts from "typescript";

const ROOT = process.cwd();

// Modules that are forbidden as STATIC import/export specifiers.
const FORBIDDEN_STATIC = [
  "@/lib/db",
  "@prisma/client",
  "next/server",
  "stripe",
  "resend",
  "nodemailer",
  "@vercel/blob",
  // Loader-construction sources: importing these enables createRequire etc.
  "module",
  "node:module",
];

/** True if `specifier` is exactly a forbidden module or a subpath of one. */
function isForbiddenStatic(specifier: string): boolean {
  return FORBIDDEN_STATIC.some(
    (m) => specifier === m || specifier.startsWith(`${m}/`),
  );
}

/**
 * AST purity check (TypeScript compiler API — node kinds, not regex). Returns a
 * list of impurity findings for a source. It FAILS CLOSED:
 *   - a static import/export of a forbidden module/subpath is a finding;
 *   - ANY dynamic `import(...)` is a finding, regardless of the argument form
 *     (string, no-substitution template, identifier, concatenation, conditional);
 *   - direct or property/element-form `require(...)` is a finding, any argument;
 *   - `createRequire(...)` (identifier or property form) is a finding.
 * Comments and ordinary strings that merely mention a module name are ignored
 * because only AST import/export/call nodes are inspected.
 */
function findImpurities(source: string): string[] {
  const sf = ts.createSourceFile(
    "probe.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const findings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (isForbiddenStatic(node.moduleSpecifier.text))
        findings.push(`static-import:${node.moduleSpecifier.text}`);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (isForbiddenStatic(node.moduleSpecifier.text))
        findings.push(`static-export:${node.moduleSpecifier.text}`);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        findings.push("dynamic-import"); // any dynamic import, any argument
      } else if (ts.isIdentifier(callee)) {
        if (callee.text === "require") findings.push("require-call");
        if (callee.text === "createRequire")
          findings.push("createRequire-call");
      } else if (ts.isPropertyAccessExpression(callee)) {
        if (callee.name.text === "require")
          findings.push("require-property-call");
        if (callee.name.text === "createRequire")
          findings.push("createRequire-property-call");
      } else if (ts.isElementAccessExpression(callee)) {
        const arg = callee.argumentExpression;
        if (
          arg &&
          ts.isStringLiteral(arg) &&
          (arg.text === "require" || arg.text === "createRequire")
        ) {
          findings.push("require-element-call");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}
const SCHEMA = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
const MARKER = "OT T2 DELIVERY-EVIDENCE";

// The additive block, comment lines stripped, lowercased. We scan actual schema
// content (enums, model fields) — not the documentation comments, which are free
// to describe the very things the fields must never contain ("no bearer URLs").
function newSchemaBlock(): string {
  const idx = SCHEMA.indexOf(MARKER);
  expect(idx).toBeGreaterThan(-1);
  return SCHEMA.slice(idx)
    .split("\n")
    .filter(
      (line) => !line.trim().startsWith("//") && !line.trim().startsWith("///"),
    )
    .join("\n")
    .toLowerCase();
}

describe("new evidence schema carries no PII / secrets / payloads / public URLs", () => {
  // Field-name substrings that would indicate PII, a secret, a raw payload, raw
  // artifact bytes, or a public URL leaking into the durable evidence. A byte
  // *size* count (byteSize) is required by the spec and is intentionally allowed;
  // only raw-*bytes* storage names are forbidden.
  const forbidden = [
    "email",
    "address",
    "pin",
    "url",
    "pdfbytes",
    "rawbytes",
    "artifactbytes",
    "filebytes",
    "rawpayload",
    "payload",
    "secret",
    "bearer",
    "downloadtoken",
    "authtoken",
    "reviewtoken",
    "stacktrace",
    "firstname",
    "lastname",
  ];

  it.each(forbidden)("does not reference %s in any new model field", (word) => {
    expect(newSchemaBlock().includes(word)).toBe(false);
  });

  it("stores a private storage locator, not a public blob URL", () => {
    const block = newSchemaBlock();
    expect(block.includes("storagelocator")).toBe(true);
    expect(block.includes("bloburl")).toBe(false);
    expect(block.includes("pdfurl")).toBe(false);
  });

  it("stores a lowercase SHA-256 field for content addressing", () => {
    expect(newSchemaBlock().includes("artifactsha256")).toBe(true);
  });
});

describe("fulfillment library is pure — no side-effecting or dynamic imports", () => {
  const dir = join(ROOT, "lib/fulfillment");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("has source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(
    readdirSync(join(ROOT, "lib/fulfillment")).filter((f) => f.endsWith(".ts")),
  )("%s has zero AST impurities", (file) => {
    const impurities = findImpurities(readFileSync(join(dir, file), "utf8"));
    expect(impurities).toEqual([]);
  });
});

describe("AST purity guard fails closed on dynamic / indirect loaders (blocker 2)", () => {
  const tick = "`"; // avoid nesting a template literal inside these fixtures
  it.each([
    ["no-substitution template dynamic import", `import(${tick}resend${tick})`],
    ["no-substitution template require", `require(${tick}resend${tick})`],
    ["module.require property form", `module.require("resend")`],
    ["globalThis.require property form", `globalThis.require("resend")`],
    ["element-access require", `globalThis["require"]("resend")`],
    ["dynamic import with identifier arg", `const m = "resend"; import(m)`],
    ["dynamic import with concatenation", `import("re" + "send")`],
    ["dynamic import with conditional", `import(true ? "resend" : "x")`],
    ["dynamic import of any path", `import("./whatever")`],
    ["direct require string", `require("resend")`],
    ["require with identifier arg", `const m = "resend"; require(m)`],
    [
      "createRequire call",
      `const r = createRequire(import.meta.url); r("resend")`,
    ],
    [
      "createRequire from node:module",
      `import { createRequire } from "node:module"`,
    ],
    [
      "createRequire aliased from module",
      `import { createRequire as cr } from "module"`,
    ],
    ["static default import", `import x from "resend"`],
    ["side-effect-only import", `import "resend"`],
    ["export-from", `export { send } from "resend"`],
    ["forbidden subpath", `import x from "resend/webhooks"`],
  ])("detects %s", (_label, src) => {
    expect(findImpurities(src).length).toBeGreaterThan(0);
  });

  it.each([
    [
      "a comment mentioning the module",
      `// never import "resend" here\nexport const x = 1`,
    ],
    [
      "a plain string mentioning the module",
      `export const note = "do not use resend or nodemailer"`,
    ],
    [
      "a similarly-named but different static module",
      `import x from "resender-safe"`,
    ],
    [
      "a normal internal static import",
      `import { foo } from "@/lib/fulfillment/types"`,
    ],
    [
      "a normal export-from internal",
      `export { foo } from "@/lib/fulfillment/types"`,
    ],
    [
      "a local function literally named requireSomething",
      `function requireApproval() { return 1 }\nrequireApproval()`,
    ],
  ])("ignores %s (no false positive)", (_label, src) => {
    expect(findImpurities(src)).toEqual([]);
  });
});
