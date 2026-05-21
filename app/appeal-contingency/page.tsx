"use client";

import Link from "next/link";
import { SiteHeader, SiteFooter, OT_PUBLIC_CONTACT } from "@/components/ot-design/SiteChrome";
import "../ot-design.css";

const reviewSteps = [
  "Run the free Cook County assessment check first.",
  "If the numbers suggest a larger case, send only your name, email, phone, and property address for a manual review.",
  "If the Board of Review grants a reduction under a signed contingency authorization, the fee is 22% of first-year tax savings, with the minimum shown before you sign.",
];

export default function ContingencyPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <main className="ot-section ot-section-cream ot-legacy-page">
        <div className="ot-legacy-inner">
        <div className="ot-section-head" style={{ textAlign: "left", maxWidth: 920 }}>
          <p className="ot-eyebrow">Contingency review · Larger Cook County cases</p>
          <h1 className="ot-h2">Want us to review whether a done-for-you contingency appeal makes sense?</h1>
          <p className="ot-sublead">
            Start with the same public-record check first. If the property appears materially over-assessed, we can review whether a contingency arrangement is appropriate. No reduction is guaranteed, and nothing is filed without your separate written authorization.
          </p>
          <div className="ot-hero-actions">
            <Link href="/#hero-check" className="ot-cta ot-cta-primary">
              Start free check <span className="ot-cta-arrow">→</span>
            </Link>
            <Link href="/contact" className="ot-cta ot-cta-secondary">
              Ask about contingency review
            </Link>
          </div>
        </div>

        <section className="ot-feature-strip" aria-label="Contingency review process">
          {reviewSteps.map((step, idx) => (
            <div key={step} className="ot-feature">
              <div className="ot-feature-kicker">Step {idx + 1}</div>
              <strong>{step}</strong>
            </div>
          ))}
        </section>

        <section className="ot-method-panel" style={{ marginTop: 28 }}>
          <div>
            <p className="ot-eyebrow">Fee terms</p>
            <h2 className="ot-h3">Only if the county grants a reduction.</h2>
            <p>
              For approved larger cases, contingency pricing is 22% of first-year tax savings if the Board of Review grants a reduction, with any minimum shown in the signed contingency authorization before work begins. If the county grants no reduction, no contingency fee is owed.
            </p>
          </div>
          <div className="ot-method-card">
            <strong>Privacy and scope</strong>
            <p>
              We collect only what is needed for the next review step, do not sell homeowner data, and do not provide legal advice. OverTaxed IL is not a law firm.
            </p>
            <p style={{ marginTop: 10 }}>
              Contact: <a href={`mailto:${OT_PUBLIC_CONTACT.email}`}>{OT_PUBLIC_CONTACT.email}</a> · <a href={OT_PUBLIC_CONTACT.phoneHref}>{OT_PUBLIC_CONTACT.phoneDisplay}</a>
            </p>
          </div>
        </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
