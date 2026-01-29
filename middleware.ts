import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

export async function middleware(request: NextRequest) {
  // Protected routes that require authentication
  const protectedPaths = ["/dashboard", "/properties", "/appeals", "/account"]
  const adminPaths = ["/admin"]
  const isProtectedPath = protectedPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )
  const isAdminPath = adminPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )

  if (isProtectedPath || isAdminPath) {
    try {
      const isProduction = process.env.NODE_ENV === "production"
      const sessionCookieName = isProduction 
        ? "__Secure-authjs.session-token" 
        : "authjs.session-token"
      
      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
        cookieName: sessionCookieName,
      })

      if (!token) {
        const signInUrl = new URL("/auth/signin", request.url)
        signInUrl.searchParams.set("callbackUrl", request.nextUrl.pathname)
        return NextResponse.redirect(signInUrl)
      }

      if (isAdminPath && token.role !== "ADMIN") {
        return NextResponse.redirect(new URL("/dashboard", request.url))
      }
    } catch (error) {
      console.error("[Middleware] Error reading token:", error)
      const signInUrl = new URL("/auth/signin", request.url)
      return NextResponse.redirect(signInUrl)
    }
  }

  // Redirect authenticated users away from auth pages
  const authPaths = ["/auth/signin", "/auth/signup"]
  const isAuthPath = authPaths.some(path => 
    request.nextUrl.pathname === path
  )

  if (isAuthPath) {
    try {
      const isProduction = process.env.NODE_ENV === "production"
      const sessionCookieName = isProduction 
        ? "__Secure-authjs.session-token" 
        : "authjs.session-token"
      
      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
        cookieName: sessionCookieName,
      })

      // If user is already logged in, redirect to dashboard
      if (token) {
        return NextResponse.redirect(new URL("/dashboard", request.url))
      }
    } catch {
      // Ignore errors on auth pages
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/properties/:path*",
    "/appeals/:path*",
    "/account/:path*",
    "/admin/:path*",
    "/auth/signin",
    "/auth/signup",
  ],
}
