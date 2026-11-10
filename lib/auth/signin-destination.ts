/** Only relative, same-site callback paths are accepted. */
export function safeSignInCallback(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return null
  try {
    const parsed = new URL(value, "https://signin.invalid")
    if (parsed.origin !== "https://signin.invalid") return null
    if (parsed.pathname.startsWith("/auth/")) return null
    return parsed.pathname + parsed.search + parsed.hash
  } catch { return null }
}
export function signInContinuationUrl(value: string): string {
  const next = safeSignInCallback(value)
  return "/auth/continue" + (next ? "?next=" + encodeURIComponent(next) : "")
}
export function signInDestination(role: unknown, value: string): string {
  const next = safeSignInCallback(value)
  if (role === "ADMIN" && (!next || next === "/dashboard")) return "/admin"
  return next || "/dashboard"
}
