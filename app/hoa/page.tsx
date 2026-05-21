// /hoa — public association/property-manager landing page.
// Reuses the production design system (ot-design.css + SiteHeader +
// SiteFooter). No personal-name attribution; no legal-representation
// claims; no unsupported pipeline/township-count claims; no per-unit
// upsell language. Business-first.
import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter, OT_PUBLIC_CONTACT } from "@/components/ot-design/SiteChrome";
import "../ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com";

export const metadata: Metadata = {
  title: "HOA & Condo Associations | OverTaxed IL",
  description:
    "Cook County association packet plan for HOA boards and property managers — multi-PIN organization, public-record evidence, deadline tracking, board-friendly summaries. Not a law firm; no legal representation.",
  alternates: { canonical: siteUrl + "/hoa" },
  openGraph: {
    type: "website",
    url: siteUrl + "/hoa",
    title: "OverTaxed IL — HOA & Condo Associations",
    description:
      "Multi-PIN packet plan for Cook County condo boards and HOA managers. Public-record evidence, deadline tracking, no per-unit upsell.",
    siteName: "OverTaxed IL",
  },
  robots: { index: true, follow: true },
};

export default function HoaPage() {
  return (
    <div className="ot-root">
      <SiteHeader active="home" />

      <main>
        {/* Hero */}
        <section className="ot-hero">
          <div className="ot-hero-inner">
            <div className="ot-hero-l">
              <div className="ot-eyebrow">HOA & condo associations</div>
              <h1 className="ot-h1">
                One packet plan. Every PIN in the association.
              </h1>
              <p className="ot-hero-sub">
                Condo boards and HOA property managers can run the same
                comparable-property + assessment-level packet across every
                Cook County PIN in the association. Built from public records.
                No legal-representation claim. No per-unit upsell.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
                <Link href="/contact" className="ot-cta">
                  Request an association packet plan <span className="ot-cta-arrow">→</span>
                </Link>
                <a href={`mailto:${OT_PUBLIC_CONTACT.email}`} className="ot-cta ot-cta-ghost">
                  Email {OT_PUBLIC_CONTACT.email}
                </a>
              </div>
              <p className="ot-hero-microcopy">
                Or call <a href={OT_PUBLIC_CONTACT.phoneHref}>{OT_PUBLIC_CONTACT.phoneDisplay}</a>{" "}
                — leave a board contact and PIN count and we&apos;ll respond with a packet plan and the next open township window.
              </p>
            </div>
          </div>
        </section>

        {/* What the packet plan includes — process-first, not outcome-first */}
        <section className="ot-section">
          <div className="ot-faq-inner">
            <div className="ot-eyebrow">What an association packet plan includes</div>
            <h2 className="ot-h2">Multi-PIN organization, public-record evidence, deadline tracking.</h2>
            <p className="ot-method-lede">
              The same plain-math, public-record approach OverTaxed IL uses
              for individual homeowners — organized for an association so
              every PIN gets the same evidence treatment without per-unit
              upsell or repeated intake.
            </p>

            <ul className="ot-method-list" style={{ marginTop: 16 }}>
              <li>
                <strong>Multi-PIN packet build.</strong> Every PIN in the
                association gets a comparable-properties + assessment-level
                packet drawn from public Cook County records.
              </li>
              <li>
                <strong>Township deadline tracking.</strong> Board and manager
                receive a clear timeline of which PINs are in cycle, which
                window is open next, and the procedural cut-off for each.
              </li>
              <li>
                <strong>Board-friendly summary.</strong> One short summary the
                board or property manager can share with residents — no jargon,
                no implied outcome guarantee.
              </li>
              <li>
                <strong>Filing support.</strong> Direct support for filing each
                PIN with the Cook County Assessor or Board of Review on the
                association&apos;s behalf or under your direction.
              </li>
              <li>
                <strong>One contact, no per-unit upsell.</strong> One business
                contact for the entire association. No legal-representation
                claim — OverTaxed IL is not a law firm and does not provide
                legal advice.
              </li>
            </ul>
          </div>
        </section>

        {/* Public-record evidence band — preserves the data/report visual system */}
        <section className="ot-section ot-section-method">
          <div className="ot-faq-inner">
            <div className="ot-eyebrow">How the evidence is built</div>
            <h2 className="ot-h2">Plain math on public records — same approach, scaled to the association.</h2>
            <p className="ot-method-lede">
              Comparable-property analysis and assessment-level data come from
              public Cook County Assessor and Board of Review sources. The
              packet shows the math, not a black box. Township windows are
              tracked from public Cook County records.
            </p>
          </div>
        </section>

        {/* Contact / next step */}
        <section className="ot-section">
          <div className="ot-faq-inner">
            <div className="ot-eyebrow">Next step</div>
            <h2 className="ot-h2">Tell us how many PINs you manage.</h2>
            <p className="ot-method-lede">
              Email{" "}
              <a href={`mailto:${OT_PUBLIC_CONTACT.email}`}>{OT_PUBLIC_CONTACT.email}</a>{" "}
              or call{" "}
              <a href={OT_PUBLIC_CONTACT.phoneHref}>{OT_PUBLIC_CONTACT.phoneDisplay}</a>{" "}
              with your association name, the rough number of PINs you manage,
              and a board or property-manager contact. We&apos;ll come back with
              a packet plan and a schedule that lines up with the next open
              township window. No legal advice — for legal questions an
              association should consult a licensed Illinois attorney.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}>
              <Link href="/contact" className="ot-cta">
                Use the contact form <span className="ot-cta-arrow">→</span>
              </Link>
              <a href={`mailto:${OT_PUBLIC_CONTACT.email}`} className="ot-cta ot-cta-ghost">
                Email {OT_PUBLIC_CONTACT.email}
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
