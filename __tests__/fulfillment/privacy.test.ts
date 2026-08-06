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

/**
 * Collect every module specifier a source file imports, using the TypeScript AST
 * (so comments and ordinary strings that merely mention a module name are ignored).
 * Detects: `import x from "m"`, side-effect-only `import "m"`, `export … from "m"`,
 * dynamic `import("m")` (any whitespace), and `require("m")` (any whitespace).
 */
function collectModuleSpecifiers(source: string): string[] {
  const sf = ts.createSourceFile(
    "probe.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      const arg = node.arguments[0];
      if ((isImport || isRequire) && arg && ts.isStringLiteral(arg))
        specifiers.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specifiers;
}

/** True if `specifier` is exactly `mod` or a subpath `mod/...`. */
function matchesModule(specifier: string, mod: string): boolean {
  return specifier === mod || specifier.startsWith(`${mod}/`);
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

describe("fulfillment library is pure — no side-effecting imports", () => {
  const dir = join(ROOT, "lib/fulfillment");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const sideEffectImports = [
    "@/lib/db",
    "@prisma/client",
    "next/server",
    "stripe",
    "resend",
    "nodemailer",
    "@vercel/blob",
  ];

  it("has source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(sideEffectImports)(
    "no fulfillment source imports %s (AST-checked)",
    (mod) => {
      for (const f of files) {
        const specifiers = collectModuleSpecifiers(
          readFileSync(join(dir, f), "utf8"),
        );
        expect(specifiers.some((s) => matchesModule(s, mod))).toBe(false);
      }
    },
  );
});

describe("AST import guard is behaviorally sound (correction I fixtures)", () => {
  const forbidden = "resend";
  it.each([
    ["static default import", `import x from "resend"\n`],
    ["side-effect-only import", `import "resend"\n`],
    ["named import", `import { send } from "resend"\n`],
    ["export-from", `export { send } from "resend"\n`],
    ["dynamic import", `const m = import("resend")\n`],
    ["dynamic import spaced", `const m = import (\n  "resend"\n)\n`],
    ["require", `const m = require("resend")\n`],
    ["require spaced", `const m = require (  "resend"  )\n`],
    ["subpath import", `import x from "resend/webhooks"\n`],
  ])("detects %s", (_label, src) => {
    const specifiers = collectModuleSpecifiers(src);
    expect(specifiers.some((s) => matchesModule(s, forbidden))).toBe(true);
  });

  it.each([
    [
      "a comment mentioning the module",
      `// we deliberately never import "resend" here\nexport const x = 1\n`,
    ],
    [
      "a plain string mentioning the module",
      `export const note = "do not use resend or nodemailer"\n`,
    ],
    [
      "a similarly-named but different module",
      `import x from "resender-safe"\n`,
    ],
  ])("ignores %s", (_label, src) => {
    const specifiers = collectModuleSpecifiers(src);
    expect(specifiers.some((s) => matchesModule(s, forbidden))).toBe(false);
  });
});
