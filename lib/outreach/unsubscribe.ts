// One-click unsubscribe token handling.
//
// Token format: base64url( version || iv || authTag || AES-256-GCM(ciphertext) )
// where ciphertext is JSON { email, campaignId }. The encryption key is derived
// from OUTREACH_UNSUBSCRIBE_SECRET / NEXTAUTH_SECRET via SHA-256.
//
// Properties:
//   - stateless (no per-token DB row needed)
//   - does not expose the email in plaintext or reversible base64 in URLs/logs
//   - tamper-resistant via AES-GCM authentication
//   - expiry-free: a token is valid as long as the secret is rotated on the
//     same cadence as campaign retention.

import * as crypto from "node:crypto"

function getSecret(): string {
  const secret =
    process.env.OUTREACH_UNSUBSCRIBE_SECRET ??
    process.env.NEXTAUTH_SECRET ?? // fallback so dev doesn't break
    ""
  if (!secret) {
    throw new Error(
      "OUTREACH_UNSUBSCRIBE_SECRET (or NEXTAUTH_SECRET fallback) must be set for unsubscribe tokens",
    )
  }
  return secret
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function tokenKey(): Buffer {
  return crypto.createHash("sha256").update(getSecret(), "utf8").digest()
}

const TOKEN_VERSION = 1
const TOKEN_IV_BYTES = 12
const TOKEN_TAG_BYTES = 16

export interface UnsubscribePayload {
  email: string
  campaignId: string | null
}

export function mintUnsubscribeToken(payload: UnsubscribePayload): string {
  const email = payload.email.trim()
  const plaintext = Buffer.from(
    JSON.stringify({ email, campaignId: payload.campaignId ?? null }),
    "utf8",
  )
  const iv = crypto.randomBytes(TOKEN_IV_BYTES)
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return base64UrlEncode(Buffer.concat([Buffer.from([TOKEN_VERSION]), iv, authTag, ciphertext]))
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  try {
    const raw = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64")
    const minLength = 1 + TOKEN_IV_BYTES + TOKEN_TAG_BYTES + 2
    if (raw.length < minLength || raw[0] !== TOKEN_VERSION) return null

    const iv = raw.subarray(1, 1 + TOKEN_IV_BYTES)
    const authTag = raw.subarray(1 + TOKEN_IV_BYTES, 1 + TOKEN_IV_BYTES + TOKEN_TAG_BYTES)
    const ciphertext = raw.subarray(1 + TOKEN_IV_BYTES + TOKEN_TAG_BYTES)
    const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(), iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
    const parsed = JSON.parse(plaintext) as Partial<UnsubscribePayload>
    const email = typeof parsed.email === "string" ? parsed.email.trim() : ""
    if (!email) return null
    const campaignId = typeof parsed.campaignId === "string" && parsed.campaignId ? parsed.campaignId : null
    return { email, campaignId }
  } catch {
    return null
  }
}
