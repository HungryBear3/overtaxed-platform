const canonicalPreviewProjectRef = "iyaxdrehtxsfkaexgxls";

export function assertCanonicalPreviewTarget(ownerUrl: string): void {
  const parsed = new URL(ownerUrl);
  const username = decodeURIComponent(parsed.username);
  const directTarget =
    parsed.hostname === `db.${canonicalPreviewProjectRef}.supabase.co` &&
    username === "postgres";
  const poolerTarget =
    parsed.hostname.endsWith(".pooler.supabase.com") &&
    username === `postgres.${canonicalPreviewProjectRef}`;

  if (!directTarget && !poolerTarget) {
    throw new Error(
      "DIRECT_URL host and username do not jointly identify the canonical isolated OT Preview project",
    );
  }
}

function main(): never {
  const ownerUrl = process.env.DIRECT_URL?.trim();
  if (!ownerUrl) throw new Error("DIRECT_URL is required");
  assertCanonicalPreviewTarget(ownerUrl);

  // Disabled deliberately. PostgreSQL role passwords cannot be safely passed
  // through this direct client while proving that server statement/parameter
  // logging will never retain them. Use the protected Supabase Management API
  // bootstrap described in the approval packet. That flow must first prove the
  // project ref and database marker, then use protected bound parameters.
  throw new Error(
    "Direct Preview identity bootstrap is disabled; use the protected Supabase Management API flow",
  );
}

try {
  main();
} catch {
  process.stderr.write(
    "neutral-report Preview identity bootstrap: FAIL (direct path disabled)\n",
  );
  process.exitCode = 1;
}
