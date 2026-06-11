import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter, OT_PUBLIC_CONTACT } from "@/components/ot-design/SiteChrome";
import "../../ot-design.css";

export const metadata: Metadata = {
  title: "Review Request Received",
  description: "OverTaxed IL received your Cook County contingency review request.",
};

export default function ContingencySuccessPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <main className="ot-section ot-section-cream ot-legacy-page">
        <div className="ot-legacy-inner">
        <section className="ot-method-panel" style={{ maxWidth: 920, margin: "0 auto" }}>
          <div>
            <p className="ot-eyebrow">Review request received</p>
            <h1 className="ot-h2">We received your Cook County contingency review request.</h1>
            <p className="ot-sublead">
              We will review the property and reply within 2 business days. Nothing is filed, and no contingency fee applies, unless you separately sign a written authorization.
            </p>
            <div className="ot-hero-actions">
              <Link href="/deadlines" className="ot-cta ot-cta-primary">
                Check township deadlines <span className="ot-cta-arrow">→</span>
              </Link>
              <Link href="/" className="ot-cta ot-cta-secondary">
                Return home
              </Link>
            </div>
          </div>
          <div className="ot-method-card">
            <strong>Bounded follow-up</strong>
            <p>
              If the Board of Review grants a reduction under a signed contingency authorization, the public contingency term is 22% of first-year tax savings, with any minimum shown before you sign.
            </p>
            <p style={{ marginTop: 12 }}>
              OverTaxed IL is not a law firm and does not provide legal advice.
            </p>
            <p style={{ marginTop: 12 }}>
              Questions: <a href={`mailto:${OT_PUBLIC_CONTACT.email}`}>{OT_PUBLIC_CONTACT.email}</a> · <a href={OT_PUBLIC_CONTACT.phoneHref}>{OT_PUBLIC_CONTACT.phoneDisplay}</a>
            </p>
          </div>
        </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
