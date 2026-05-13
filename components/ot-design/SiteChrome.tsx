"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { buildTickerItems, TOWNSHIP_STATUS_COUNTS } from "@/lib/townships";

// Featured townships shown in the footer. These point at the canonical
// `/township/[slug]` detail route. List below tracks the South-district 2026
// triennial cycle (the cohort currently open or opening soon). When the cycle
// rolls to North/Northwest, refresh this list.
const FOOTER_TOWNSHIPS = [
  { slug: "bloom", name: "Bloom" },
  { slug: "bremen", name: "Bremen" },
  { slug: "calumet", name: "Calumet" },
  { slug: "rich", name: "Rich" },
  { slug: "thornton", name: "Thornton" },
  { slug: "worth", name: "Worth" },
];

export function SiteHeader({
  active = "home",
}: {
  active?: "home" | "method" | "offer" | "deadlines" | "faq";
}) {
  return (
    <header className="ot-header">
      <div className="ot-header-inner">
        <Link href="/" className="ot-logo">
          <span className="ot-logo-mark">●</span>
          <span className="ot-logo-name">OverTaxed</span>
          <span className="ot-logo-tld">IL</span>
        </Link>
        <nav className="ot-nav">
          <Link href="/#method" className={active === "method" ? "is-active" : ""}>
            How it works
          </Link>
          <Link href="/#offer" className={active === "offer" ? "is-active" : ""}>
            Pricing
          </Link>
          <Link href="/deadlines" className={active === "deadlines" ? "is-active" : ""}>
            Deadlines
          </Link>
          <Link href="/#faq" className={active === "faq" ? "is-active" : ""}>
            FAQ
          </Link>
        </nav>
        <div className="ot-header-cta">
          <Link href="/auth/signin" className="ot-header-link">
            Sign in
          </Link>
          <Link href="/#hero-check" className="ot-cta ot-cta-sm">
            Free check
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="ot-footer ot-footer-grid">
      <div className="ot-footer-inner">
        <div className="ot-footer-cols">
          <div className="ot-footer-col ot-footer-col-brand">
            <div className="ot-footer-brand">
              <span className="ot-logo-mark">●</span> OverTaxed IL
            </div>
            <div className="ot-footer-tagline">
              Cook County property tax appeals, built for homeowners.
            </div>
            <div className="ot-footer-contact">
              <a href="mailto:support@overtaxed-il.com">support@overtaxed-il.com</a>
            </div>
          </div>

          <div className="ot-footer-col">
            <div className="ot-footer-col-head">Quick links</div>
            <ul className="ot-footer-links">
              <li><Link href="/#hero-check">Free check</Link></li>
              <li><Link href="/#offer">Pricing</Link></li>
              <li><Link href="/deadlines">All township deadlines</Link></li>
              <li><Link href="/how-it-works">How it works</Link></li>
              <li><Link href="/#faq">FAQ</Link></li>
              <li><Link href="/contact">Contact</Link></li>
            </ul>
          </div>

          <div className="ot-footer-col">
            <div className="ot-footer-col-head">Townships</div>
            <ul className="ot-footer-links">
              {FOOTER_TOWNSHIPS.map((t) => (
                <li key={t.slug}>
                  <Link href={`/township/${t.slug}`}>{t.name}</Link>
                </li>
              ))}
              <li>
                <Link href="/townships" className="ot-footer-link-all">
                  See all 38 →
                </Link>
              </li>
            </ul>
          </div>

          <div className="ot-footer-col ot-footer-col-legal">
            <div className="ot-footer-col-head">About</div>
            <p className="ot-footer-disclaimer">
              OverTaxed IL is not a law firm and does not provide legal advice.
              Estimates are based on public Cook County Assessor records and may
              vary from final Board of Review outcomes.
            </p>
          </div>
        </div>

        <div className="ot-footer-bottom">
          <div className="ot-footer-copy">© 2026 OverTaxed IL · Chicago, IL</div>
          <div className="ot-footer-meta">
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · Public-record estimates, not legal advice
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Locked-on Live Ticker. Cross-fades 4 items every 6s; pauses on hover.
 */
export function LiveTicker() {
  const items = buildTickerItems();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || items.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(t);
  }, [paused, items.length]);

  if (items.length === 0) return null;

  return (
    <div
      className="ot-ticker"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-live="polite"
      aria-label="Live appeal activity"
    >
      <div className="ot-ticker-inner">
        <span className="ot-ticker-dot" aria-hidden="true" />
        <span className="ot-ticker-eyebrow">Live</span>
        <span className="ot-ticker-track">
          {items.map((it, i) => (
            <span
              key={i}
              className={"ot-ticker-item" + (i === idx ? " is-active" : "")}
              aria-hidden={i !== idx}
            >
              {it}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/**
 * Risk-reversal rail. Locked ON. Icon-only at rest; full label only on
 * hover via `:hover` styling in ot-design.css (the .ot-risk-rail-label
 * stays visible-on-hover by the design's stylesheet — we don't need
 * special handling here).
 */
const RISK_ITEMS = [
  {
    id: "money",
    icon: "$",
    label: "Money-back",
    full: "100% money-back on procedural denial.",
  },
  {
    id: "signup",
    icon: "⌗",
    label: "No signup",
    full: "Run the check — no account required.",
  },
  {
    id: "card",
    icon: "○",
    label: "No credit card",
    full: "No card needed to see your overpayment.",
  },
];

export function RiskReversalRail() {
  return (
    <aside className="ot-risk-rail ot-risk-rail-collapsed" aria-label="Buyer protections">
      <ul className="ot-risk-rail-list">
        {RISK_ITEMS.map((it) => (
          <li key={it.id} className="ot-risk-rail-item" title={it.full}>
            <span className="ot-risk-rail-icon" aria-hidden="true">
              {it.icon}
            </span>
            <span className="ot-risk-rail-label">{it.label}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function RiskReversalBadge({
  variant = "full",
}: {
  variant?: "full" | "compact" | "inline";
}) {
  if (variant === "compact") {
    return (
      <span className="ot-rrb ot-rrb-compact">
        <span className="ot-rrb-shield" aria-hidden="true">
          ○
        </span>
        <span className="ot-rrb-text">
          <strong>Money-back</strong> on procedural denial
        </span>
      </span>
    );
  }
  if (variant === "inline") {
    return (
      <div className="ot-rrb ot-rrb-inline">
        <span className="ot-rrb-shield" aria-hidden="true">
          ○
        </span>
        <span className="ot-rrb-text">
          <strong>100% money-back</strong> if your township denies the filing on
          procedural grounds
        </span>
      </div>
    );
  }
  return (
    <div className="ot-rrb ot-rrb-full">
      <div className="ot-rrb-icon" aria-hidden="true">
        ○
      </div>
      <div className="ot-rrb-body">
        <div className="ot-rrb-head">
          <strong>100% money-back guarantee</strong>
        </div>
        <div className="ot-rrb-sub">
          If your township denies the filing on procedural grounds, we refund
          your packet — no questions, no upsell.
        </div>
      </div>
    </div>
  );
}

export function StatusChip() {
  return (
    <Link href="/deadlines" className="ot-chip ot-chip-link">
      <span className="ot-pill ot-pill-open" aria-hidden="true">
        <span className="ot-pill-dot" />
        <strong>{TOWNSHIP_STATUS_COUNTS.open}</strong>
        <span className="ot-pill-of">/ {TOWNSHIP_STATUS_COUNTS.total}</span>
      </span>
      <span className="ot-chip-text">
        <span className="ot-chip-label">
          township windows open now in Cook County
        </span>
      </span>
      <span className="ot-chip-arrow" aria-hidden="true">
        →
      </span>
    </Link>
  );
}

/**
 * StickyAddressBar — locked ON. Slides in after the user scrolls past the
 * hero check card.
 */
export function StickyAddressBar() {
  const [visible, setVisible] = useState(false);
  const [addr, setAddr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const target = document.getElementById("hero-check");
    if (!target || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        setVisible(!e.isIntersecting && e.boundingClientRect.top < 0);
      },
      { threshold: 0, rootMargin: "-80px 0px 0px 0px" },
    );
    io.observe(target);
    return () => io.disconnect();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !addr.trim()) return;
    setLoading(true);
    try {
      await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
    } catch {
      /* preview stub — ignore */
    }
    // Scroll to hero-check; the hero form will surface the SAMPLE_RESULT on
    // its own. For Pass 1 we just trigger a smooth scroll back up.
    const el = document.getElementById("hero-check");
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
    setLoading(false);
  }

  return (
    <div
      className={`ot-sticky-bar${visible ? " ot-sticky-bar--visible" : ""}`}
      role="region"
      aria-label="Quick assessment check"
      aria-hidden={!visible}
    >
      <div className="ot-sticky-bar-inner">
        <Link
          href="/#hero-check"
          className="ot-sticky-bar-brand"
          aria-label="OverTaxed IL — back to top"
        >
          <span className="ot-logo-mark">●</span>
          <span className="ot-sticky-bar-brand-name">OverTaxed IL</span>
        </Link>

        <form className="ot-sticky-bar-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="ot-sticky-bar-input"
            placeholder="123 N Main St, Chicago IL"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            aria-label="Property address"
            autoComplete="street-address"
          />
          <button
            type="submit"
            className="ot-cta ot-cta-sm ot-sticky-bar-cta"
            disabled={loading}
          >
            {loading ? "Checking…" : "Check my assessment"}
          </button>
        </form>

        <Link
          href="/deadlines"
          className="ot-sticky-bar-pill"
          title="See all township deadlines"
        >
          <span className="ot-sticky-bar-pill-dot" aria-hidden="true" />
          <strong>{TOWNSHIP_STATUS_COUNTS.open}</strong>
          &nbsp;windows open
        </Link>
      </div>
    </div>
  );
}
