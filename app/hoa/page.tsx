import type { Metadata } from "next";
import Link from "next/link";
import { HoaNoticeTemplates, ResourceDownloadGroup, TrackedHoaLink } from "./hoa-client";
import "../ot-design.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com";

export const metadata: Metadata = {
  title: "HOA & Condo Resident Property Tax Resource",
  description:
    "A no-cost Cook County property tax deadline and assessment-check resource HOA boards and property managers can share with residents. No vendor agreement, referral fees, or board commitment.",
  alternates: { canonical: siteUrl + "/hoa" },
  openGraph: {
    type: "website",
    url: siteUrl + "/hoa",
    title: "OverTaxed IL — HOA & Condo Resident Resource",
    description:
      "Copy-ready resident notices for Cook County HOA boards and property managers. Owners check deadlines and assessments themselves.",
    siteName: "OverTaxed IL",
  },
  robots: { index: true, follow: true },
};

const todayLabel = "Updated for 2026 Cook County appeal windows";

export default function HoaPage() {
  return (
    <div className="ot-root">
      <HoaHeader />

      <main>
        <section className="ot-hero">
          <div className="ot-hero-inner">
            <div className="ot-hero-l">
              <div className="ot-eyebrow">HOA & condo resident resource</div>
              <h1 className="ot-h1">A free property tax resource for your residents.</h1>
              <p className="ot-hero-sub">
                Cook County HOAs, condo boards, and property managers can share OverTaxed IL
                as a no-cost owner education resource. No vendor agreement, no referral
                fees, no commitment from the board.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
                <a href="#resident-notices" className="ot-cta">
                  Preview the resident notice <span className="ot-cta-arrow">→</span>
                </a>
                <TrackedHoaLink
                  target="/deadlines"
                  source="hero_deadlines_button"
                  className="ot-cta ot-cta-ghost"
                >
                  Check township deadlines
                </TrackedHoaLink>
              </div>
              <ResourceDownloadGroup source="hero" />
              <p className="ot-hero-microcopy">
                {todayLabel}. Owners decide for themselves whether to act. OverTaxed IL is
                not a law firm and does not provide legal advice.
              </p>
            </div>

            <aside
              aria-label="What the association does"
              style={{
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: 24,
                background: "oklch(1 0 0 / 0.78)",
                boxShadow: "var(--shadow-md)",
              }}
            >
              <div className="ot-eyebrow">What we ask of you</div>
              <h2 style={{ margin: "10px 0 12px", fontSize: 28, lineHeight: 1.1 }}>
                Copy, share, or ignore.
              </h2>
              <p className="ot-method-lede" style={{ margin: 0 }}>
                Use the notice template in your normal resident email, portal post, or
                newsletter if it is useful. Owners can use the free deadline tracker and
                assessment check on their own.
              </p>
            </aside>
          </div>
        </section>

        <section className="ot-section">
          <div className="ot-faq-inner">
            <div className="ot-eyebrow">How it works</div>
            <h2 className="ot-h2">Three steps. Nothing comes back to the board.</h2>
            <ol className="ot-method-steps" style={{ marginTop: 24 }}>
              {[
                {
                  n: "01",
                  h: "You share a short notice",
                  p: "Use the ready-to-copy language below in your usual owner communication channel.",
                },
                {
                  n: "02",
                  h: "Owners check their own deadline and assessment",
                  p: "The free tools point owners to their township appeal window and help them compare their assessment against public-record data.",
                },
                {
                  n: "03",
                  h: "Owners decide whether to act",
                  p: "The association does not collect owner data, endorse a vendor, or take on an appeal decision.",
                },
              ].map((step) => (
                <li key={step.n}>
                  <div className="ot-method-num">{step.n}</div>
                  <div className="ot-method-body">
                    <h3>{step.h}</h3>
                    <p>{step.p}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="ot-section ot-section-method">
          <div className="ot-faq-inner">
            <div className="ot-eyebrow">What this is</div>
            <h2 className="ot-h2">A resident education resource, not a board tax project.</h2>
            <div
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                marginTop: 24,
              }}
            >
              <InfoCard
                title="Free tools for owners"
                body="Township deadline lookup and assessment check tools are available without a board agreement or resident signup."
              />
              <InfoCard
                title="Public-record orientation"
                body="The tools use Cook County Assessor and Board of Review public-record context to help owners understand where to look next."
              />
              <InfoCard
                title="No association commitment"
                body="No vendor agreement, no referral fee, no exclusivity, and no obligation to recommend any paid service."
              />
            </div>
          </div>
        </section>

        <section className="ot-section">
          <div className="ot-faq-inner">
            <div className="ot-eyebrow">What this is not</div>
            <h2 className="ot-h2">Plain boundaries make this easy to forward.</h2>
            <ul className="ot-method-list" style={{ marginTop: 16 }}>
              <li>
                <strong>Not legal advice.</strong> OverTaxed IL is not a law firm and does
                not provide legal advice or representation.
              </li>
              <li>
                <strong>Not a savings guarantee.</strong> Some owners may find appeal
                opportunities they otherwise would have missed; outcomes are never
                guaranteed.
              </li>
              <li>
                <strong>Not an association-level appeal.</strong> Cook County unit
                assessments are individual. Owners decide whether to check, prepare, or
                file.
              </li>
              <li>
                <strong>Not a data handoff.</strong> The association does not send us owner
                lists. Owners use the tools voluntarily.
              </li>
            </ul>
          </div>
        </section>

        <section id="resident-notices" className="ot-section ot-section-method">
          <div className="ot-faq-inner">
            <div className="ot-eyebrow">Resident notice templates</div>
            <h2 className="ot-h2">Copy this into your owner newsletter.</h2>
            <p className="ot-method-lede">
              Use as-is, edit freely, or ignore. The templates are written to make clear
              that the board is sharing an informational resource, not endorsing an
              outcome.
            </p>
            <ResourceDownloadGroup
              source="resident_notice_section"
              primaryLabel="Download the resident resource flyer"
              helperText="Prefer to copy-paste? Use the notices below."
            />
            <HoaNoticeTemplates />
          </div>
        </section>

        <section className="ot-section">
          <div className="ot-faq-inner">
            <div className="ot-eyebrow">Common questions</div>
            <h2 className="ot-h2">Answers for managers and boards.</h2>
            <div style={{ display: "grid", gap: 18, marginTop: 24 }}>
              <FaqItem
                q="Are we endorsing a vendor by sharing this?"
                a="No. The notice can be shared as a public information resource the same way a township deadline reminder would be. The association does not need to recommend, sponsor, or sign an agreement with any service provider."
              />
              <FaqItem
                q="Owners handle property taxes individually. Why should we share this?"
                a="Exactly because owners handle it individually. The board's role is only resident education: make sure owners know where to check their township window before it closes."
              />
              <FaqItem
                q="Will this create work for the property manager?"
                a="It should not. The copy is ready to paste into your existing newsletter or resident portal. Owner questions can go to OverTaxed IL or the county resources linked from the tools."
              />
              <FaqItem
                q="Is this legal advice?"
                a="No. OverTaxed IL is not a law firm. The tools explain public records and deadline context; owners decide whether to act or consult a licensed Illinois attorney."
              />
            </div>
          </div>
        </section>

        <section className="ot-section ot-section-method">
          <div className="ot-faq-inner">
            <div className="ot-eyebrow">Use the tools directly</div>
            <h2 className="ot-h2">No form, no call, no gate.</h2>
            <p className="ot-method-lede">
              If you do not need the notice template, you can simply point owners to the
              free deadline tracker or assessment check.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
              <TrackedHoaLink
                target="/deadlines"
                source="footer_deadlines_link"
                className="ot-cta"
              >
                Township deadline tracker <span className="ot-cta-arrow">→</span>
              </TrackedHoaLink>
              <TrackedHoaLink target="/check" source="footer_check_link" className="ot-cta ot-cta-ghost">
                Free assessment check
              </TrackedHoaLink>
            </div>
          </div>
        </section>
      </main>

      <HoaFooter />
    </div>
  );
}

function HoaHeader() {
  return (
    <header className="ot-header">
      <div className="ot-header-inner">
        <Link href="/" className="ot-logo">
          <span className="ot-logo-mark">●</span>
          <span className="ot-logo-name">OverTaxed</span>
          <span className="ot-logo-tld">IL</span>
        </Link>
        <nav className="ot-nav">
          <a href="#resident-notices">Resident notice</a>
          <TrackedHoaLink target="/deadlines" source="explainer_deadlines_link">
            Deadlines
          </TrackedHoaLink>
          <TrackedHoaLink target="/check" source="explainer_check_link">
            Free check
          </TrackedHoaLink>
        </nav>
        <div className="ot-header-cta">
          <TrackedHoaLink target="/deadlines" source="hero_deadlines_button" className="ot-cta ot-cta-sm">
            Check deadlines
          </TrackedHoaLink>
        </div>
      </div>
    </header>
  );
}

function HoaFooter() {
  return (
    <footer className="ot-footer">
      <div className="ot-footer-inner">
        <div className="ot-footer-bottom">
          <div className="ot-footer-copy">© 2026 OverTaxed IL · Chicago, IL</div>
          <div className="ot-footer-meta">
            {todayLabel} · <Link href="/privacy">Privacy</Link> ·{" "}
            <Link href="/terms">Terms</Link> ·{" "}
            <a href="mailto:support@overtaxed-il.com">support@overtaxed-il.com</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 18,
        background: "var(--background)",
      }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>{title}</h3>
      <p style={{ margin: 0, color: "var(--ink-soft)", lineHeight: 1.6 }}>{body}</p>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 18 }}>{q}</h3>
      <p style={{ margin: 0, color: "var(--ink-soft)", lineHeight: 1.65 }}>{a}</p>
    </div>
  );
}
