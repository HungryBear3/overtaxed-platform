import type { Metadata } from "next"
import { redirect } from "next/navigation"

export const metadata: Metadata = {
  title: "How Cook County Property Tax Appeals Work",
}

export default function HowItWorksPage() {
  redirect("/#method")
}
