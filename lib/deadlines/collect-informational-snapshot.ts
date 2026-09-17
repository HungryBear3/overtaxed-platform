import "server-only";
import { createHash } from "node:crypto";
import type { TownshipSnapshotRow } from "./official-source-state";
import { decodeInformationalSnapshot, INFORMATIONAL_PARSER_VERSION, INFORMATIONAL_SOURCE_URL, INFORMATIONAL_YEAR } from "./informational-snapshot";

export const MAX_ASSESSOR_HTML_BYTES = 500_000;
const sourceBodies = new WeakMap<object, Buffer>();
type Inputs = {
  fetchSource: typeof fetch;
  parseHtml: (html: string, year: number) => Record<string, TownshipSnapshotRow>;
  now: () => Date;
};
/** Runtime route supplies fixed trusted adapters, never request-shaped dependencies. */
export async function collectOfficialDeadlineCapture({ fetchSource, parseHtml, now }: Inputs) {
  if (process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED !== "true") return null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const startedAt = now().toISOString();
    const response = await fetchSource(INFORMATIONAL_SOURCE_URL, {
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.body) return null;
    reader = response.body.getReader();
    if (response.status !== 200 || response.url !== INFORMATIONAL_SOURCE_URL ||
      !/^text\/html(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(response.headers.get("content-type")?.trim() ?? "")) return null;
    const chunks: Buffer[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_ASSESSOR_HTML_BYTES) return null;
      chunks.push(Buffer.from(value));
    }
    if (!size || process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED !== "true") return null;
    const bytes = Buffer.concat(chunks);
    const townships = parseHtml(new TextDecoder("utf-8", { fatal: true }).decode(bytes), INFORMATIONAL_YEAR);
    const snapshot = { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
      authority: "cook_county_assessor", sourceUrl: INFORMATIONAL_SOURCE_URL, finalUrl: response.url,
      httpStatus: 200, retrievedAt: startedAt, sourceUpdatedAt: null,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      parseStatus: "ok", parserVersion: INFORMATIONAL_PARSER_VERSION,
    } }, townships };
    const decoded = process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED === "true"
      ? decodeInformationalSnapshot(JSON.stringify(snapshot), now()) : null;
    return decoded ? { snapshot: decoded, sourceBody: bytes } : null;
  } catch { return null; }
  finally {
    if (reader) {
      await reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* Cleanup cannot turn refusal into a raw error. */ }
    }
  }
}

/** Backward-compatible informational projection; commerce also retains source bytes. */
export async function collectInformationalSnapshot(inputs: Inputs) {
  const capture = await collectOfficialDeadlineCapture(inputs);
  if (!capture) return null;
  sourceBodies.set(capture.snapshot, capture.sourceBody);
  return capture.snapshot;
}

/** Source bytes paired in-process with the validated snapshot returned above. */
export function sourceBodyForSnapshot(snapshot: object): Buffer | null {
  return sourceBodies.get(snapshot) ?? null;
}
