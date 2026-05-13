"use client";
import Link from "next/link";
import { useState } from "react";
import {
  TOWNSHIPS_BY_SLUG,
  REFERENCE_DATE,
  TOWNSHIPS,
  type Township,
  type TownshipStatus,
} from "@/lib/townships";

const DISTRICT_LABEL: Record<string, string> = {
  "south-west-suburbs": "South & West Suburbs",
  "north-suburbs": "North Suburbs",
  "chicago": "City of Chicago",
};

function StatusPill({ status, size = "sm" }: { status: TownshipStatus; size?: "sm" | "md" }) {
  const map: Record<TownshipStatus, { label: string; cls: string }> = {
    "open": { label: "Open now", cls: "is-open" },
    "opening-soon": { label: "Opening soon", cls: "is-soon" },
    "closed": { label: "Closed", cls: "is-closed" },
  };
  const item = map[status];
  return (
    <span className={`ot-status-pill ot-status-${size} ${item.cls}`}>
      <span className="ot-status-dot" />
      {item.label}
    </span>
  );
}

function TownshipHero({ t }: { t: Township }) {
  const isOpen = t.status === "open";
  const isSoon = t.status === "opening-soon";
  const days = isOpen ? t.daysUntilClose : isSoon ? t.daysUntilOpen : null;
  const dayWord = isOpen ? "until close" : isSoon ? "until open" : "";

  return (
    <section className="ot-tp-hero">
      <div className="ot-tp-hero-inner">
        <nav className="ot-tp-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span>›</span>
          <Link href="/deadlines">Deadlines</Link>
          <span>›</span>
          <span>{t.name}</span>
        </nav>
        <div className="ot-tp-hero-grid">
          <div className="ot-tp-hero-main">
            <div className="ot-tp-status-row">
              <StatusPill status={t.status} size="md" />
              <span className="ot-tp-cycle-tag">{t.cycleYear} reassessment cycle</span>
            </div>
            <h1 className="ot-tp-h1">
              <span className="ot-tp-h1-name">{t.name} Township</span>
              <span className="ot-tp-h1-sub">
                {isOpen && <>property tax appeal window is <em>open now</em>.</>}
                {isSoon && <>appeal window <em>opens soon</em>.</>}
                {!isOpen && !isSoon && <>next reassessment is in <em>{t.cycleYear}</em>.</>}
              </span>
            </h1>
            <p className="ot-tp-sub">
              {DISTRICT_LABEL[t.district]} · Cook County, Illinois · {t.cycleYear} triennial reassessment.
              {isOpen && <> File a formal appeal with the Cook County Board of Review by <strong>{t.closeDateLong}</strong>.</>}
              {isSoon && <> The window opens <strong>{t.openDateLong}</strong> and closes <strong>{t.closeDateLong}</strong>.</>}
              {!isOpen && !isSoon && <> The next appeal window for {t.name} Township opens in {t.cycleYear}. We&apos;ll email you when it does.</>}
            </p>
            <div className="ot-tp-hero-cta-row">
              <Link href={`/#hero-check`} className="ot-cta">
                Run free check for my address <span className="ot-cta-arrow">→</span>
              </Link>
              <a href="#tp-reminder" className="ot-tp-secondary-link">
                Or get a reminder by email
              </a>
            </div>
          </div>
          <aside className="ot-tp-hero-card">
            {days !== null ? (
              <>
                <div className={`ot-tp-countdown ot-tp-countdown-${t.status}`}>
                  <div className="ot-tp-countdown-num">{days}</div>
                  <div className="ot-tp-countdown-label">days {dayWord}</div>
                </div>
                <div className="ot-tp-card-rule" />
              </>
            ) : (
              <div className="ot-tp-countdown ot-tp-countdown-closed">
                <div className="ot-tp-countdown-cycle">{t.cycleYear}</div>
                <div className="ot-tp-countdown-label">next cycle</div>
              </div>
            )}
            <dl className="ot-tp-card-dl">
              <div>
                <dt>Window opens</dt>
                <dd>{t.openDateLong}</dd>
              </div>
              <div>
                <dt>Window closes</dt>
                <dd>{t.closeDateLong}</dd>
              </div>
              <div>
                <dt>Reassessment cycle</dt>
                <dd>{t.cycleYear} (next: {t.cycleYear + 3})</dd>
              </div>
              <div>
                <dt>Filing body</dt>
                <dd>Cook County Board of Review</dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </section>
  );
}

function TownshipStats({ t }: { t: Township }) {
  const fmt$ = (n: number) => "$" + n.toLocaleString("en-US");
  return (
    <section className="ot-tp-stats">
      <div className="ot-tp-stats-inner">
        <div className="ot-tp-stats-head">
          <div className="ot-eyebrow">By the numbers</div>
          <h2 className="ot-h2">Public-record context for {t.name} Township.</h2>
          <p className="ot-tp-stats-sub">
            These are rounded public-record benchmarks used for orientation, not verified
            OverTaxed IL customer outcomes and not a guarantee of savings. Your
            property may differ — the only way to know is to{" "}
            <Link href="/#hero-check">run a free check</Link>.
          </p>
        </div>
        <div className="ot-tp-stats-grid">
          <div className="ot-tp-stat">
            <div className="ot-tp-stat-key">Average assessed value</div>
            <div className="ot-tp-stat-val">{fmt$(t.avgAssessed)}</div>
            <div className="ot-tp-stat-foot">single-family residential</div>
          </div>
          <div className="ot-tp-stat">
            <div className="ot-tp-stat-key">Illustrative reduction</div>
            <div className="ot-tp-stat-val">−{t.avgReduction.toFixed(1)}%</div>
            <div className="ot-tp-stat-foot">scenario for comparing costs</div>
          </div>
          <div className="ot-tp-stat ot-tp-stat-hero">
            <div className="ot-tp-stat-key">Illustrative savings</div>
            <div className="ot-tp-stat-val">{fmt$(t.avgSavings)}</div>
            <div className="ot-tp-stat-foot">example only · not a promise</div>
          </div>
        </div>
        <div className="ot-tp-stats-note">
          Source: Cook County public records and internal modeling. These figures are
          illustrative benchmarks until verified OverTaxed IL outcomes are
          published.{" "}
          <Link href="/#method">How we calculate this →</Link>
        </div>
      </div>
    </section>
  );
}

function TownshipCheckCta({ t }: { t: Township }) {
  const [address, setAddress] = useState("");
  return (
    <section className="ot-tp-check">
      <div className="ot-tp-check-inner">
        <div className="ot-tp-check-eyebrow">For your property</div>
        <h2 className="ot-tp-check-h2">
          See whether <em>your</em> {t.name} property is overassessed.
        </h2>
        <p className="ot-tp-check-sub">
          Free, takes 30 seconds, no signup. We pull your assessed value from
          the Cook County Assessor and compare it to public-record comparable properties in {t.name}.
        </p>
        <form
          className="ot-bottom-cta-form"
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = "/#hero-check";
          }}
        >
          <input
            type="text"
            placeholder={`Enter your ${t.name} address`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="ot-input"
            aria-label={`${t.name} address`}
          />
          <button type="submit" className="ot-cta">
            Run free check <span className="ot-cta-arrow">→</span>
          </button>
        </form>
        <div className="ot-tp-check-meta">
          {t.status === "open" ? (
            <>Window closes <strong>{t.closeDateLong}</strong> — about {t.daysUntilClose} days left.</>
          ) : t.status === "opening-soon" ? (
            <>Window opens <strong>{t.openDateLong}</strong> — about {t.daysUntilOpen} days away.</>
          ) : (
            <>{t.name}&apos;s next window opens in {t.cycleYear}. You can still check today to see what your savings would look like.</>
          )}
        </div>
      </div>
    </section>
  );
}

function TownshipNeighbors({ t }: { t: Township }) {
  const neighbors = (t.neighbors || [])
    .map((slug) => TOWNSHIPS_BY_SLUG[slug])
    .filter(Boolean);
  return (
    <section className="ot-tp-neighbors">
      <div className="ot-tp-neighbors-inner">
        <div className="ot-eyebrow">Nearby townships</div>
        <h2 className="ot-h2">If you have neighbors in other townships.</h2>
        <p className="ot-tp-neighbors-sub">
          Cook County townships often share property characteristics with their
          neighbors but have different appeal windows. Here&apos;s where the
          townships next to {t.name} stand right now.
        </p>
        <div className="ot-tp-neighbors-grid">
          {neighbors.map((n) => {
            const days = n.status === "open" ? n.daysUntilClose
                       : n.status === "opening-soon" ? n.daysUntilOpen
                       : null;
            const dayLabel = n.status === "open" ? "until close"
                           : n.status === "opening-soon" ? "until open"
                           : "next cycle";
            return (
              <Link key={n.slug} href={`/township/${n.slug}`} className="ot-tp-neighbor-card">
                <div className="ot-tp-neighbor-row">
                  <StatusPill status={n.status} size="sm" />
                  <span className="ot-tp-neighbor-cycle">{n.cycleYear}</span>
                </div>
                <div className="ot-tp-neighbor-name">{n.name} Township</div>
                {days !== null ? (
                  <div className="ot-tp-neighbor-days">
                    <strong>{days}</strong> days {dayLabel}
                  </div>
                ) : (
                  <div className="ot-tp-neighbor-days ot-tp-neighbor-days-soft">
                    Reopens {n.cycleYear}
                  </div>
                )}
                <div className="ot-tp-neighbor-window">
                  {n.openDateShort} – {n.closeDateShort}
                </div>
                <div className="ot-tp-neighbor-arrow">View {n.name} →</div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TownshipFaq({ t }: { t: Township }) {
  const items = [
    {
      q: `When does the ${t.name} Township appeal window open and close?`,
      a: <>The {t.cycleYear} window opens <strong>{t.openDateLong}</strong> and closes <strong>{t.closeDateLong}</strong>. After it closes, the next opportunity to formally appeal will be in {t.cycleYear + 3} (Cook County reassesses each township once every three years).</>,
    },
    {
      q: `What's the deadline to file an appeal in ${t.name}?`,
      a: <>The Board of Review appeal deadline for {t.name} Township is <strong>{t.closeDateLong}</strong>. Late filings are not accepted — there is no grace period and no appeal-by-mail postmark exception.</>,
    },
    {
      q: `What does it cost to appeal?`,
      a: <>The Cook County Board of Review charges no fee. OverTaxed IL offers a $69 DIY Appeal Packet, $97 Done-For-You filing after explicit authorization, and a 22% contingency option for eligible cases. You can also file on your own at no cost — see the <Link href="/#pricing">pricing details</Link>.</>,
    },
    {
      q: `What evidence do I need to appeal in ${t.name}?`,
      a: <>The Board of Review accepts comparable assessments, relevant sales evidence, lack-of-uniformity arguments (your assessment vs. similar properties), and condition-based evidence (recent photos, contractor estimates). We pull public-record comparable properties from {t.name} and surrounding townships automatically when you run a free check.</>,
    },
    {
      q: `Will appealing increase my taxes?`,
      a: <>No. The Board of Review can confirm or lower your assessed value but cannot raise it as a result of your appeal. The worst case is your assessment stays the same.</>,
    },
  ];
  return (
    <section className="ot-tp-faq">
      <div className="ot-tp-faq-inner">
        <div className="ot-eyebrow">Questions</div>
        <h2 className="ot-h2">{t.name} Township appeals — what people ask.</h2>
        <div className="ot-tp-faq-list">
          {items.map((item, i) => (
            <details key={i} className="ot-tp-faq-item" {...(i === 0 ? { open: true } : {})}>
              <summary>{item.q}</summary>
              <div className="ot-tp-faq-a">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function TownshipReminder({ t }: { t: Township }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await fetch("/api/reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, townshipSlug: t.slug }),
      });
    } catch {
      /* preview stub */
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <section id="tp-reminder" className="ot-tp-reminder">
        <div className="ot-tp-reminder-inner ot-tp-reminder-done">
          <div className="ot-reminder-block-check">✓</div>
          <h2 className="ot-tp-reminder-title">You&apos;re set.</h2>
          <p>
            We&apos;ll email you{" "}
            {t.status === "closed"
              ? `when ${t.name} Township's next window opens in ${t.cycleYear}`
              : `30 days before ${t.name} Township's window closes`},
            and once at 7 days out. Nothing else.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="tp-reminder" className="ot-tp-reminder">
      <div className="ot-tp-reminder-inner">
        <div className="ot-eyebrow">Reminder</div>
        <h2 className="ot-tp-reminder-title">Get a {t.name} deadline reminder by email.</h2>
        <p className="ot-tp-reminder-sub">
          We&apos;ll email you when {t.name}&apos;s window opens, 30 days
          before it closes, and one final note at 7 days out. Nothing else.
        </p>
        <form className="ot-tp-reminder-form" onSubmit={submit}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="ot-input"
            aria-label="Email address"
          />
          <button type="submit" className="ot-cta">
            Send me {t.name} reminders <span className="ot-cta-arrow">→</span>
          </button>
        </form>
        <div className="ot-tp-reminder-meta">
          One-tap unsubscribe in every email · No marketing
        </div>
      </div>
    </section>
  );
}

export default function TownshipPage({ township }: { township: Township }) {
  const cycleCount =
    TOWNSHIPS.filter((x) => x.cycleYear === township.cycleYear).length - 1;
  return (
    <>
      <TownshipHero t={township} />
      <TownshipStats t={township} />
      <section className="ot-tp-map">
        <div className="ot-tp-map-inner">
          <div className="ot-tp-map-head">
            <div>
              <div className="ot-eyebrow">Where this is</div>
              <h2 className="ot-h2">
                {township.name} sits in the {DISTRICT_LABEL[township.district]}.
              </h2>
              <p className="ot-tp-map-sub">
                Cook County&apos;s 38 townships are reassessed on a 3-year
                rotating cycle. {township.name} is in the{" "}
                <strong>{township.cycleYear}</strong> cycle, along with{" "}
                {cycleCount} other townships in the{" "}
                {DISTRICT_LABEL[township.district].toLowerCase()}.
              </p>
            </div>
            <Link href="/deadlines" className="ot-tp-secondary-link">
              See all 38 townships →
            </Link>
          </div>
        </div>
      </section>
      <TownshipCheckCta t={township} />
      <TownshipNeighbors t={township} />
      <TownshipFaq t={township} />
      <TownshipReminder t={township} />
    </>
  );
}
