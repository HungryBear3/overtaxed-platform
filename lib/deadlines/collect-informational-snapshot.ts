import "server-only";
import { createHash } from "node:crypto";
import type { TownshipSnapshotRow } from "./official-source-state";
import { decodeInformationalSnapshot, INFORMATIONAL_PARSER_VERSION, INFORMATIONAL_SOURCE_URL, INFORMATIONAL_YEAR } from "./informational-snapshot";

export const MAX_ASSESSOR_HTML_BYTES = 500_000;
type Inputs = {
  fetchSource: typeof fetch;
  parseHtml: (html: string, year: number) => Record<string, TownshipSnapshotRow>;
  now: () => Date;
};
/** Runtime route supplies fixed trusted adapters, never request-shaped dependencies. */
export async function collectInformationalSnapshot({ fetchSource, parseHtml, now }: Inputs) {
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
      response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/html") return null;
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
    return process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED === "true"
      ? decodeInformationalSnapshot(JSON.stringify(snapshot), now()) : null;
  } catch { return null; }
  finally {
    if (reader) {
      await reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* Cleanup cannot turn refusal into a raw error. */ }
    }
  }
}
