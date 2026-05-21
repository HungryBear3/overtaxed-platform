import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "../../ot-design.css";

export const metadata: Metadata = {
  title: "Packet Request Received | OverTaxed IL",
  description: "Your Cook County appeal packet request was received by OverTaxed IL.",
};

const nextSteps = [
  "Check your email for packet access or preview follow-up instructions.",
  "Confirm your township appeal window before filing anything with the Board of Review.",
  "Use the packet as methodology support, not as a guarantee of a lower assessment.",
];

export default function AppealPacketSuccessPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <main className="ot-section ot-section-cream ot-legacy-page">
        <div className="ot-legacy-inner">
        <section className="ot-method-panel" style={{ maxWidth: 920, margin: "0 auto" }}>
          <div>
            <p className="ot-eyebrow">Packet request received</p>
            <h1 className="ot-h2">Your Cook County appeal packet request is queued.</h1>
            <p className="ot-sublead">
              We keep this launch flow Cook County-specific: public Assessor records, Board of Review filing steps, township windows, and residential assessment-level context.
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
            <strong>Next steps</strong>
            <ul className="ot-list-check" style={{ marginTop: 12 }}>
              {nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            <p style={{ marginTop: 14 }}>
              OverTaxed IL is not a law firm and does not provide legal advice.
            </p>
          </div>
        </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
