const MARKER_SCHEMA = "ot.database-environment.v1";
const MARKER_PURPOSE = "ot-neutral-report";

export type NeutralPreviewDatabaseMarker = {
  schema: typeof MARKER_SCHEMA;
  purpose: typeof MARKER_PURPOSE;
  environment: "preview";
  isolated: true;
  production: false;
  instanceId: string;
};

export type NeutralPreviewDatabaseIdentity = {
  databaseName: string;
  marker: string | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseNeutralPreviewDatabaseMarker(
  raw: string | null,
): NeutralPreviewDatabaseMarker {
  if (!raw)
    throw new Error(
      "Database is missing the durable Preview environment marker",
    );

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Database Preview environment marker is not valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Database Preview environment marker is not an object");
  }
  const marker = value as Record<string, unknown>;
  if (
    marker.schema !== MARKER_SCHEMA ||
    marker.purpose !== MARKER_PURPOSE ||
    marker.environment !== "preview" ||
    marker.isolated !== true ||
    marker.production !== false ||
    typeof marker.instanceId !== "string" ||
    !UUID.test(marker.instanceId)
  ) {
    throw new Error(
      "Database is not explicitly marked as an isolated non-Production OT Preview database",
    );
  }

  return marker as NeutralPreviewDatabaseMarker;
}

export function assertSameNeutralPreviewDatabase(
  identities: readonly NeutralPreviewDatabaseIdentity[],
): NeutralPreviewDatabaseMarker {
  if (identities.length !== 4)
    throw new Error("Exactly four database identities are required");

  const parsed = identities.map(({ databaseName, marker }) => ({
    databaseName,
    marker: parseNeutralPreviewDatabaseMarker(marker),
  }));
  const expected = parsed[0];
  if (!expected?.databaseName) throw new Error("Database name is missing");

  for (const identity of parsed.slice(1)) {
    if (
      identity.databaseName !== expected.databaseName ||
      identity.marker.instanceId !== expected.marker.instanceId
    ) {
      throw new Error(
        "Database identities do not resolve to the same isolated Preview database instance",
      );
    }
  }

  return expected.marker;
}
