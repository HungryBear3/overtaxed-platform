import { createHmac, randomBytes } from "crypto"

const SECRET = process.env.NEXTAUTH_SECRET
const EXPIRY_MS = 60 * 60 * 1000 // 1 hour

export function createPasswordResetToken(email: string): string {
  if (!SECRET) throw new Error("NEXTAUTH_SECRET is required for password reset")
  const payload = JSON.stringify({
    email: email.toLowerCase().trim(),
    exp: Date.now() + EXPIRY_MS,
    purpose: "password-reset",
  })
  const nonce = randomBytes(16).toString("base64url")
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url")
  const sig = createHmac("sha256", SECRET).update(nonce + "." + payloadB64).digest("base64url")
  return `${nonce}.${payloadB64}.${sig}`
}

export function verifyPasswordResetToken(token: string): { email: string } | null {
  if (!SECRET) return null
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [nonce, payloadB64, sig] = parts
  const expectedSig = createHmac("sha256", SECRET).update(nonce + "." + payloadB64).digest("base64url")
  if (sig !== expectedSig) return null
  let payload: { email: string; exp: number; purpose?: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (payload.purpose !== "password-reset" || !payload.email || payload.exp < Date.now()) return null
  return { email: payload.email }
}

// Email verification token (24h expiry)
const VERIFY_EMAIL_EXPIRY_MS = 24 * 60 * 60 * 1000

export function createEmailVerificationToken(email: string): string {
  if (!SECRET) throw new Error("NEXTAUTH_SECRET is required for email verification")
  const payload = JSON.stringify({
    email: email.toLowerCase().trim(),
    exp: Date.now() + VERIFY_EMAIL_EXPIRY_MS,
    purpose: "email-verify",
  })
  const nonce = randomBytes(16).toString("base64url")
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url")
  const sig = createHmac("sha256", SECRET).update(nonce + "." + payloadB64).digest("base64url")
  return `${nonce}.${payloadB64}.${sig}`
}

export function verifyEmailVerificationToken(token: string): { email: string } | null {
  if (!SECRET) return null
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [nonce, payloadB64, sig] = parts
  const expectedSig = createHmac("sha256", SECRET).update(nonce + "." + payloadB64).digest("base64url")
  if (sig !== expectedSig) return null
  let payload: { email: string; exp: number; purpose?: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (payload.purpose !== "email-verify" || !payload.email || payload.exp < Date.now()) return null
  return { email: payload.email }
}
