// Simple in-memory rate limiter for API routes
// For production at scale, consider Redis or a dedicated service

interface RateLimitStore {
  [key: string]: { count: number; resetTime: number }
}

const store: RateLimitStore = {}

setInterval(() => {
  const now = Date.now()
  Object.keys(store).forEach((key) => {
    if (store[key].resetTime < now) delete store[key]
  })
}, 5 * 60 * 1000)

export function rateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean } {
  const now = Date.now()
  if (!store[identifier] || store[identifier].resetTime < now) {
    store[identifier] = { count: 1, resetTime: now + windowMs }
    return { allowed: true }
  }
  store[identifier].count++
  return { allowed: store[identifier].count <= maxRequests }
}

export function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  const ip = forwarded ? forwarded.split(",")[0].trim() : null
  const realIp = request.headers.get("x-real-ip")
  return ip || realIp || "unknown"
}
