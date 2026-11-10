import { auth } from "@/lib/auth/next-auth"
import { redirect } from "next/navigation"
import { signInDestination } from "@/lib/auth/signin-destination"
export const dynamic = "force-dynamic"
export default async function SignInContinuation({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/auth/signin")
  const params = await searchParams
  redirect(signInDestination((session.user as { role?: string }).role, params.next || ""))
}
