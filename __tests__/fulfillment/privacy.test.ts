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

// Loader identifiers that a pure data helper must never reference in ANY form
// (as a callee, a value, an alias RHS, or inside a comma/parenthesized callee).
const LOADER_IDENTIFIERS = new Set([
  "require",
  "createRequire",
  "eval",
  "Function",
  "Reflect",
]);
// Global objects whose dynamic member access can reach a loader (e.g. globalThis["require"]).
const GLOBAL_OBJECTS = new Set([
  "globalThis",
  "window",
  "self",
  "global",
  "module",
]);

/**
 * AST purity check (TypeScript compiler API — node kinds, not regex). Returns a
 * list of impurity findings for a source. It is a conservative FIRST-PARTY tripwire
 * over pure helper files (which reference none of these constructs) and FAILS
 * CLOSED on direct AND indirect module loading:
 *   - a static import/export of a forbidden module/subpath;
 *   - ANY dynamic `import(...)`, regardless of the argument form;
 *   - ANY reference to a loader identifier (`require`, `createRequire`, `eval`,
 *     `Function`, `Reflect`) as a value or callee — so `require(...)`,
 *     `(0, require)(...)`, `const r = require`, `Function("…")`, `Reflect.get(…)`
 *     are all caught, not merely a bare `require(...)` callee;
 *   - a `.require` / `.createRequire` member access (e.g. `module.require`);
 *   - element access on a global object (e.g. `globalThis[k](...)`), any argument;
 *   - a string-literal `"require"`/`"createRequire"` call/reflection argument.
 * Comments and ordinary strings that merely mention a module name are ignored
 * because only AST nodes (not raw text) are inspected. Catching every conceivable
 * indirect load is undecidable; this decidably rejects every syntactic loader form
 * while leaving pure, loader-free source (all real lib files) with zero findings.
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
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      findings.push("dynamic-import"); // any dynamic import, any argument
    } else if (ts.isIdentifier(node) && LOADER_IDENTIFIERS.has(node.text)) {
      // Any reference to a loader identifier (callee, value, alias, comma-expr).
      findings.push(`loader-identifier:${node.text}`);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === "require" || node.name.text === "createRequire")
    ) {
      findings.push(`member-loader:${node.name.text}`);
    } else if (ts.isElementAccessExpression(node)) {
      const obj = node.expression;
      const arg = node.argumentExpression;
      const argIsLiteral = arg !== undefined && ts.isStringLiteral(arg);
      if (
        ts.isIdentifier(obj) &&
        GLOBAL_OBJECTS.has(obj.text) &&
        !argIsLiteral
      ) {
        // A dynamic (non-literal) key on a global object could resolve to a loader.
        findings.push("global-dynamic-element-access");
      }
      if (arg && ts.isStringLiteral(arg) && LOADER_IDENTIFIERS.has(arg.text))
        findings.push(`element-loader-string:${arg.text}`);
    } else if (ts.isCallExpression(node)) {
      // A string-literal loader name passed to a call (e.g. Reflect.get(globalThis, "require")).
      for (const a of node.arguments) {
        if (
          ts.isStringLiteral(a) &&
          (a.text === "require" || a.text === "createRequire")
        ) {
          findings.push(`loader-string-arg:${a.text}`);
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
    // Indirect loader forms (reviewer-found evasions of the prior guard):
    ["comma-expression require callee", `(0, require)("resend")`],
    ["require aliased to a value", `const r = require; r("resend")`],
    [
      "identifier-keyed global element access",
      `const k = "require"; globalThis[k]("resend")`,
    ],
    ["Function constructor loader", `Function("return require")()("resend")`],
    ["eval loader", `eval("require")("resend")`],
    ["Reflect.get loader", `Reflect.get(globalThis, "require")("resend")`],
    [
      "destructured require from module call",
      `const { createRequire } = require("module")`,
    ],
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
    // Ordinary indirect calls must NOT false-positive:
    ["an IIFE", `const v = (function () { return 1 })()`],
    [
      "a comma-expression call to a safe callee",
      `const v = (0, Math.max)(1, 2)`,
    ],
    ["a member call like arr.map", `const v = [1, 2].map((x) => x + 1)`],
    [
      "a global element access to a non-loader key",
      `const v = globalThis["JSON"]`,
    ],
    [
      "a string that merely equals a loader name in non-call position",
      `export const name = "require"`,
    ],
  ])("ignores %s (no false positive)", (_label, src) => {
    expect(findImpurities(src)).toEqual([]);
  });
});
