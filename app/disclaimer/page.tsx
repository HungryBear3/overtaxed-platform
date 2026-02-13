import Link from "next/link"

export const metadata = {
  title: "Disclaimer | OverTaxed",
  description: "Legal disclaimer for OverTaxed property tax appeal services.",
}

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-bold text-blue-900">
              Over<span className="text-blue-600">Taxed</span>
            </Link>
            <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              Back to home
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Disclaimer</h1>
        <p className="text-gray-500 text-sm mb-8">Last updated: February 2026</p>

        <div className="prose prose-gray max-w-none space-y-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-6">
            <p className="font-semibold text-amber-900 mb-1">Important: Not Legal or Tax Advice</p>
            <p className="text-amber-800 text-sm">
              OverTaxed is a technology platform, not a law firm or tax advisor. We do not provide legal or tax advice. Consult a licensed attorney or tax professional for advice specific to your situation.
            </p>
          </div>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">1. Technology Platform Only</h2>
            <p className="text-gray-700">
              OverTaxed automates property tax appeal preparation and assists with comp packets and filing. We are not a law firm, tax advisor, or licensed appraiser. Use of our Service does not create an attorney-client or advisor-client relationship.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">2. No Guarantee of Results</h2>
            <p className="text-gray-700">
              We do not guarantee that any appeal will result in a reduction. Decisions are made solely by the county assessor or board of review. OverTaxed has no control over those decisions. County outcomes are final and binding.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">3. Data Accuracy</h2>
            <p className="text-gray-700">
              We use Cook County Open Data and other sources. While we strive for accuracy, we cannot guarantee that all data is complete, current, or error-free. You should verify important information with official county resources.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">4. Filing Responsibility</h2>
            <p className="text-gray-700">
              Today, users file appeals themselves at the Cook County Assessor portal. We prepare packets and provide instructions. You are responsible for meeting deadlines and following county procedures. We are not responsible for missed deadlines or filing errors.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">5. Illinois / Cook County Only</h2>
            <p className="text-gray-700">
              Our MVP supports Cook County, Illinois only. Procedures, deadlines, and requirements may differ in other counties or states. Do not rely on our Service for properties outside our supported jurisdictions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">6. Contact Us</h2>
            <p className="text-gray-700">
              Questions about this disclaimer? Contact us at{" "}
              <a href="mailto:support@overtaxed-il.com" className="text-blue-600 hover:underline">
                support@overtaxed-il.com
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
