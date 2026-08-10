import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/ot-design/SiteChrome";
import "../ot-design.css";

export const metadata: Metadata = {
  title: "DIY Cook County Appeal Packet",
  description:
    "A $69 Cook County property-tax appeal packet: comparable-property summary, Board of Review filing instructions, deadline checklist, and plain-English next steps.",
};

const included = [
  {
    title: "Comparable-property summary",
    desc: "We organize nearby Cook County comparables so you can see whether your assessed value looks out of line.",
  },
  {
    title: "Assessment-level explanation",
    desc: "Plain-English context for Cook County's 10% residential target and uniformity review.",
  },
  {
    title: "Board of Review filing guide",
    desc: "A step-by-step checklist for submitting your packet during your township's appeal window.",
  },
  {
    title: "Deadline and evidence checklist",
    desc: "What to gather, what to double-check, and what to avoid before filing.",
  },
];

export default function AppealPacketPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="offer" />
      <main className="ot-section ot-section-cream ot-legacy-page">
        <div className="ot-legacy-inner">
        <div className="ot-section-head" style={{ textAlign: "left", maxWidth: 880 }}>
          <p className="ot-eyebrow">DIY appeal packet · Cook County only at launch</p>
          <h1 className="ot-h2">
            A clean $69 packet for homeowners who want to file their own Cook County appeal.
          </h1>
          <p className="ot-sublead">
            OverTaxed IL turns public Cook County Assessor and Board of Review records into a filing-ready packet: comps, assessment-level context, filing instructions, and a deadline checklist. No savings promises. No fake testimonials. Not legal advice.
          </p>
          <div className="ot-hero-actions">
            <Link href="/#hero-check" className="ot-cta ot-cta-primary">
              Start with a free check <span className="ot-cta-arrow">→</span>
            </Link>
            <Link href="/pricing" className="ot-cta ot-cta-secondary">
              Compare pricing
            </Link>
          </div>
        </div>

        <section className="ot-feature-strip" aria-label="Packet contents">
          {included.map((item) => (
            <div key={item.title} className="ot-feature">
              <div className="ot-feature-kicker">Included</div>
              <strong>{item.title}</strong>
              <span>{item.desc}</span>
            </div>
          ))}
        </section>

        <section className="ot-method-panel" style={{ marginTop: 28 }}>
          <div>
            <p className="ot-eyebrow">Scope discipline</p>
            <h2 className="ot-h3">Cook County first.</h2>
            <p>
              This launch product is built around Cook County's township appeal windows, Board of Review process, and residential assessment methodology. We are not advertising an all-Illinois county packet until those workflows are separately verified.
            </p>
          </div>
          <div className="ot-method-card">
            <strong>Flat fee</strong>
            <p>
              The $69 DIY packet is a preparation service fee and is paid regardless of appeal outcome. A procedural refund applies only if an OverTaxed IL filing error causes the county to reject the filing.
            </p>
          </div>
        </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
