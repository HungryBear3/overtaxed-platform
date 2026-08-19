import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome"
import { CC_10, CC_11, CC_12 } from "@/lib/copy/canonical"
import "../ot-design.css"

export const metadata = {
  title: "Terms of Service",
  description: "Terms of Service and User Agreement for OverTaxed IL property tax appeal services.",
  alternates: { canonical: "https://www.overtaxed-il.com/terms" },
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
            {/* The old §1 described a representation path that could be
                unlocked by "a filing service that requires representation" —
                the held Done-For-You and contingency services. With no such
                service offered, the Terms state the single posture that
                applies rather than reserving a path to a product that does not
                exist. CC-11 states the Board of Review position, where
                representation is barred to us by rule at any price. */}
            <p className="text-muted-foreground mb-3">
              OverTaxed IL does not act as your filing representative. We prepare appeal materials; you review, sign, and file them with Cook County yourself. If you buy the DIY Appeal Packet, you remain responsible for filing the appeal.
            </p>
            <p className="text-muted-foreground">
              {CC_11}
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
            {/* §3.2 Done-For-You and §3.3 Contingency are removed. A Terms of
                Service is the document a reader is most likely to treat as
                authoritative about what is on offer, so leaving priced terms
                for held products here would keep offering them after every
                other surface stopped. §3.4 is renumbered to §3.2. */}
            <p className="text-muted-foreground mb-3">
              {CC_10}
            </p>
            <p className="text-muted-foreground">
              <strong>3.2 County fees.</strong> Cook County currently does not charge homeowners a fee to file a residential assessment appeal. If a government fee or third-party fee applies in the future, we will disclose it before you authorize payment.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Payment, Invoices, and Late Payments</h2>
            {/* The contingency-invoicing sentence described a fee that can no
                longer be incurred: the outcome-conditioned fee is the held
                product itself. */}
            <p className="text-muted-foreground mb-3">
              The flat fee is charged at checkout. OverTaxed IL does not invoice any fee that depends on what the county decides.
            </p>
            <p className="text-muted-foreground mb-3">
              If you believe an invoice is incorrect, email support@overtaxed-il.com within 30 days with the reason you dispute it. We will review the calculation and provide a written response.
            </p>
            <p className="text-muted-foreground">
              For unpaid invoices, we may pause non-essential services and send reminder notices. Any further payment-resolution step will be handled under applicable consumer-protection law and any separate written agreement you accepted. This section does not waive rights that cannot legally be waived.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. County Decisions Are Final</h2>
            {/* The disclaimer is CC-12, rendered rather than paraphrased, so
                the negated form is the canonical one the acceptance lexicon
                recognises. "Estimates shown on the site are educational
                projections" is dropped with the dollar estimates themselves. */}
            <p className="text-muted-foreground">
              {CC_12} The Cook County Assessor makes the decision on an appeal filed at that stage.
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
            {/* The refund rule itself is unchanged. It is an owner policy term
                (OD-5, unsigned), so only the reference to the held $97 service
                and to submissions we make is removed — we make none. */}
            <p className="text-muted-foreground mb-3">
              For the $69 DIY Appeal Packet, if your filing is rejected or denied solely because of an OverTaxed IL procedural error in the materials we prepared, contact us so we can review the issue and determine whether a refund of the OverTaxed IL service fee is appropriate under these Terms.
            </p>
            <p className="text-muted-foreground mb-3">
              Refund review does not apply when the county denies an appeal on the merits, when the property is not eligible, when the appeal window is closed before you provide required information or authorization, or when information you provided is inaccurate or incomplete.
            </p>
            <p className="text-muted-foreground">
              To request a refund, contact support@overtaxed-il.com within 30 days of the county notice and include the notice or filing status.
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
          By purchasing a service or using OverTaxed IL, you acknowledge that you have read and understood these Terms. OverTaxed IL does not request filing authorization, because it does not file.
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
