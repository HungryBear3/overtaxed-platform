"use client"

import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"

interface SignOutButtonProps {
  children?: React.ReactNode
  className?: string
  variant?: "link" | "button"
  onClick?: () => void
}

export function SignOutButton({ children, className, variant = "link", onClick }: SignOutButtonProps) {
  const handleSignOut = () => {
    onClick?.()
    signOut({ redirectTo: "/auth/signin" })
  }

  const baseClass = variant === "button"
    ? "inline-flex h-10 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium hover:bg-gray-50"
    : "rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className={cn(baseClass, className)}
    >
      {children ?? "Sign out"}
    </button>
  )
}
