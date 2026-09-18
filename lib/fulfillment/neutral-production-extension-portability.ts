import { Transform, type TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import {
  OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
  OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
  OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS,
  canonicalJson,
  sha256,
} from "./neutral-production-recovery";

const CREATE_EXTENSION_PREFIX = "CREATE EXTENSION ";
const SAFE_ROLE = /^[a-z_][a-z0-9_$]*$/;

function quotedIdentifier(identifier: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(identifier)
    ? identifier
    : `"${identifier.replaceAll('"', '""')}"`;
}

const RESTORED_EXTENSIONS = OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS.filter(
  (extension) => extension.portability !== "bootstrap",
);

const EXPECTED_CREATE_EXTENSION_STATEMENTS = RESTORED_EXTENSIONS.map(
  (extension) => ({
    extension,
    source: `CREATE EXTENSION IF NOT EXISTS ${quotedIdentifier(extension.extname)} WITH SCHEMA ${quotedIdentifier(extension.schema_name)};`,
    pinned: `CREATE EXTENSION IF NOT EXISTS ${quotedIdentifier(extension.extname)} WITH SCHEMA ${quotedIdentifier(extension.schema_name)} VERSION '${extension.extversion}';`,
  }),
);

export type ExtensionSqlPortabilityProof = {
  pinnedCreateExtensionStatements: number;
  pinnedCreateExtensionStatementsSha256: string;
};

export type RecoveryArchivePlan = {
  schemas: Buffer;
  extensions: Buffer;
  remainder: Buffer;
  archiveTocSha256: string;
};

export type StockExtensionOwners = Readonly<Record<string, string>>;

export function stockExtensionOwnersFromCatalog(
  catalog: unknown,
): StockExtensionOwners {
  if (!catalog || typeof catalog !== "object")
    throw new Error("Recovery source extension ownership is invalid");
  const extensions = (catalog as { extensions?: unknown }).extensions;
  const roles = (catalog as { roles?: unknown }).roles;
  if (!Array.isArray(extensions) || !Array.isArray(roles))
    throw new Error("Recovery source extension ownership is invalid");
  const authenticatedRoles = new Set(
    roles.flatMap((role) =>
      role &&
      typeof role === "object" &&
      typeof (role as { rolname?: unknown }).rolname === "string"
        ? [(role as { rolname: string }).rolname]
        : [],
    ),
  );
  const owners: Record<string, string> = {};
  for (const expected of RESTORED_EXTENSIONS.filter(
    (extension) => extension.portability === "stock",
  )) {
    const matches = extensions.filter(
      (row) =>
        row &&
        typeof row === "object" &&
        (row as { extname?: unknown }).extname === expected.extname &&
        (row as { extversion?: unknown }).extversion === expected.extversion &&
        (row as { schema_name?: unknown }).schema_name === expected.schema_name,
    );
    const catalogOwner =
      matches.length === 1 &&
      typeof (matches[0] as { owner_role?: unknown }).owner_role === "string"
        ? (matches[0] as { owner_role: string }).owner_role
        : "";
    const owner =
      catalogOwner === OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR
        ? OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS[0]
        : catalogOwner;
    if (!SAFE_ROLE.test(owner) || !authenticatedRoles.has(owner))
      throw new Error("Recovery source extension ownership is invalid");
    owners[expected.extname] = owner;
  }
  return Object.freeze(owners);
}

function selectedToc(input: string[], selected: Set<number>): Buffer {
  return Buffer.from(
    input
      .map((line, index) =>
        line.startsWith(";") || line.trim() === "" || selected.has(index)
          ? line
          : `;${line}`,
      )
      .join("\n"),
    "utf8",
  );
}

export function planRecoveryArchiveToc(tocBytes: Buffer): RecoveryArchivePlan {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(tocBytes);
  const lines = source.split("\n");
  const schemaRows = new Set<number>();
  const schemaNames: string[] = [];
  const extensionRows = new Set<number>();
  const extensionNames: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.startsWith(";") || line.trim() === "") continue;
    if (!/^\d+; \d+ \d+ /.test(line))
      throw new Error("Recovery archive TOC contains an unsupported row");
    const extensionRow = /^\d+; \d+ \d+ EXTENSION - (.*)$/.exec(line);
    if (extensionRow) {
      const extension =
        /^\d+; \d+ \d+ EXTENSION - ([a-z_][a-z0-9_$-]*)(?: [^ ]*)? *$/.exec(
          line,
        );
      if (!extension)
        throw new Error(
          "Recovery archive TOC contains an unsupported extension row",
        );
      extensionRows.add(index);
      extensionNames.push(extension[1]!);
      continue;
    }
    const schema =
      /^\d+; \d+ \d+ SCHEMA - ([a-z_][a-z0-9_$]*)(?: [^ ]*)? *$/.exec(line);
    if (
      schema &&
      RESTORED_EXTENSIONS.some(
        (extension) => extension.schema_name === schema[1],
      )
    ) {
      schemaRows.add(index);
      schemaNames.push(schema[1]!);
    }
  }
  const expectedNames = RESTORED_EXTENSIONS.map((row) => row.extname).sort();
  const expectedSchemaNames = [
    ...new Set(RESTORED_EXTENSIONS.map((row) => row.schema_name)),
  ].sort();
  if (
    canonicalJson(extensionNames.sort()) !== canonicalJson(expectedNames) ||
    extensionRows.size !== expectedNames.length ||
    canonicalJson(schemaNames.sort()) !== canonicalJson(expectedSchemaNames) ||
    schemaRows.size !== expectedSchemaNames.length
  )
    throw new Error(
      "Recovery archive TOC extension/schema prerequisites are unknown, missing, or repeated",
    );
  const remainderRows = new Set<number>();
  for (const [index, line] of lines.entries())
    if (
      !line.startsWith(";") &&
      line.trim() !== "" &&
      !schemaRows.has(index) &&
      !extensionRows.has(index)
    )
      remainderRows.add(index);
  return {
    schemas: selectedToc(lines, schemaRows),
    extensions: selectedToc(lines, extensionRows),
    remainder: selectedToc(lines, remainderRows),
    archiveTocSha256: sha256(tocBytes),
  };
}

export function expectedExtensionSqlPortabilityProof(): ExtensionSqlPortabilityProof {
  const pinned = EXPECTED_CREATE_EXTENSION_STATEMENTS.map(
    (expected) => expected.pinned,
  );
  return {
    pinnedCreateExtensionStatements: pinned.length,
    pinnedCreateExtensionStatementsSha256: sha256(canonicalJson(pinned)),
  };
}

class ExtensionStatementAdapter {
  private readonly observed = new Map<string, string>();

  constructor(private readonly stockOwners: StockExtensionOwners) {}

  adaptLine(line: string): string {
    const newline = line.endsWith("\r\n")
      ? "\r\n"
      : line.endsWith("\n")
        ? "\n"
        : "";
    const statement = newline ? line.slice(0, -newline.length) : line;
    if (!statement.startsWith(CREATE_EXTENSION_PREFIX)) return line;
    const expected = EXPECTED_CREATE_EXTENSION_STATEMENTS.find(
      (candidate) => candidate.source === statement,
    );
    if (!expected)
      throw new Error(
        `Recovery dump contains an unknown or mismatched CREATE EXTENSION statement: ${statement}`,
      );
    if (this.observed.has(expected.extension.extname))
      throw new Error(
        `Recovery dump repeats CREATE EXTENSION for ${expected.extension.extname}`,
      );
    this.observed.set(expected.extension.extname, expected.pinned);
    if (expected.extension.portability === "stock") {
      const owner = this.stockOwners[expected.extension.extname];
      if (!owner || !SAFE_ROLE.test(owner))
        throw new Error("Recovery source extension ownership is invalid");
      return `SET ROLE ${quotedIdentifier(owner)};\n${expected.pinned}${newline}RESET ROLE;${newline}`;
    }
    return `${expected.pinned}${newline}`;
  }

  proof(): ExtensionSqlPortabilityProof {
    const pinned = EXPECTED_CREATE_EXTENSION_STATEMENTS.map((expected) => {
      const statement = this.observed.get(expected.extension.extname);
      if (!statement)
        throw new Error(
          `Recovery dump is missing CREATE EXTENSION for ${expected.extension.extname}`,
        );
      return statement;
    });
    return {
      pinnedCreateExtensionStatements: pinned.length,
      pinnedCreateExtensionStatementsSha256: sha256(canonicalJson(pinned)),
    };
  }
}

export function adaptRecoveryExtensionSql(
  input: string,
  stockOwners: StockExtensionOwners = Object.fromEntries(
    RESTORED_EXTENSIONS.filter(
      (extension) => extension.portability === "stock",
    ).map((extension) => [extension.extname, "postgres"]),
  ),
): {
  sql: string;
  proof: ExtensionSqlPortabilityProof;
} {
  const adapter = new ExtensionStatementAdapter(stockOwners);
  const sql = input
    .split(/(?<=\n)/)
    .map((line) => adapter.adaptLine(line))
    .join("");
  return { sql, proof: adapter.proof() };
}

export class RecoveryExtensionSqlTransform extends Transform {
  private pending = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly adapter: ExtensionStatementAdapter;
  private completedProof: ExtensionSqlPortabilityProof | undefined;

  constructor(stockOwners: StockExtensionOwners) {
    super();
    this.adapter = new ExtensionStatementAdapter(stockOwners);
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      this.pending += this.decoder.write(chunk);
      const lines = this.pending.split("\n");
      this.pending = lines.pop() ?? "";
      for (const line of lines) this.push(this.adapter.adaptLine(`${line}\n`));
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    try {
      this.pending += this.decoder.end();
      if (this.pending) this.push(this.adapter.adaptLine(this.pending));
      this.completedProof = this.adapter.proof();
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  proof(): ExtensionSqlPortabilityProof {
    if (!this.completedProof)
      throw new Error("Recovery extension SQL adaptation is incomplete");
    return this.completedProof;
  }
}
