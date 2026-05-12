/**
 * Client-safe view of the marketing preview gate.
 *
 * Only consults values that Next bundles into the client at build time:
 *   - process.env.NODE_ENV
 *   - process.env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB
 *
 * VERCEL_ENV is not visible client-side, so this helper is conservative
 * — it returns "preview" for any non-production build and any explicit
 * override. The authoritative safety net remains the server gate in
 * `./preview-gate`, which all marketing route handlers consult.
 */

export function isClientPreviewStubMode(): boolean {
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB === "true"
  ) {
    return true;
  }
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    return true;
  }
  return false;
}

export function isClientProductionMarketingRuntime(): boolean {
  return !isClientPreviewStubMode();
}
