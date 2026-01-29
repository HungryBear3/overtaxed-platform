import { getToken } from "next-auth/jwt"
import type { NextRequest } from "next/server"

export async function getSession(request?: NextRequest) {
  // Extract cookie name from environment
  const isProduction = process.env.NODE_ENV === "production"
  const sessionCookieName = isProduction 
    ? "__Secure-authjs.session-token" 
    : "authjs.session-token"

  // For NextAuth v5 in API routes, get token from request
  if (request) {
    const token = await getToken({
      req: request as any,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName,
    })

    if (!token) return null

    return {
      user: {
        id: token.id as string,
        email: token.email as string,
        name: token.name as string,
        role: token.role as string,
        subscriptionTier: token.subscriptionTier as string,
        subscriptionStatus: token.subscriptionStatus as string,
      },
      expires: token.exp ? new Date(token.exp * 1000).toISOString() : undefined,
    }
  }

  // For server components, try to use cookies
  try {
    const { cookies } = await import("next/headers")
    const cookieStore = await cookies()
    const token = await getToken({
      req: {
        headers: {
          cookie: cookieStore.toString(),
        },
      } as any,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName,
    })

    if (!token) return null

    return {
      user: {
        id: token.id as string,
        email: token.email as string,
        name: token.name as string,
        role: token.role as string,
        subscriptionTier: token.subscriptionTier as string,
        subscriptionStatus: token.subscriptionStatus as string,
      },
      expires: token.exp ? new Date(token.exp * 1000).toISOString() : undefined,
    }
  } catch {
    return null
  }
}

export async function getCurrentUser(request?: NextRequest) {
  const session = await getSession(request)
  return session?.user
}

export async function requireAuth(request?: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) {
    throw new Error("Unauthorized")
  }
  return user
}
