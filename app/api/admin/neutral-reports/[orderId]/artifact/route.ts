import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/auth/session"
import { NEUTRAL_OPERATOR_ARTIFACT_KINDS } from "@/lib/fulfillment/neutral-operator-read"
import { readNeutralOperatorArtifact } from "@/lib/fulfillment-runtime/neutral-operator-read-store"
import { NEUTRAL_OPERATOR_PRIVATE_HEADERS } from "@/lib/fulfillment-runtime/neutral-operator-route-headers"

const OrderId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const Body = z
  .object({
    action: z.literal("READ"),
    artifactKind: z.enum(NEUTRAL_OPERATOR_ARTIFACT_KINDS),
    expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

const json = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: NEUTRAL_OPERATOR_PRIVATE_HEADERS })

/**
 * Serve an operator the exact verified bytes of one artifact.
 *
 * The caller must name the digest it expects, and the store serves only bytes a
 * digest-verifying storage helper returned. No public URL, no capability, no
 * provider call, no customer send, and no state promotion happens here: the only
 * write in the whole path is one append-only audit row, and it is written only
 * after verification succeeded.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const session = await getSession(request)
  const user = session?.user as { id?: unknown; role?: unknown } | undefined
  if (user?.role !== "ADMIN" || typeof user.id !== "string" || user.id.length < 1 || user.id.length > 128)
    return json({ ok: false, code: "UNAUTHORIZED" }, 401)
  if (process.env.OT_NEUTRAL_OPERATOR_READ_ENABLED !== "true")
    return json({ ok: false, code: "NOT_AVAILABLE" }, 404)
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ ok: false, code: "INVALID_ORIGIN" }, 403)
  } catch {
    return json({ ok: false, code: "INVALID_ORIGIN" }, 403)
  }
  if (request.headers.get("content-type") !== "application/json")
    return json({ ok: false, code: "INVALID_CONTENT_TYPE" }, 400)
  const { orderId } = await context.params
  if (!OrderId.safeParse(orderId).success) return json({ ok: false, code: "INVALID_ORDER_ID" }, 400)
  const parsed = Body.safeParse(await request.json().catch(() => undefined))
  if (!parsed.success) return json({ ok: false, code: "INVALID_BODY" }, 400)
  try {
    const result = await readNeutralOperatorArtifact({
      orderId,
      actorKey: `admin:${user.id}`,
      artifactKind: parsed.data.artifactKind,
      expectedSha256: parsed.data.expectedSha256,
    })
    if (!result.ok) return json(result, 409)
    // The filename is derived from the verified digest, never from a stored
    // locator or any customer-supplied value.
    return new NextResponse(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        ...NEUTRAL_OPERATOR_PRIVATE_HEADERS,
        "Content-Type": result.mediaType,
        "Content-Length": String(result.byteSize),
        "Content-Disposition": `attachment; filename="${result.sha256}"`,
        "X-OT-Artifact-Sha256": result.sha256,
      },
    })
  } catch {
    // The storage error message could quote a locator; only a closed code leaves.
    return json({ ok: false, code: "INTERNAL_ERROR" }, 500)
  }
}
