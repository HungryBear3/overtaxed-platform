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
        <p className="text-gray-500 text-sm mb-8">Last updated: February 2026</p>

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
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Fee Structure and Payment Terms</h2>
            <p className="text-gray-700 mb-3">
              <strong>3.1 Subscription Plans (Starter, Growth, Portfolio).</strong> For subscription-based plans, you agree to pay the annual subscription fee as selected at the time of signup. Fees are billed annually on your subscription anniversary date and will automatically renew unless cancelled.
            </p>
            <p className="text-gray-700 mb-3">
              <strong>3.2 Performance Plan – Percentage-Based Fee.</strong> If you select the Performance Plan, you agree to pay OverTaxed a fee equal to four percent (4%) of the total tax savings achieved over a three (3) year period from the date of the first successful appeal reduction.
            </p>
            <p className="text-gray-700 mb-2">
              <strong>3.2.1 Calculation of Tax Savings.</strong> &quot;Tax Savings&quot; means the total reduction in property tax liability resulting from successful appeals, calculated as follows:
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-3 space-y-1">
              <li>Tax Savings = Assessment Reduction × Tax Rate × Equalization Factor</li>
              <li>Tax Savings are not calculated by comparing prior years&apos; taxes to current years&apos; taxes.</li>
              <li>Total Tax Savings = Sum of Tax Savings for all tax years within the 3-year period.</li>
              <li>Partial reductions: Tax Savings are calculated on the actual reduction granted. Denials: no Tax Savings.</li>
            </ul>
            <p className="text-gray-700 mb-2">
              <strong>3.2.2 Payment Options.</strong> Option A (Upfront): Pay the full 4% fee within 30 days of final determination of the 3-year Tax Savings. Option B (Installments): Pay the 4% fee in three (3) equal annual installments, first due within 30 days of the first successful appeal reduction, then on each anniversary.
            </p>
            <p className="text-gray-700 mb-3">
              <strong>3.2.3 Invoicing.</strong> OverTaxed will send an invoice detailing original and reduced assessments, Tax Savings per year, total Tax Savings, the 4% fee calculation, and payment due date.
            </p>
            <p className="text-gray-700">
              <strong>3.3 Comps-Only Plan.</strong> For the Comps-Only plan, you agree to pay a one-time fee of $69 per property for each comp packet generated.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Collections and Default</h2>
            <p className="text-gray-700 mb-3">
              <strong>4.1 Payment Obligation.</strong> You agree to pay all fees due under your selected plan within the timeframes specified. Fees are due and payable within 30 days of invoice receipt unless otherwise agreed in writing.
            </p>
            <p className="text-gray-700 mb-3">
              <strong>4.2 Payment Terms.</strong> Any unpaid balance for more than 30 days after billing shall be deemed delinquent. Delinquent amounts shall be subject to a monthly finance charge of 1.5% per month (or the maximum rate permitted by Illinois law, whichever is less) until payment is received. Interest shall accrue at the highest rate permitted by applicable law if 1.5% per month exceeds that limit.
            </p>
            <p className="text-gray-700 mb-3">
              <strong>4.3 Late Payment Consequences.</strong> If payment is not received by the due date: OverTaxed may suspend your account and all services until payment is received; the monthly finance charge will apply; OverTaxed may refer the account to a collections agency or attorney for collection.
            </p>
            <p className="text-gray-700 mb-3">
              <strong>4.4 Acceleration.</strong> If you fail to pay any Performance Plan fee when due (including any installment), OverTaxed may, at its option, accelerate the entire unpaid balance and declare all remaining installments immediately due and payable.
            </p>
            <p className="text-gray-700 mb-3">
              <strong>4.5 Collections Actions.</strong> If the account becomes delinquent (more than 60 days after due date), OverTaxed may send collection letters (Notice of Intent to Collect, Final Notice Before Filing Suit), engage a collections agency, and pursue legal action including filing suit, obtaining judgment for the balance plus interest, late fees, and reasonable attorney&apos;s fees and costs, and enforcing the judgment through wage garnishment, bank levies, or property liens.
            </p>
            <p className="text-gray-700 mb-3">
              <strong>4.6 Costs of Collection.</strong> If any proceeding is brought to enforce collection, you shall reimburse OverTaxed for all reasonable costs of collection, including court costs and reasonable attorney fees.
            </p>
            <p className="text-gray-700 mb-3">
              <strong>4.7 Waiver of Defenses.</strong> You agree that the amount of any Performance Plan fee set forth in an invoice shall be final and binding upon you unless you dispute the calculation in writing within 30 days of the invoice date, specifying the alleged error. After 30 days, the fee amount may not be disputed except for manifest calculation error.
            </p>
            <p className="text-gray-700 mb-3">
              <strong>4.8 Credit Reporting.</strong> OverTaxed reserves the right to report delinquent accounts to credit bureaus or similar reporting agencies in accordance with applicable law.
            </p>
            <p className="text-gray-700">
              <strong>4.9 No Refund for Performance Plan Fees.</strong> Once a Performance Plan fee is calculated and invoiced based on actual Tax Savings, the fee is non-refundable, except as required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. No Guarantee of Results</h2>
            <p className="text-gray-700">
              OverTaxed does not guarantee that any appeal will result in a reduction of your property tax assessment. The decision to grant or deny an appeal rests solely with the tax authority. OverTaxed has no control over those decisions. County decisions are final and binding subject only to processes provided by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Technology Platform; Not Legal or Tax Advice</h2>
            <p className="text-gray-700">
              OverTaxed is a technology platform that automates the property tax appeal process. OverTaxed is not a law firm and does not provide legal advice; not a tax advisor and does not provide tax advice; and not a licensed appraiser. You are not relying on OverTaxed for legal, tax, or appraisal advice. Consult qualified professionals if you need such advice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Limitation of Liability</h2>
            <p className="text-gray-700 mb-3">
              To the maximum extent permitted by law, OverTaxed shall not be liable for any indirect, incidental, special, consequential, or punitive damages; loss of profits, revenue, data, or use; or any damages arising from denial of appeals by tax authorities, errors or delays in filing, technical failures, inaccurate data from third-party sources, or your failure to provide accurate information.
            </p>
            <p className="text-gray-700">
              OverTaxed&apos;s total liability shall not exceed the amount of fees you have paid to OverTaxed in the twelve (12) months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Cancellation and Changes</h2>
            <p className="text-gray-700 mb-3">
              You may cancel your subscription at any time via your account or by contacting OverTaxed. Upon cancellation, your subscription will not renew; you will have access until the end of your current billing period. For the Performance Plan, you remain obligated to pay fees for Tax Savings achieved during the 3-year period, even if you cancel.
            </p>
            <p className="text-gray-700">
              Refunds: Subscription plans – within 30 days of initial signup (satisfaction guarantee). Performance Plan – no refunds once fees are calculated and invoiced. Comps-Only – no refunds for comp packets already delivered.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Modifications</h2>
            <p className="text-gray-700">
              OverTaxed reserves the right to modify these Terms at any time. Material changes will be communicated via email or through the platform. Continued use of the service after such modifications constitutes acceptance. Material changes may require your renewed acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Governing Law</h2>
            <p className="text-gray-700">
              These Terms shall be governed by the laws of the State of Illinois. Any disputes shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association, except that OverTaxed may seek injunctive relief in any court of competent jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Contact</h2>
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
          By signing up and using OverTaxed, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service and User Agreement.
        </p>
      </main>
    </div>
  )
}
