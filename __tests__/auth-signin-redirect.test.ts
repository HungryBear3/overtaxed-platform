jest.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }))
jest.mock("@/lib/auth/next-auth", () => ({ signIn: jest.fn() }))
import { signInWithCredentials } from "@/app/auth/signin/actions"
import { signIn } from "@/lib/auth/next-auth"
import { signInDestination, signInContinuationUrl } from "@/lib/auth/signin-destination"
describe("sign-in redirect", () => {
  beforeEach(() => jest.clearAllMocks())
  it("rethrows successful Next redirect instead of displaying an error", async () => {
    const redirect = { digest: "NEXT_REDIRECT;replace;/auth/continue;303;" }
    ;(signIn as jest.Mock).mockRejectedValueOnce(redirect)
    await expect(signInWithCredentials("synthetic@example.test", "unused", "/dashboard")).rejects.toBe(redirect)
  })
  it("keeps unexpected failures as errors", async () => {
    ;(signIn as jest.Mock).mockRejectedValueOnce(new Error("synthetic"))
    await expect(signInWithCredentials("synthetic@example.test", "unused", "/dashboard")).resolves.toEqual({error:"An unexpected error occurred"})
  })
  it.each(["", "/dashboard"])("routes admin default %s to admin", v => expect(signInDestination("ADMIN",v)).toBe("/admin"))
  it("preserves regular dashboard", () => expect(signInDestination("USER","/dashboard")).toBe("/dashboard"))
  it("preserves explicit local callbacks", () => expect(signInDestination("ADMIN","/check?x=1")).toBe("/check?x=1"))
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/auth/continue"])("rejects unsafe/loop callback %s", v => expect(signInContinuationUrl(v)).toBe("/auth/continue"))
})
