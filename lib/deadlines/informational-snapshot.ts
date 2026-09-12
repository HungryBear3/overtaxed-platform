import { z } from "zod";
import { TOWNSHIPS } from "@/lib/townships";
import { DEFAULT_SOURCE_TTL_MS, type OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";

export const INFORMATIONAL_YEAR = 2026;
export const INFORMATIONAL_PARSER_VERSION = "ccao-dom/1.0.0";
export const INFORMATIONAL_SOURCE_URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";
export const MAX_INFORMATIONAL_SNAPSHOT_LENGTH = 100_000;
const instant = z.string().refine(value => {
  const ms = Date.parse(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19);
});
const date = z.string().refine(value => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return /^2026-\d{2}-\d{2}$/.test(value) && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
});
const windowSchema = z.object({ noticeDate: date, openDate: date, lastFileDate: date }).strict()
  .refine(value => value.noticeDate === value.openDate && value.openDate <= value.lastFileDate);
const schema = z.object({
  schemaVersion: z.literal(1), synthetic: z.literal(false),
  sources: z.object({ bor: z.null(), assessor: z.object({
    authority: z.literal("cook_county_assessor"), sourceUrl: z.literal(INFORMATIONAL_SOURCE_URL),
    finalUrl: z.literal(INFORMATIONAL_SOURCE_URL), httpStatus: z.literal(200),
    retrievedAt: instant, sourceUpdatedAt: z.null(), contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    parseStatus: z.literal("ok"), parserVersion: z.literal(INFORMATIONAL_PARSER_VERSION),
  }).strict() }).strict(),
  townships: z.record(z.string(), z.object({ townshipName: z.string(),
    stages: z.object({ assessor: windowSchema.nullable() }).strict(),
  }).strict()),
}).strict();

/** Validates persisted bytes. This is not a replacement for hashing/parsing the original HTTP body. */
export function decodeInformationalSnapshot(raw: string, now: Date): OfficialDeadlineSnapshot | null {
  try {
    if (raw.length > MAX_INFORMATIONAL_SNAPSHOT_LENGTH || !Number.isFinite(now.getTime())) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success || TOWNSHIPS.length !== 38) return null;
    const snapshot = parsed.data;
    if (Object.keys(snapshot.townships).length !== 38 || TOWNSHIPS.some(t =>
      !Object.hasOwn(snapshot.townships, t.slug) || snapshot.townships[t.slug].townshipName !== t.name)) return null;
    const age = now.getTime() - Date.parse(snapshot.sources.assessor.retrievedAt);
    if (age < 0 || age > DEFAULT_SOURCE_TTL_MS) return null;
    return snapshot;
  } catch { return null; }
}
