/**
 * The durable Production database marker.
 *
 * Preview has one of these already ([[neutral-preview-database-marker]]); this
 * is deliberately a SEPARATE parser rather than a widened one. A single parser
 * with an `environment` parameter is one mistaken argument away from accepting a
 * Preview database as Production or, far worse, the reverse — and the reverse is
 * the direction that writes to customers.
 *
 * The marker binds four facts at once, and every one of them is required:
 *
 *   environment = "production"   an explicit positive claim, not "not preview"
 *   production  = true           a second, independently-typed assertion
 *   projectRef                   WHICH Supabase project, pinned to the approved one
 *   instanceId                   WHICH database instance, so a restored copy or a
 *                                branch of the same project is not the same target
 *
 * The marker is stored as a `COMMENT ON DATABASE`, read back through
 * `shobj_description(...)`. It is not written by anything in this repository:
 * an operator installs it, and every fail-closed path below refuses until it is
 * there.
 */

const MARKER_SCHEMA = "ot.database-environment.v1";
const MARKER_PURPOSE = "ot-neutral-report";

/** The one approved Production Supabase project. Verified read-only, 2026-09-17. */
export const OT_PRODUCTION_PROJECT_REF = "kdvjiijzgflumgkndxsl";

/** Supabase project references are exactly twenty lowercase letters. */
export const SUPABASE_PROJECT_REF = /^[a-z]{20}$/;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NeutralProductionDatabaseMarker = {
  schema: typeof MARKER_SCHEMA;
  purpose: typeof MARKER_PURPOSE;
  environment: "production";
  production: true;
  projectRef: string;
  instanceId: string;
};

export type NeutralProductionDatabaseIdentity = {
  databaseName: string;
  marker: string | null;
};

export function parseNeutralProductionDatabaseMarker(
  raw: string | null | undefined,
): NeutralProductionDatabaseMarker {
  if (!raw)
    throw new Error(
      "Database is missing the durable Production environment marker",
    );

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Database Production environment marker is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Database Production environment marker is not an object");

  const marker = value as Record<string, unknown>;
  if (
    marker.schema !== MARKER_SCHEMA ||
    marker.purpose !== MARKER_PURPOSE ||
    marker.environment !== "production" ||
    marker.production !== true ||
    typeof marker.projectRef !== "string" ||
    !SUPABASE_PROJECT_REF.test(marker.projectRef) ||
    typeof marker.instanceId !== "string" ||
    !UUID.test(marker.instanceId)
  )
    throw new Error(
      "Database is not explicitly marked as the OT Production database",
    );

  // Checked separately from shape so the diagnostic distinguishes "malformed
  // marker" from "correctly formed marker for the wrong project".
  if (marker.projectRef !== OT_PRODUCTION_PROJECT_REF)
    throw new Error(
      "Database marker does not name the approved OT Production Supabase project",
    );

  return {
    schema: MARKER_SCHEMA,
    purpose: MARKER_PURPOSE,
    environment: "production",
    production: true,
    projectRef: marker.projectRef,
    instanceId: marker.instanceId,
  };
}

/**
 * Four separate credentials must resolve to ONE database. Same marker instance,
 * same project, same `current_database()`. Four URLs that each pass on their own
 * can still point at four different places.
 */
export function assertSameNeutralProductionDatabase(
  identities: readonly NeutralProductionDatabaseIdentity[],
): NeutralProductionDatabaseMarker {
  if (identities.length !== 4)
    throw new Error("Exactly four database identities are required");

  const parsed = identities.map(({ databaseName, marker }) => ({
    databaseName,
    marker: parseNeutralProductionDatabaseMarker(marker),
  }));
  const expected = parsed[0]!;
  if (!expected.databaseName) throw new Error("Database name is missing");

  for (const identity of parsed.slice(1)) {
    if (
      identity.databaseName !== expected.databaseName ||
      identity.marker.instanceId !== expected.marker.instanceId ||
      identity.marker.projectRef !== expected.marker.projectRef
    )
      throw new Error(
        "Database identities do not resolve to the same marked OT Production database instance",
      );
  }
  return expected.marker;
}
