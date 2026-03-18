import Link from "next/link"
import { Logo } from "@/components/navigation/Logo"
import { FreeCheckForm } from "@/components/check/FreeCheckForm"

export const metadata = {
  title: "Free Property Tax Assessment Check | OverTaxed IL",
  description:
    "See how your Cook County assessed value compares to 3 nearby properties. Free check — no signup. Find out if you're overpaying and get your appeal started.",
}

export default function CheckPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Logo href="/" />
          <div className="flex items-center gap-4">
            <Link href="/townships" className="text-sm text-gray-600 hover:text-gray-900 font-medium">
              Deadlines
            </Link>
            <Link href="/auth/signin" className="text-sm text-gray-600 hover:text-gray-900 font-medium">
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium text-sm"
            >
              Start Appeal
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 text-green-800 text-sm font-medium mb-4">
            Free · No signup required
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Is Cook County over-assessing you?
          </h1>
          <p className="text-lg text-gray-600">
            Enter your PIN or address. We’ll compare your assessed value to 3 nearby
            comparable properties and show you the gap — and what you could save.
          </p>
        </div>

        <FreeCheckForm />

        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-500 text-center">
            Don’t know your PIN?{" "}
            <a
              href="https://www.cookcountyassessor.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Look it up at cookcountyassessor.com
            </a>
            {" "}using your address.
          </p>
        </div>
      </main>
    </div>
  )
}
