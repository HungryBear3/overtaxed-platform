import NextAuth from "next-auth"
import { authOptions } from "@/lib/auth/config"

// NextAuth v5: use handlers object form
export const { handlers, auth } = NextAuth(authOptions)
export const { GET, POST } = handlers

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
