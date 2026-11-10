/**
 * Server-only internal-test classification for the free-check ledger.
 *
 * A request is an internal test ONLY when all three hold:
 * - `OT_FREE_CHECK_INTERNAL_TEST_CLASSIFICATION_ENABLED=1` (default OFF);
 * - the request explicitly asks for it with the fixed marker below;
 * - the existing signed NextAuth session carries role ADMIN.
 *
 * The client marker is a request, never a grant: without a verified ADMIN
 * session it is ignored and the request is measured exactly as before. The
 * classification grants no access and changes no free-check result; it only
 * keeps the evaluation out of the customer completion ledger and GA result
 * events. Rows written before activation keep their recorded state: nothing
 * here relabels, deletes or backfills them.
 */
import type { NextRequest } from "next/server";

export const FREE_CHECK_INTERNAL_TEST_FIELD = "freeCheckInternalTest";
export const FREE_CHECK_INTERNAL_TEST_MARKER = "requested";

export function freeCheckInternalTestClassificationEnabled(): boolean {
  return process.env.OT_FREE_CHECK_INTERNAL_TEST_CLASSIFICATION_ENABLED === "1";
}

export async function classifyFreeCheckInternalTest(
  req: NextRequest,
  body: Record<string, unknown>,
): Promise<boolean> {
  if (!freeCheckInternalTestClassificationEnabled()) return false;
  if (body[FREE_CHECK_INTERNAL_TEST_FIELD] !== FREE_CHECK_INTERNAL_TEST_MARKER)
    return false;
  try {
    const { getSession } = await import("@/lib/auth/session");
    const user = (await getSession(req))?.user as
      | { id?: unknown; role?: unknown }
      | undefined;
    return (
      user?.role === "ADMIN" &&
      typeof user.id === "string" &&
      user.id.length > 0 &&
      user.id.length <= 128
    );
  } catch {
    // An unreadable session is not an admin session: measure normally.
    return false;
  }
}
