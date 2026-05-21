"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { buildTickerItems, TOWNSHIPS } from "@/lib/townships";

// Public-contact constants used by SiteChrome (footer text, contact CTAs).
// Personal-name attribution is intentionally NOT in this shared chrome
// export — shared chrome renders on every public page (including /hoa,
// footer, schema). Personal-name attribution lives on /about only.
export const OT_PUBLIC_CONTACT = {
  phoneDisplay: "(847) 461-3189",
  phoneHref: "tel:+18474613189",
  calendlyUrl: "/contact",
  email: "support@overtaxed-il.com",
} as const;

const FOOTER_TOWNSHIP_GROUPS = [
  {
    label: "South & West",
    cycle: "2026 cycle",
    count: TOWNSHIPS.filter((t) => t.district === "south-west-suburbs").length,
    examples: TOWNSHIPS.filter((t) => t.district === "south-west-suburbs" && t.status === "open")
      .slice(0, 4)
      .map((t) => ({ slug: t.slug, name: t.name })),
  },
  {
    label: "North Suburbs",
    cycle: "2027 cycle",
    count: TOWNSHIPS.filter((t) => t.district === "north-suburbs").length,
    examples: TOWNSHIPS.filter((t) => t.district === "north-suburbs")
      .slice(0, 3)
      .map((t) => ({ slug: t.slug, name: t.name })),
  },
  {
    label: "City of Chicago",
    cycle: "2028 cycle",
    count: TOWNSHIPS.filter((t) => t.district === "chicago").length,
    examples: TOWNSHIPS.filter((t) => t.district === "chicago")
      .slice(0, 3)
      .map((t) => ({ slug: t.slug, name: t.name })),
  },
];

export function SiteHeader({
  active = "home",
}: {
  active?: "home" | "method" | "offer" | "deadlines" | "faq";
}) {
  function scrollToPricing(e: React.MouseEvent<HTMLAnchorElement>) {
    if (typeof window === "undefined" || window.location.pathname !== "/") return;
    const target = document.getElementById("pricing");
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", "#pricing");
  }

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
          <a href="/#pricing" className={active === "offer" ? "is-active" : ""} onClick={scrollToPricing}>
            Pricing
          </a>
          <Link href="/deadlines" className={active === "deadlines" ? "is-active" : ""}>
            Deadlines
          </Link>
          <Link href="/#faq" className={active === "faq" ? "is-active" : ""}>
            FAQ
          </Link>
        </nav>
        <div className="ot-header-cta">
          <a href={OT_PUBLIC_CONTACT.calendlyUrl} className="ot-header-link" target="_blank" rel="noreferrer">
            Schedule call
          </a>
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
              <a href={`mailto:${OT_PUBLIC_CONTACT.email}`}>{OT_PUBLIC_CONTACT.email}</a>
              <a href={OT_PUBLIC_CONTACT.phoneHref}>{OT_PUBLIC_CONTACT.phoneDisplay}</a>
              <a href={OT_PUBLIC_CONTACT.calendlyUrl}>Schedule a call</a>
            </div>
          </div>

          <div className="ot-footer-col">
            <div className="ot-footer-col-head">Quick links</div>
            <ul className="ot-footer-links">
              <li><Link href="/#hero-check">Free check</Link></li>
              <li><Link href="/#pricing">Pricing</Link></li>
              <li><Link href="/deadlines">All township deadlines</Link></li>
              <li><Link href="/how-it-works">How it works</Link></li>
              <li><Link href="/#faq">FAQ</Link></li>
              <li><Link href="/contact">Contact</Link></li>
            </ul>
          </div>

          <div className="ot-footer-col ot-footer-col-townships">
            <div className="ot-footer-col-head">Townships</div>
            <div className="ot-footer-township-groups">
              {FOOTER_TOWNSHIP_GROUPS.map((group) => (
                <div key={group.label} className="ot-footer-township-group">
                  <Link href="/townships" className="ot-footer-township-group-head">
                    {group.label}
                    <span>{group.count} · {group.cycle}</span>
                  </Link>
                  <div className="ot-footer-township-examples">
                    {group.examples.map((t) => (
                      <Link key={t.slug} href={`/township/${t.slug}`}>{t.name}</Link>
                    ))}
                  </div>
                </div>
              ))}
              <Link href="/townships" className="ot-footer-link-all">
                See all 38 townships →
              </Link>
            </div>
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
        <span className="ot-ticker-eyebrow">Schedule checked regularly</span>
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
          <strong>Procedural refund</strong> if our filing error causes rejection
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
          <strong>Procedural refund policy</strong> if your township denies the filing on
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
          <strong>Procedural refund policy</strong>
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
        <strong>Schedule</strong>
      </span>
      <span className="ot-chip-text">
        <span className="ot-chip-label">
          Township schedules checked regularly
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
  const [inlineError, setInlineError] = useState("");

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
    setInlineError("");
    setLoading(true);
    try {
      const submittedInput = addr.trim();
      const res = await fetch("/api/free-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, mode: "address" }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok === false) {
        const message = data?.error ?? "We couldn't find a Cook County property for that address. Try your 14-digit PIN instead.";
        setInlineError(message);
        window.dispatchEvent(new CustomEvent("ot:free-check-result", {
          detail: { error: message, submittedInput },
        }));
      } else {
        window.dispatchEvent(new CustomEvent("ot:free-check-result", {
          detail: {
            result: data?.result ?? data,
            preview: Boolean(data?.preview || data?.mode === "preview_noop" || data?.source === "preview-noop"),
            submittedInput,
          },
        }));
      }
    } catch {
      const message = "We couldn't complete the lookup. Please try again, or enter your 14-digit PIN.";
      setInlineError(message);
      window.dispatchEvent(new CustomEvent("ot:free-check-result", {
        detail: { error: message, submittedInput: addr.trim() },
      }));
    }
    // Scroll to hero-check after surfacing the same preview result as the main form.
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
            placeholder="123 S Sample Ave, La Grange IL"
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
          <strong>Schedule</strong>
          &nbsp;updates
        </Link>
      </div>
      {inlineError && (
        <div className="ot-sticky-bar-error" role="alert">
          {inlineError}
        </div>
      )}
    </div>
  );
}
