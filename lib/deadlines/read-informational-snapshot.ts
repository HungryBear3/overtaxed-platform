import type { OfficialDeadlineSnapshot } from "./official-source-state";
import { decodeInformationalSnapshot } from "./informational-snapshot";
import { informationalReadEnabled as enabled } from "./informational-flags";

/**
 * Server-side read of the published informational snapshot at one instant.
 *
 * The public API route and the township detail route both read through here,
 * so the detail page cannot evaluate a different source than the indexes
 * hydrate from. Read-only: never collects, fetches, publishes or renews the
 * source receipt. Any failure is null, which callers render as pending.
 */
export async function readInformationalSnapshot(now: Date): Promise<OfficialDeadlineSnapshot | null> {
  try {
    if (!enabled()) return null;
    // Loaded only when enabled, so disabled renders never touch storage modules.
    // Read-only capability: same decoder and digest-ready barrier as refresh mode, no write surface.
    const { informationalSnapshotReader } = await import("./informational-snapshot-store");
    const store = await informationalSnapshotReader();
    const value = await store?.read(now);
    // Recheck after asynchronous storage access, against the clock after it:
    // a slow read must not serve a source that expired while it waited.
    // Never renews the source receipt.
    return value && enabled() ? decodeInformationalSnapshot(JSON.stringify(value), new Date()) : null;
  } catch {
    // Source and configuration failures expose only unavailable data.
    return null;
  }
}

/** Explicit unavailable input: undefined would let the evaluator use the bundled default. */
export const UNAVAILABLE_SERVER_INFORMATIONAL_SNAPSHOT: OfficialDeadlineSnapshot = {
  schemaVersion: 1, synthetic: true, sources: { assessor: null, bor: null }, townships: {},
};
