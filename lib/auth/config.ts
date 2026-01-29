import { type NextAuthConfig } from "next-auth"
import { type JWT } from "next-auth/jwt"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"

/**
 * Validate and normalize email address
 */
function validateEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(normalized) ? normalized : null
}

export const authOptions: NextAuthConfig = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email : ""
        const password =
          typeof credentials?.password === "string" ? credentials.password : ""

        if (!email || !password) {
          throw new Error("Please enter your email and password")
        }

        // Normalize email to lowercase
        const normalizedEmail = validateEmail(email)
        if (!normalizedEmail) {
          throw new Error("Invalid email address")
        }

        // Lazy import Prisma to avoid loading it at module initialization
        const { prisma } = await import("@/lib/db")

        try {
          const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
              id: true,
              email: true,
              passwordHash: true,
              name: true,
              role: true,
              subscriptionTier: true,
              subscriptionStatus: true,
            }
          })

          if (!user || !user.passwordHash) {
            throw new Error("No user found with this email")
          }

          const isPasswordValid = await bcrypt.compare(password, user.passwordHash)

          if (!isPasswordValid) {
            throw new Error("Invalid password")
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            subscriptionTier: user.subscriptionTier,
            subscriptionStatus: user.subscriptionStatus,
          }
        } catch (error) {
          console.error("Auth error:", error)
          throw error
        }
      }
    })
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/auth/signin",
    signOut: "/auth/signout",
    error: "/auth/error",
  },
  callbacks: {
    async jwt({ token, user }) {
      const typedToken = token as JWT & { 
        id?: string
        role?: string
        subscriptionTier?: string
        subscriptionStatus?: string
      }
      
      if (user) {
        typedToken.id = user.id as string
        typedToken.sub = user.id as string
        typedToken.role = (user as any).role
        typedToken.subscriptionTier = (user as any).subscriptionTier
        typedToken.subscriptionStatus = (user as any).subscriptionStatus
      }
      return typedToken
    },
    async session({ session, token }) {
      if (session.user) {
        const typedToken = token as JWT & { 
          id?: string
          role?: string
          subscriptionTier?: string
          subscriptionStatus?: string
        }
        session.user.id = (typedToken.id ?? typedToken.sub ?? "") as string
        ;(session.user as any).role = typedToken.role
        ;(session.user as any).subscriptionTier = typedToken.subscriptionTier
        ;(session.user as any).subscriptionStatus = typedToken.subscriptionStatus
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    sessionToken: {
      name: `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name: `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}authjs.callback-url`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name: `${process.env.NODE_ENV === "production" ? "__Host-" : ""}authjs.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
}
