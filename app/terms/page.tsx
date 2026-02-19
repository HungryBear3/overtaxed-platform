import Link from "next/link"

export const metadata = {
  title: "Terms of Service | OverTaxed",
  description: "Terms of Service and User Agreement for OverTaxed property tax appeal services.",
}

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-gray-500 text-sm mb-8">Last updated: January 2026</p>

        <div className="prose prose-gray max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Authorization to File Appeals</h2>
            <p className="text-gray-700 mb-3">
              By using OverTaxed and accepting these Terms, you authorize OverTaxed to act as your authorized representative for the purpose of filing property tax assessment appeals on your behalf with the appropriate county assessor&apos;s office, board of review, or other tax authority.
            </p>
            <p className="text-gray-700 mb-3">
              You grant OverTaxed authority to file appeals, submit documents and evidence, communicate with tax authorities, and receive and respond to notices and decisions regarding your appeals. This authorization remains in effect for the duration of your active subscription or until you cancel in accordance with these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Relationship to Property</h2>
            <p className="text-gray-700">
              You represent that you are either the legal owner of the property(ies) listed in your account or authorized by the legal owner to file appeals on their behalf. You agree to provide accurate information and to update OverTaxed if ownership changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. No Guarantee of Results</h2>
            <p className="text-gray-700">
              OverTaxed does not guarantee that any appeal will result in a reduction of your property tax assessment. The decision to grant or deny an appeal rests solely with the tax authority. OverTaxed has no control over those decisions. County decisions are final and binding subject only to processes provided by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Technology Platform; Not Legal or Tax Advice</h2>
            <p className="text-gray-700 mb-3">
              OverTaxed is a technology platform that automates the property tax appeal process. OverTaxed is not a law firm and does not provide legal advice; not a tax advisor and does not provide tax advice; and not a licensed appraiser. You are not relying on OverTaxed for legal, tax, or appraisal advice. Consult qualified professionals if you need such advice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Limitation of Liability</h2>
            <p className="text-gray-700 mb-3">
              To the maximum extent permitted by law, OverTaxed shall not be liable for any indirect, incidental, special, consequential, or punitive damages; loss of profits, revenue, data, or use; or any damages arising from denial of appeals by tax authorities, errors or delays in filing, technical failures, inaccurate data from third-party sources, or your failure to provide accurate information.
            </p>
            <p className="text-gray-700">
              OverTaxed&apos;s total liability shall not exceed the amount of fees you have paid to OverTaxed in the twelve (12) months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Fees and Plans</h2>
            <p className="text-gray-700 mb-3">
              Subscription plans (Starter, Growth, Portfolio) are billed annually and renew unless cancelled. DIY/comps-only purchases are one-time fees per property. Performance plan fees (if applicable) are based on a percentage of tax savings as described in your plan. You agree to pay all fees due under your selected plan. Delinquent amounts may be subject to finance charges and collection actions as specified in the full Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Cancellation and Changes</h2>
            <p className="text-gray-700">
              You may cancel your subscription in accordance with the cancellation process provided in your account or billing settings. Material changes to these Terms may require your renewed acceptance. Continued use of the service after notice of changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Contact</h2>
            <p className="text-gray-700">
              Questions about these Terms? Contact us at{" "}
              <a href="mailto:support@overtaxed-il.com" className="text-blue-600 hover:underline">
                support@overtaxed-il.com
              </a>
              .
            </p>
          </section>
        </div>

        <p className="mt-12 text-sm text-gray-500">
          A more detailed Terms of Service (including fee calculation details, collections, and Performance plan terms) may be provided separately. By signing up and using OverTaxed, you agree to these Terms.
        </p>
      </main>
    </div>
  )
}
