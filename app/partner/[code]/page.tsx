import { notFound } from "next/navigation"
import { prisma } from "@/lib/db"
import type { Metadata } from "next"

interface Props {
  params: { code: string }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: "Partner Dashboard | OverTaxed IL",
    robots: { index: false, follow: false },
  }
}

export default async function PartnerDashboardPage({ params }: Props) {
  let referral = null
  try {
    referral = await prisma.referral.upsert({
      where: { code: params.code.toLowerCase() },
      update: {},
      create: { code: params.code.toLowerCase() },
    })
  } catch {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Dashboard unavailable</h1>
          <p className="text-gray-500">Please try again in a moment.</p>
        </div>
      </div>
    )
  }

  const commissionRate = 0.20 // 20% — adjust when you set official rates
  const estimatedEarnings = Number(referral.revenue) * commissionRate

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-16">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🏠</span>
            <h1 className="text-2xl font-bold text-gray-900">OverTaxed IL</h1>
          </div>
          <p className="text-gray-500 text-sm">Partner Dashboard</p>
        </div>

        {/* Partner name */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800">
            {referral.name ? `Welcome, ${referral.name}` : `Partner: ${referral.code}`}
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            Your referral link: <span className="font-mono text-blue-600">overtaxed-il.com/?ref={referral.code}</span>
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <div className="text-3xl font-bold text-gray-900">{referral.visits}</div>
            <div className="text-sm text-gray-500 mt-1">Link Visits</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <div className="text-3xl font-bold text-gray-900">{referral.conversions}</div>
            <div className="text-sm text-gray-500 mt-1">Paid Signups</div>
          </div>
          <div className="bg-white rounded-xl border border-green-200 bg-green-50 p-5 text-center">
            <div className="text-3xl font-bold text-green-700">
              ${estimatedEarnings.toFixed(0)}
            </div>
            <div className="text-sm text-green-600 mt-1">Est. Earnings</div>
          </div>
        </div>

        {/* Revenue breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold text-gray-800 mb-4">Revenue Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total revenue generated</span>
              <span className="font-medium text-gray-900">${Number(referral.revenue).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Commission rate</span>
              <span className="font-medium text-gray-900">{(commissionRate * 100).toFixed(0)}%</span>
            </div>
            <div className="border-t pt-3 flex justify-between text-sm">
              <span className="font-semibold text-gray-800">Your estimated earnings</span>
              <span className="font-bold text-green-700">${estimatedEarnings.toFixed(2)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Earnings are estimated and paid out manually. Contact us to arrange payment once your balance reaches $50+.
          </p>
        </div>

        {/* Conversion rate */}
        {referral.visits > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h3 className="font-semibold text-gray-800 mb-2">Conversion Rate</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900">
                {((referral.conversions / referral.visits) * 100).toFixed(1)}%
              </span>
              <span className="text-gray-500 text-sm">of visitors converted to paid</span>
            </div>
          </div>
        )}

        {/* Tips */}
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-6">
          <h3 className="font-semibold text-blue-800 mb-3">Tips to maximize conversions</h3>
          <ul className="space-y-2 text-sm text-blue-700">
            <li>• Mention timing — south district appeal windows close soon</li>
            <li>• "Free check" is the hook — free to see if you're over-assessed</li>
            <li>• Works best for Cook County homeowners specifically</li>
            <li>• Personal recommendation converts 3-5x better than generic posts</li>
          </ul>
        </div>

        <p className="text-center text-xs text-gray-400 mt-8">
          Questions? Contact Alexy · Stats update in real time
        </p>
      </div>
    </div>
  )
}
