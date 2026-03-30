import Link from "next/link"

export const metadata = {
  title: "Privacy Policy | LegalKitsUSA",
  description: "Privacy Policy for LegalKitsUSA digital legal document products sold on Etsy.",
}

export default function LegalKitsUSAPrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-gray-900">LegalKitsUSA</span>
            <a
              href="https://www.etsy.com/shop/legalkitsusa"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit our Etsy Shop
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-1">Entity: <strong>LegalKitsUSA</strong></p>
        <p className="text-gray-500 text-sm mb-8">Last updated: March 2026</p>

        <div className="prose prose-gray max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">1. Introduction</h2>
            <p className="text-gray-700">
              LegalKitsUSA (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates the LegalKitsUSA Etsy shop at{" "}
              <a href="https://www.etsy.com/shop/legalkitsusa" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                etsy.com/shop/legalkitsusa
              </a>{" "}
              and related digital properties. We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard information in connection with our products and services.
            </p>
            <p className="text-gray-700 mt-2">
              LegalKitsUSA sells digital legal document kits — educational PDF guides for property tax appeals, small claims court, traffic ticket disputes, homestead exemptions, landlord notices, record sealing, and divorce preparation — across multiple U.S. states.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">2. Information We Collect</h2>
            <p className="text-gray-700 mb-2">We may collect or receive the following information:</p>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
              <li>Purchase information provided through Etsy (name, email, shipping address if applicable)</li>
              <li>Communications you send us via Etsy Messages, email, or contact forms</li>
              <li>Analytics data from Etsy and Pinterest (aggregate, anonymized — no personal identifiers)</li>
              <li>Information you voluntarily provide when contacting us for support</li>
            </ul>
            <p className="text-gray-700 mt-2">
              We do <strong>not</strong> collect payment card information directly. All payments are processed by Etsy and Stripe under their respective privacy policies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">3. How We Use Your Information</h2>
            <p className="text-gray-700 mb-2">We use your information to:</p>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
              <li>Fulfill digital product orders and deliver download files</li>
              <li>Respond to customer support requests and questions</li>
              <li>Send order confirmation and download instructions</li>
              <li>Improve our products and customer experience</li>
              <li>Comply with applicable laws and platform policies</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">4. Information Sharing</h2>
            <p className="text-gray-700">
              We do not sell your personal information. We do not share your information with third parties except:
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4 mt-2">
              <li>Etsy, Inc. — as required to operate our shop (governed by Etsy&apos;s Privacy Policy)</li>
              <li>Service providers who assist with email delivery and file hosting, under confidentiality agreements</li>
              <li>As required by law, court order, or governmental authority</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">5. Pinterest and Social Platforms</h2>
            <p className="text-gray-700">
              LegalKitsUSA maintains a presence on Pinterest and other social platforms to promote our products. When you interact with our pins or social content, data is collected by those platforms under their own privacy policies. We receive only aggregate, anonymized analytics from those interactions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">6. Digital Products — No Personal Data in Files</h2>
            <p className="text-gray-700">
              Our digital products (PDF kits) are purely educational documents. They do not collect, transmit, or store any personal information. No tracking or analytics software is embedded in our PDF files.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">7. Data Retention</h2>
            <p className="text-gray-700">
              We retain order and communication records for up to 7 years as required by standard business and tax record-keeping practices. You may request deletion of your personal data at any time, subject to legal and platform limitations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">8. Your Rights</h2>
            <p className="text-gray-700 mb-2">You may:</p>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
              <li>Request access to personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your personal data (subject to legal requirements)</li>
              <li>Opt out of any marketing communications from us</li>
            </ul>
            <p className="text-gray-700 mt-2">
              For purchases made through Etsy, you may also exercise rights directly through your Etsy account settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">9. Security</h2>
            <p className="text-gray-700">
              We take reasonable measures to protect information associated with LegalKitsUSA operations. Digital product files are delivered via Etsy&apos;s secure download system. We do not store payment information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">10. Children</h2>
            <p className="text-gray-700">
              Our products and services are not directed to individuals under 18. We do not knowingly collect personal information from children.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">11. Disclaimer</h2>
            <p className="text-gray-700">
              LegalKitsUSA sells educational legal document guides for informational purposes only. Our products are <strong>not legal advice</strong> and do not create an attorney-client relationship. Always consult a licensed attorney in your state for advice specific to your situation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">12. Changes to This Policy</h2>
            <p className="text-gray-700">
              We may update this Privacy Policy from time to time. The &quot;Last updated&quot; date at the top reflects the most recent revision. Continued use of our products or shop after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">13. Contact Us</h2>
            <p className="text-gray-700">
              For privacy questions, data requests, or concerns, contact us at:{" "}
              <a href="mailto:support@overtaxed-il.com" className="text-blue-600 hover:underline">
                support@overtaxed-il.com
              </a>
              {" "}or via Etsy Messages at{" "}
              <a href="https://www.etsy.com/shop/legalkitsusa" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                etsy.com/shop/legalkitsusa
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-gray-200 text-center text-sm text-gray-400">
          LegalKitsUSA &mdash; Digital Legal Document Kits &mdash;{" "}
          <a href="https://www.etsy.com/shop/legalkitsusa" className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
            etsy.com/shop/legalkitsusa
          </a>
        </div>
      </main>
    </div>
  )
}
