import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import "../ot-design.css"

export const metadata = {
  title: "Terms of Service",
  description: "Terms of Service and User Agreement for OverTaxed IL property tax appeal services.",
}

export default function TermsPage() {
  return (
    <div className="ot-root">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-white">
        <h1 className="text-3xl font-bold text-foreground mb-2">Terms of Service</h1>
        <p className="text-muted-foreground text-sm mb-8">Last updated: May 2026</p>

        <div className="prose max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Filing Authorization</h2>
            <p className="text-muted-foreground mb-3">
              Running a free check, viewing pricing, creating an account, or buying a DIY packet does not authorize OverTaxed IL to file an appeal for you.
            </p>
            <p className="text-muted-foreground mb-3">
              OverTaxed IL will act as your filing representative only if you choose a filing service that requires representation and separately sign or check an explicit authorization for that property. That authorization will describe what we may submit, which property it covers, and when it expires.
            </p>
            <p className="text-muted-foreground">
              If you choose the DIY Appeal Packet, you remain responsible for filing the appeal yourself unless you later purchase a Done-For-You or contingency filing service and provide separate authorization.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Relationship to Property</h2>
            <p className="text-muted-foreground">
              You represent that you are the property owner, or that you are authorized by the owner to request analysis or appeal support for the property. You agree to provide accurate information and to tell us if ownership or authorization changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. Services and Fees</h2>
            <p className="text-muted-foreground mb-3">
              <strong>3.1 DIY Appeal Packet — $69 one-time.</strong> We prepare comparable-property analysis, an appeal argument draft, and filing instructions. You file the appeal yourself with Cook County.
            </p>
            <p className="text-muted-foreground mb-3">
              <strong>3.2 Done-For-You — $97 one-time.</strong> We prepare the packet and submit the appeal for you after you provide explicit filing authorization. County filing availability and requirements may vary by appeal body and cycle.
            </p>
            <p className="text-muted-foreground mb-3">
              <strong>3.3 Contingency — 22% of first-year tax savings.</strong> If you are accepted for contingency filing, you pay no upfront OverTaxed IL service fee. If the county grants a reduction, you agree to pay 22% of the first-year tax savings from that reduction, subject to any minimum shown at checkout or in your signed contingency authorization. If the county grants no reduction, you owe no contingency fee.
            </p>
            <p className="text-muted-foreground">
              <strong>3.4 County fees.</strong> Cook County currently does not charge homeowners a fee to file a residential assessment appeal. If a government fee or third-party fee applies in the future, we will disclose it before you authorize payment.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Payment, Invoices, and Late Payments</h2>
            <p className="text-muted-foreground mb-3">
              Flat-fee products are charged at checkout. Contingency fees, if any, are invoiced only after a county reduction is granted and the savings calculation is available.
            </p>
            <p className="text-muted-foreground mb-3">
              If you believe an invoice is incorrect, email support@overtaxed-il.com within 30 days with the reason you dispute it. We will review the calculation and provide a written response.
            </p>
            <p className="text-muted-foreground">
              For unpaid invoices, we may pause non-essential services and send reminder notices. Any further payment-resolution step will be handled under applicable consumer-protection law and any separate written agreement you accepted. This section does not waive rights that cannot legally be waived.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. No Guarantee of Results</h2>
            <p className="text-muted-foreground">
              OverTaxed IL does not guarantee that any appeal will result in a lower assessment or lower tax bill. The Assessor, Board of Review, or other tax authority makes the final decision. Estimates shown on the site are educational projections based on available public records and may differ from final outcomes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Technology Platform; Not Legal or Tax Advice</h2>
            <p className="text-muted-foreground">
              OverTaxed IL is not a law firm, tax advisor, or licensed appraiser. We organize public records and appeal materials; we do not provide legal, tax, or appraisal advice. For legal, tax, valuation, ownership, exemption, or estate questions, consult a qualified professional.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Procedural Error Review and Refund Requests</h2>
            <p className="text-muted-foreground mb-3">
              For the $69 DIY Appeal Packet and $97 Done-For-You service, if your filing is rejected or denied solely because of an OverTaxed IL procedural error in the materials or submission we prepared, contact us so we can review the issue and determine whether a refund of the OverTaxed IL service fee is appropriate under these Terms.
            </p>
            <p className="text-muted-foreground mb-3">
              Refund review does not apply when the county denies an appeal on the merits, when the property is not eligible, when the appeal window is closed before you provide required information or authorization, or when information you provided is inaccurate or incomplete.
            </p>
            <p className="text-muted-foreground">
              To request a refund, contact support@overtaxed-il.com within 30 days of the county notice and include the notice or filing status. Contingency customers owe no contingency fee if there is no granted reduction.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Limitation of Liability</h2>
            <p className="text-muted-foreground mb-3">
              To the maximum extent permitted by law, OverTaxed IL is not liable for indirect, incidental, special, consequential, or punitive damages, or for decisions made by government agencies.
            </p>
            <p className="text-muted-foreground">
              OverTaxed IL&apos;s total liability for a claim is limited to the amount of fees you paid to OverTaxed IL for the specific property and filing at issue, except where applicable law requires otherwise.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Modifications</h2>
            <p className="text-muted-foreground">
              We may update these Terms from time to time. Material changes will be posted on the site or communicated by email. Material changes to paid services may require renewed acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Governing Law</h2>
            <p className="text-muted-foreground">
              These Terms are governed by Illinois law, without regard to conflict-of-law rules. Nothing in these Terms limits rights you may have under consumer-protection laws that cannot be waived.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">11. Contact</h2>
            <p className="text-muted-foreground">
              Questions about these Terms? Contact us at{" "}
              <a href="mailto:support@overtaxed-il.com" className="text-primary hover:underline">
                support@overtaxed-il.com
              </a>
              .
            </p>
          </section>
        </div>

        <p className="mt-12 text-sm text-muted-foreground">
          By purchasing a service or using OverTaxed IL, you acknowledge that you have read and understood these Terms. Filing authorization, where needed, is requested separately and explicitly.
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
