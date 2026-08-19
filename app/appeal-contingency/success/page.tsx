import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter, OT_PUBLIC_CONTACT } from "@/components/ot-design/SiteChrome";
import { CC_10, CC_11 } from "@/lib/copy/canonical";
import "../../ot-design.css";

export const metadata: Metadata = {
  // Distinct from the layout default on purpose. Both routes now say the same
  // thing in the body, but a tab or history entry reading identically to
  // /appeal-contingency would hide which of the two a homeowner actually
  // landed on — and this is the one reached by someone who believes they
  // already submitted something.
  title: "No Review Request Is Pending",
  description:
    "OverTaxed IL no longer offers a percentage-of-savings appeal service. Nothing is pending and nothing is owed.",
  robots: { index: false, follow: true },
};

/**
 * This page used to confirm that a contingency review request had been
 * received. With `/api/contingency-intake` withdrawn, nothing can reach it
 * except a stale bookmark or a back-button — and confirming a submission that
 * cannot have happened is a worse failure than the offer was, because a
 * homeowner would then wait on a reply that is never coming, against a live
 * statutory deadline.
 */
export default function ContingencySuccessPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <main className="ot-section ot-section-cream ot-legacy-page">
        <div className="ot-legacy-inner">
          <section className="ot-method-panel" style={{ maxWidth: 920, margin: "0 auto" }}>
            <div>
              <p className="ot-eyebrow">Nothing is pending</p>
              <h1 className="ot-h2">We no longer offer a percentage-of-savings appeal service.</h1>
              <p className="ot-sublead">
                No review request is open, and no one is waiting to reply to you. Do not wait on us —
                if your township&apos;s window is open, the deadline is running.
              </p>
              <p className="ot-sublead">{CC_11}</p>
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
              <strong>What is offered</strong>
              <p>{CC_10}</p>
              <p style={{ marginTop: 12 }}>
                Questions: <a href={`mailto:${OT_PUBLIC_CONTACT.email}`}>{OT_PUBLIC_CONTACT.email}</a> ·{" "}
                <a href={OT_PUBLIC_CONTACT.phoneHref}>{OT_PUBLIC_CONTACT.phoneDisplay}</a>
              </p>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
