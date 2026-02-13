import Link from "next/link"

export const metadata = {
  title: "Privacy Policy | OverTaxed",
  description: "Privacy Policy for OverTaxed property tax appeal services.",
}

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-gray-500 text-sm mb-8">Last updated: February 2026</p>

        <div className="prose prose-gray max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">1. Introduction</h2>
            <p className="text-gray-700">
              OverTaxed (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our website and services at overtaxed-il.com (the &quot;Service&quot;).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">2. Information We Collect</h2>
            <p className="text-gray-700 mb-2">We may collect:</p>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
              <li>Account information: name, email, password (hashed)</li>
              <li>Property information: addresses, PINs, assessment data</li>
              <li>Appeal data: comps, requested values, filing status</li>
              <li>Payment information: processed by Stripe (we do not store card numbers)</li>
              <li>Contact form submissions and support inquiries</li>
              <li>Usage data: pages visited, session counts (visitor counter—no cookies, session-based)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">3. How We Use Your Information</h2>
            <p className="text-gray-700 mb-2">We use your information to:</p>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
              <li>Provide appeal monitoring, comp packets, and filing assistance</li>
              <li>Process payments and manage subscriptions</li>
              <li>Send account emails (verification, password reset, deadline reminders)</li>
              <li>Respond to support requests</li>
              <li>Improve our Service and comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">4. Information Sharing</h2>
            <p className="text-gray-700">
              We do not sell your personal information. We may share data with: service providers (hosting, email, payment processing); tax authorities when filing appeals on your behalf; or as required by law. Third parties are contractually bound to protect your data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">5. Data Retention</h2>
            <p className="text-gray-700">
              We retain property and appeal data for at least 7 years (standard for tax records). You may request account deletion; we will anonymize or delete data subject to legal requirements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">6. Your Rights</h2>
            <p className="text-gray-700 mb-2">You may:</p>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
              <li>Access and update your account information via Account settings</li>
              <li>Request export or deletion of your data</li>
              <li>Opt out of marketing emails (account/transactional emails may still be sent)</li>
              <li>Contact us with privacy questions or requests</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">7. Security</h2>
            <p className="text-gray-700">
              We use industry-standard measures to protect your data (encryption in transit, secure storage, access controls). No system is 100% secure; we will notify you of significant breaches as required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">8. Children</h2>
            <p className="text-gray-700">
              Our Service is not directed to individuals under 18. We do not knowingly collect personal information from children. If you believe a child has provided us data, please contact us and we will delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">9. Changes</h2>
            <p className="text-gray-700">
              We may update this Privacy Policy from time to time. Material changes will be communicated via email or through the platform. Continued use after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">10. Contact Us</h2>
            <p className="text-gray-700">
              For privacy questions or requests, contact us at{" "}
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
