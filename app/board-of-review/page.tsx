import Link from "next/link"
import { Logo } from "@/components/navigation/Logo"
import { BoardOfReviewWaitlist } from "@/components/board-of-review/BoardOfReviewWaitlist"

export const metadata = {
  title: "Cook County Board of Review Appeals | OverTaxed IL",
  description:
    "The Board of Review is the second level of Cook County property tax appeals — used by large commercial owners with attorneys. OverTaxed IL is building support for it. Join the waitlist.",
}

export default function BoardOfReviewPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Logo href="/" />
          <div className="flex items-center gap-4">
            <Link href="/auth/signin" className="text-sm text-gray-600 hover:text-gray-900 font-medium">
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium text-sm"
            >
              Start Your Assessor Appeal
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-medium mb-6">
          Coming soon
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          The Cook County Board of Review
        </h1>
        <p className="text-lg text-gray-600 mb-8">
          Most homeowners don&apos;t know that Cook County has two separate levels of property
          tax appeal. Large commercial property owners use both — with attorneys. Most
          homeowners don&apos;t even know the second one exists.
        </p>

        {/* Two levels */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          <div className="bg-white border border-blue-200 rounded-xl p-5">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Level 1</p>
            <h2 className="text-base font-bold text-gray-900 mb-2">Cook County Assessor</h2>
            <p className="text-sm text-gray-600 mb-3">
              The first appeal window after your township&apos;s reassessment. This is where
              most homeowners stop — and where OverTaxed IL currently operates.
            </p>
            <span className="inline-block px-2.5 py-1 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
              ✓ Available now
            </span>
          </div>
          <div className="bg-white border border-amber-200 rounded-xl p-5">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Level 2</p>
            <h2 className="text-base font-bold text-gray-900 mb-2">Board of Review</h2>
            <p className="text-sm text-gray-600 mb-3">
              A separate three-member body. After the Assessor&apos;s window closes and
              you receive a decision, you can file again — with a different deadline and
              different process.
            </p>
            <span className="inline-block px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
              ⏳ OverTaxed IL support coming
            </span>
          </div>
        </div>

        {/* The inequality section */}
        <div className="bg-gray-900 text-white rounded-2xl p-6 mb-10">
          <h2 className="text-xl font-bold mb-3">
            Businesses have always used both levels. Now you will too.
          </h2>
          <p className="text-gray-300 text-sm mb-4">
            When a commercial property owner in Cook County gets a high assessment, their tax
            attorney files at the Assessor level. If the reduction isn&apos;t sufficient, they
            file again at the Board of Review. Two bites at the apple.
          </p>
          <p className="text-gray-300 text-sm mb-4">
            Average homeowners either don&apos;t know the Board of Review exists, or feel
            intimidated by the process. So the second level of appeal has historically been
            the exclusive domain of well-represented commercial interests.
          </p>
          <p className="text-white text-sm font-semibold">
            OverTaxed IL is building Board of Review support to change that.
          </p>
        </div>

        {/* What it involves */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            What the Board of Review appeal involves
          </h2>
          <div className="space-y-4">
            <div className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Different deadline from the Assessor</p>
                <p className="text-sm text-gray-600">The Board of Review opens its window after the Assessor's window closes and decisions are issued. You need to track a separate calendar.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Different form format</p>
                <p className="text-sm text-gray-600">The Board of Review uses its own appeal form and evidence requirements, separate from the Assessor's comparable analysis packet.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Another opportunity for reduction</p>
                <p className="text-sm text-gray-600">Even if the Assessor denied your appeal or gave a smaller reduction than expected, the Board of Review is a fresh look by a separate body.</p>
              </div>
            </div>
          </div>
        </div>

        {/* What to do now */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">What to do right now</h2>
          <p className="text-sm text-gray-700 mb-4">
            While we build Board of Review support, the highest-value action is filing your
            Assessor appeal first. South district townships are open now. A successful Assessor
            appeal often eliminates the need to escalate to the Board of Review.
          </p>
          <Link
            href="/auth/signup"
            className="inline-block bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            Start my Assessor appeal now →
          </Link>
          <p className="text-xs text-gray-500 mt-3">
            $69 DIY · $149 full automation · No attorney needed
          </p>
        </div>

        {/* Waitlist */}
        <BoardOfReviewWaitlist />

        <p className="text-xs text-gray-400 text-center mt-10">
          Questions?{" "}
          <a href="mailto:support@overtaxed-il.com" className="underline hover:text-gray-600">
            support@overtaxed-il.com
          </a>
          {" · "}
          <Link href="/townships" className="underline hover:text-gray-600">
            Check township deadlines
          </Link>
        </p>
      </main>
    </div>
  )
}
