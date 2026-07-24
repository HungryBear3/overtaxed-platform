import { createHmac, timingSafeEqual } from "node:crypto"

export type CheckoutWindowSnapshot = {
  pin: string
  township: string
  status: "open" | "closed" | "future_cycle" | "unknown"
  openDate: string | null
  closeDate: string | null
  sourceUpdated: string
  sourceUrl: string
  verifiedAt: string
}

type AckPayload = {
  v: 1
  kind: "analysis_ack"
  checkoutKey: string
  tier: "T2"
  snapshot: CheckoutWindowSnapshot
  exp: number
}

function secret(): string {
  const value = process.env.OT_CHECKOUT_GATE_SECRET || process.env.NEXTAUTH_SECRET
  if (!value || value.length < 24) throw new Error("Checkout gate secret is not configured")
  return value
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url")
}

function signature(payload: string): string {
  return encode(createHmac("sha256", secret()).update(payload).digest())
}

export function issueAnalysisAcknowledgmentToken(
  checkoutKey: string,
  snapshot: CheckoutWindowSnapshot,
  now: Date = new Date(),
): string {
  const payload: AckPayload = {
    v: 1,
    kind: "analysis_ack",
    checkoutKey,
    tier: "T2",
    snapshot,
    exp: Math.floor(now.getTime() / 1000) + 15 * 60,
  }
  const encoded = encode(JSON.stringify(payload))
  return `${encoded}.${signature(encoded)}`
}

export function verifyAnalysisAcknowledgmentToken(
  token: string,
  checkoutKey: string,
  snapshot: CheckoutWindowSnapshot,
  now: Date = new Date(),
): boolean {
  try {
    const [encoded, supplied] = token.split(".")
    if (!encoded || !supplied) return false
    const expected = signature(encoded)
    const suppliedBytes = Buffer.from(supplied)
    const expectedBytes = Buffer.from(expected)
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return false
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AckPayload
    return (
      payload.v === 1 &&
      payload.kind === "analysis_ack" &&
      payload.tier === "T2" &&
      payload.checkoutKey === checkoutKey &&
      payload.exp >= Math.floor(now.getTime() / 1000) &&
      JSON.stringify(payload.snapshot) === JSON.stringify(snapshot)
    )
  } catch {
    return false
  }
}
