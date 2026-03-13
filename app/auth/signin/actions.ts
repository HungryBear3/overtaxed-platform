"use server"

import { AuthError } from "next-auth"
import { signIn } from "@/app/api/auth/[...nextauth]/route"

export async function signInWithCredentials(
  email: string,
  password: string,
  callbackUrl: string
): Promise<{ error?: string }> {
  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl,
    })
    // On success, signIn redirects; we never reach here
    return {}
  } catch (err) {
    if (err instanceof AuthError) {
      // Strip the "Read more at ..." suffix Auth.js appends
      const msg = err.message?.replace(/\s*Read more at .+$/, "").trim()
      return { error: msg || "Invalid email or password. Please try again." }
    }
    return { error: "An unexpected error occurred" }
  }
}
