/**
 * Informational deadline capability predicates. Evaluated on every call so a
 * flag or environment flip between awaits is seen by the next recheck.
 *
 * - Preview read-only: OT_INFORMATIONAL_DEADLINE_PREVIEW_READ_ENABLED exactly
 *   "true" AND VERCEL_ENV exactly "preview". Ignored in every other
 *   environment, and never grants refresh, publication or barrier writes.
 * - Refresh (all writes): the existing refresh flag, refused whenever Preview
 *   read-only is active. Read-only wins.
 * - Read: refresh flag (existing behavior) OR Preview read-only. Reads stay
 *   subject to the decoder and the digest-ready barrier either way.
 */
type Env = Record<string, string | undefined>;

export function informationalPreviewReadOnly(env: Env = process.env): boolean {
  return env.OT_INFORMATIONAL_DEADLINE_PREVIEW_READ_ENABLED === "true" && env.VERCEL_ENV === "preview";
}

export function informationalRefreshEnabled(env: Env = process.env): boolean {
  return env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED === "true" && !informationalPreviewReadOnly(env);
}

export function informationalReadEnabled(env: Env = process.env): boolean {
  return env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED === "true" || informationalPreviewReadOnly(env);
}
