import { Transform, type TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import {
  OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS,
  canonicalJson,
  sha256,
} from "./neutral-production-recovery";

const CREATE_EXTENSION_PREFIX = "CREATE EXTENSION ";

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

export function adaptRecoveryExtensionSql(input: string): {
  sql: string;
  proof: ExtensionSqlPortabilityProof;
} {
  const adapter = new ExtensionStatementAdapter();
  const sql = input
    .split(/(?<=\n)/)
    .map((line) => adapter.adaptLine(line))
    .join("");
  return { sql, proof: adapter.proof() };
}

export class RecoveryExtensionSqlTransform extends Transform {
  private pending = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly adapter = new ExtensionStatementAdapter();
  private completedProof: ExtensionSqlPortabilityProof | undefined;

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
