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
  // Loader-construction / eval-equivalent / process-spawning sources.
  "module",
  "node:module",
  "vm",
  "node:vm",
  "worker_threads",
  "node:worker_threads",
  "child_process",
  "node:child_process",
];

/** True if `specifier` is exactly a forbidden module or a subpath of one. */
function isForbiddenStatic(specifier: string): boolean {
  return FORBIDDEN_STATIC.some(
    (m) => specifier === m || specifier.startsWith(`${m}/`),
  );
}

// Loader identifiers that a pure data helper must never reference in ANY form
// (callee, value, alias RHS, comma/parenthesized callee).
const LOADER_IDENTIFIERS = new Set([
  "require",
  "createRequire",
  "eval",
  "Function",
  "Reflect",
]);
// Runtime escape roots: the globals/objects from which a loader (require,
// getBuiltinModule, module._load, …) can be recovered. A pure first-party helper
// references none of them except the benign `process.env` config read (allowed as
// a literal member access below).
const ESCAPE_ROOTS = new Set([
  "process",
  "module",
  "globalThis",
  "global",
  "window",
  "self",
  "Bun",
  "Deno",
]);
// Member/element spellings that recover a loader from an object or a function
// (on ANY object, including an aliased root). Reflection + the direct Node loader
// primitives. `constructor` is included intentionally (a `.constructor` reaches the
// Function constructor, i.e. an eval-equivalent) even though this is a loud tripwire
// that would also flag an ordinary `value.constructor === Object` check — a pure
// data helper has no need for either, and no real file uses it.
const LOADER_RECOVERY_MEMBERS = new Set([
  "require",
  "createRequire",
  "getBuiltinModule",
  "dlopen",
  "binding",
  "_linkedBinding",
  "_load",
  "_compile",
  "constructor",
  "eval",
  "Function",
]);
// Roots whose members are ALL treated as escapes for a pure helper: it never uses
// `module.*`, `Bun.*`, or `Deno.*`, so any member is flagged (closes the whole
// loader family for these roots without an allowlist).
const FLAG_ALL_MEMBER_ROOTS = new Set(["module", "Bun", "Deno"]);
// The ONLY `process` members a pure first-party helper legitimately reads. Every
// other `process` member (getBuiltinModule, dlopen, binding, _linkedBinding,
// report, …) is flagged — so new Node process loaders are closed by construction.
const PROCESS_BENIGN_MEMBERS = new Set([
  "env",
  "platform",
  "arch",
  "version",
  "versions",
  "pid",
  "ppid",
  "cwd",
  "argv",
  "execPath",
  "title",
  "hrtime",
  "uptime",
  "nextTick",
  "exitCode",
]);

/**
 * True when an identifier occupies a NAME position (a declaration binding, a member
 * name like `foo.process`, or an object-literal/property key `{ process: 1 }`) —
 * i.e. it is not a value read of the global. Such positions are never a runtime
 * escape and must not false-positive.
 */
function isDeclarationOrPropertyName(node: ts.Identifier): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  if (ts.isQualifiedName(p) && p.right === node) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isShorthandPropertyAssignment(p) && p.name === node) return true;
  if (ts.isBindingElement(p) && p.propertyName === node) return true;
  if (
    (ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isBindingElement(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isClassDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isTypeParameterDeclaration(p)) &&
    p.name === node
  ) {
    return true;
  }
  return false;
}

/**
 * AST purity check (TypeScript compiler API — node kinds, not regex). Returns a
 * list of impurity findings for a source.
 *
 * This is a CONSERVATIVE FIRST-PARTY TRIPWIRE over the project's own pure helper
 * files — NOT a security sandbox and NOT a claim of mathematically detecting every
 * possible loader (that is undecidable). It fails closed on the syntactic loader
 * and runtime-escape forms below while leaving every real `lib/fulfillment/*.ts`
 * file (which uses none of them, apart from the benign `process.env` read) at zero
 * findings:
 *   - a forbidden static import/export (module/subpath);
 *   - ANY dynamic `import(...)`, any argument form;
 *   - ANY reference to a loader identifier (`require`, `createRequire`, `eval`,
 *     `Function`, `Reflect`) — callee, value, alias, or comma/parenthesized callee;
 *   - a reference/alias to a runtime escape root (`process`, `module`,
 *     `globalThis`, `global`, `window`, `self`, `Bun`, `Deno`) used as a bare value
 *     or via a dynamic element key — while a benign literal member such as
 *     `process.env` is allowed;
 *   - a loader-recovery member/element on any object (`.constructor`,
 *     `.getBuiltinModule`, `._load`, `.require`, `.createRequire`, and the
 *     `["constructor"]` / `["_load"]` / … literal spellings);
 *   - a string-literal `"require"`/`"createRequire"` call/reflection argument.
 * Comments and ordinary strings are ignored because only AST nodes are inspected.
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
      ts.isIdentifier(node) &&
      ESCAPE_ROOTS.has(node.text) &&
      !isDeclarationOrPropertyName(node)
    ) {
      const root = node.text;
      const p = node.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === node) {
        // `<root>.<member>`. Policy depends on the root:
        //  - process: allow only the small benign allowlist; flag everything else
        //    (getBuiltinModule, dlopen, binding, _linkedBinding, report, …);
        //  - module/Bun/Deno: flag ANY member (pure helpers never use them);
        //  - globalThis/window/self/global: allow benign globals; a dangerous
        //    member is caught by the loader-recovery rule below.
        if (root === "process" && !PROCESS_BENIGN_MEMBERS.has(p.name.text)) {
          findings.push(`escape-root-member:process.${p.name.text}`);
        } else if (FLAG_ALL_MEMBER_ROOTS.has(root)) {
          findings.push(`escape-root-member:${root}.${p.name.text}`);
        }
      } else if (ts.isElementAccessExpression(p) && p.expression === node) {
        const a = p.argumentExpression;
        if (!a || !ts.isStringLiteral(a)) {
          findings.push("escape-root-dynamic-element"); // process[k] / globalThis[k]
        } else if (root === "process" && !PROCESS_BENIGN_MEMBERS.has(a.text)) {
          findings.push(`escape-root-member:process.${a.text}`); // process["dlopen"]
        } else if (FLAG_ALL_MEMBER_ROOTS.has(root)) {
          findings.push(`escape-root-member:${root}.${a.text}`);
        } else if (LOADER_RECOVERY_MEMBERS.has(a.text)) {
          findings.push(`escape-root-loader-element:${a.text}`); // globalThis["require"]
        }
      } else {
        // Bare value / alias: `const p = process`, `const g = globalThis`, etc.
        findings.push(`escape-root-reference:${root}`);
      }
    } else if (
      ts.isPropertyAccessExpression(node) &&
      LOADER_RECOVERY_MEMBERS.has(node.name.text)
    ) {
      findings.push(`member-loader:${node.name.text}`);
    } else if (ts.isElementAccessExpression(node)) {
      const a = node.argumentExpression;
      if (a && ts.isStringLiteral(a) && LOADER_RECOVERY_MEMBERS.has(a.text))
        findings.push(`element-loader:${a.text}`);
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
    // Runtime escape roots + loader-recovery primitives (Node 24 public APIs and
    // constructor/_load reflection) — reproduced controller bypasses:
    ["process.getBuiltinModule", `const fs = process.getBuiltinModule("fs")`],
    [
      "process dynamic getBuiltinModule",
      `const k = "getBuiltinModule"; process[k]("fs")`,
    ],
    ["module.constructor._load", `const fs = module.constructor._load("fs")`],
    [
      "module.constructor dynamic _load",
      `const k = "_load"; module.constructor[k]("fs")`,
    ],
    [
      "constructor-of-constructor Function",
      `const F = (() => {}).constructor; F("return process")()`,
    ],
    [
      "global alias then dynamic key",
      `const g = globalThis; const k = "require"; g[k]("fs")`,
    ],
    ["process element getBuiltinModule", `process["getBuiltinModule"]("fs")`],
    [
      "module element constructor/_load",
      `module["constructor"]["_load"]("fs")`,
    ],
    [
      "arrow element constructor",
      `(() => {})["constructor"]("return process")()`,
    ],
    [
      "process aliased to a value",
      `const p = process; p.getBuiltinModule("fs")`,
    ],
    [
      "module aliased to a value",
      `const m = module; m.constructor._load("fs")`,
    ],
    [
      "process.dlopen native addon loader",
      `process.dlopen({ exports: {} }, "./x.node")`,
    ],
    ["process.binding legacy loader", `const b = process.binding("fs")`],
    [
      "process element dlopen",
      `process["dlopen"]({ exports: {} }, "./x.node")`,
    ],
    ["aliased process.binding", `const p = process; p.binding("fs")`],
    [
      "process._linkedBinding internal loader",
      `process._linkedBinding("spawn_sync")`,
    ],
    ["process element _linkedBinding", `process["_linkedBinding"]("fs")`],
    ["any non-benign process member", `const r = process.report`],
    ["module member (CJS exports)", `module.exports = { x: 1 }`],
    ["Bun loader member", `const lib = Bun.dlopen("./x.so", {})`],
    ["Deno loader member", `const lib = Deno.dlopen("./x.so", {})`],
    ["vm static import", `import vm from "vm"`],
    ["worker_threads static import", `import { Worker } from "worker_threads"`],
    ["child_process static import", `import { execSync } from "child_process"`],
    ["element-access indirect eval", `globalThis["eval"]("return process")()`],
    [
      "element-access indirect Function",
      `self["Function"]("return process")()`,
    ],
    ["member indirect eval on a value", `const g = globalThis; g.eval("x")`],
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
    // Benign escape-root usage that real helpers actually contain must NOT trip:
    [
      "the benign process.env config read (as in flag.ts)",
      `export function f(env: NodeJS.ProcessEnv = process.env) { return env.X === "true" }`,
    ],
    [
      "a literal non-loader member on a global",
      `const s = globalThis.JSON.stringify({})`,
    ],
    [
      "an identifier used as a property NAME equal to a root",
      `const o = { process: 1 }; const v = o.process`,
    ],
    [
      "a benign non-loader process member (platform)",
      `export const isWin = process.platform === "win32"`,
    ],
  ])("ignores %s (no false positive)", (_label, src) => {
    expect(findImpurities(src)).toEqual([]);
  });
});
