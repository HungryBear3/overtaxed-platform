"use server"

import { AuthError } from "next-auth"
import { isRedirectError } from "next/dist/client/components/redirect-error"
import { signInContinuationUrl } from "@/lib/auth/signin-destination"
import { signIn } from "@/lib/auth/next-auth"

export async function signInWithCredentials(
  email: string,
  password: string,
  callbackUrl: string
): Promise<{ error?: string }> {
  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: signInContinuationUrl(callbackUrl),
    })
    // On success, signIn redirects; we never reach here
    return {}
  } catch (err) {
    // Next.js implements a successful redirect by throwing. Never turn it into a login error.
    if (isRedirectError(err)) throw err
    if (err instanceof AuthError) {
      // Strip the "Read more at ..." suffix Auth.js appends
      const msg = err.message?.replace(/\s*Read more at .+$/, "").trim()
      return { error: msg || "Invalid email or password. Please try again." }
    }
    return { error: "An unexpected error occurred" }
  }
}
