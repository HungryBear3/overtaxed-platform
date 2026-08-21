"use client";

import Link from "next/link";
import { SiteHeader, SiteFooter, OT_PUBLIC_CONTACT } from "@/components/ot-design/SiteChrome";
import { CC_10, CC_11, CC_12 } from "@/lib/copy/canonical";
import "../ot-design.css";

/**
 * The contingency arrangement is withdrawn.
 *
 * The page is kept, not deleted. Its URL is in search results, in previous
 * emails, and in links from other sites; a 404 would leave a homeowner who
 * followed one with nothing, and deleting a route is a disposition decision
 * that is not the implementer's to make. What is removed is the offer: the
 * 22%-of-first-year-savings term, the "only if the county grants a reduction"
 * framing (BL-A5), and the intake path into it.
 *
 * It is also the page where CC-11 matters most. A contingency appeal is a
 * Board of Review posture, and Board Rule 1 permits only a licensed attorney
 * or the taxpayer personally to practise there — so this was never a product
 * that could be delivered as described, at any percentage.
 */
export default function ContingencyPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <main className="ot-section ot-section-cream ot-legacy-page">
        <div className="ot-legacy-inner">
          <div className="ot-section-head" style={{ textAlign: "left", maxWidth: 920 }}>
            <p className="ot-eyebrow">Cook County property tax appeals</p>
            <h1 className="ot-h2">We no longer offer a percentage-of-savings appeal service.</h1>
            <p className="ot-sublead">
              If you reached this page from an older link or email, nothing is owed and nothing is
              pending. There is no request to withdraw and no arrangement to cancel.
            </p>
            <p className="ot-sublead">{CC_11}</p>
            <div className="ot-hero-actions">
              <Link href="/#hero-check" className="ot-cta ot-cta-primary">
                Run the free check <span className="ot-cta-arrow">→</span>
              </Link>
              <Link href="/deadlines" className="ot-cta ot-cta-secondary">
                Check township deadlines
              </Link>
            </div>
          </div>

          <section className="ot-method-panel" style={{ marginTop: 28 }}>
            <div>
              <p className="ot-eyebrow">What is offered</p>
              <h2 className="ot-h3">One flat-fee preparation packet.</h2>
              <p>{CC_10}</p>
              <p style={{ marginTop: 10 }}>{CC_12}</p>
            </div>
            <div className="ot-method-card">
              <strong>Privacy and scope</strong>
              <p>
                We collect only what is needed for the next step, do not sell homeowner data, and do
                not provide legal advice.
              </p>
              <p style={{ marginTop: 10 }}>
                Contact: <a href={`mailto:${OT_PUBLIC_CONTACT.email}`}>{OT_PUBLIC_CONTACT.email}</a> ·{" "}
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
