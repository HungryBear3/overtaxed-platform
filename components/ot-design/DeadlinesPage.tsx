"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  TOWNSHIPS,
  TOWNSHIP_STATUS_COUNTS,
  TOWNSHIPS_BY_SLUG,
  REFERENCE_DATE,
  type Township,
  type TownshipStatus,
} from "@/lib/townships";

function StatusPill({
  status,
  size = "sm",
}: {
  status: TownshipStatus;
  size?: "sm" | "md";
}) {
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

function DeadlinesHero() {
  const c = TOWNSHIP_STATUS_COUNTS;
  return (
    <section className="ot-page-hero">
      <div className="ot-page-hero-inner">
        <div className="ot-page-eyebrow">A free tool from OverTaxed IL</div>
        <h1 className="ot-page-h1">
          Cook County property tax<br />
          <span className="ot-page-h1-tail">appeal deadlines.</span>
        </h1>
        <p className="ot-page-sub">
          All 38 townships, tracked from public Cook County Board of Review records.
          See whose window is open, who&apos;s up next, and when yours closes.
        </p>
        <div className="ot-status-summary">
          <div className="ot-status-summary-item">
            <span className="ot-status-summary-num" style={{ color: "var(--success)" }}>{c.open}</span>
            <span className="ot-status-summary-label">open now</span>
          </div>
          <div className="ot-status-summary-divider" />
          <div className="ot-status-summary-item">
            <span className="ot-status-summary-num" style={{ color: "oklch(0.55 0.16 60)" }}>{c["opening-soon"]}</span>
            <span className="ot-status-summary-label">opening soon</span>
          </div>
          <div className="ot-status-summary-divider" />
          <div className="ot-status-summary-item">
            <span className="ot-status-summary-num" style={{ color: "var(--ink-soft)" }}>{c.closed}</span>
            <span className="ot-status-summary-label">closed</span>
          </div>
        </div>
        <div className="ot-page-hero-meta">
          Data refreshed: {REFERENCE_DATE.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
        </div>
      </div>
    </section>
  );
}

function PageReminderCapture() {
  const [email, setEmail] = useState("");
  const [slug, setSlug] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !slug) return;
    try {
      await fetch("/api/reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, townshipSlug: slug }),
      });
    } catch {
      /* preview stub */
    }
    setSubmitted(true);
  }

  if (submitted) {
    const t = TOWNSHIPS_BY_SLUG[slug];
    return (
      <div className="ot-reminder-block ot-reminder-block-done">
        <div className="ot-reminder-block-check">✓</div>
        <div className="ot-reminder-block-title">You&apos;re set.</div>
        <p>
          We&apos;ll email you when <strong>{t?.name} Township</strong>&apos;s window opens
          ({t?.openDateLong}), 30 days before it closes, and once at 7 days out.
          Nothing else.
        </p>
      </div>
    );
  }

  return (
    <div className="ot-reminder-block">
      <div className="ot-reminder-block-eyebrow">Get a reminder</div>
      <h2 className="ot-reminder-block-title">
        Get a reminder before your township&apos;s window closes.
      </h2>
      <p className="ot-reminder-block-body">
        We&apos;ll email you when your window opens, 30 days before close, and 7 days
        before close. Nothing else.
      </p>
      <form className="ot-reminder-block-form" onSubmit={submit}>
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="ot-input"
          aria-label="Email address"
        />
        <select
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="ot-input"
          aria-label="Township"
        >
          <option value="">Select your township…</option>
          {TOWNSHIPS.map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
        </select>
        <button type="submit" className="ot-cta">
          Send me reminders <span className="ot-cta-arrow">→</span>
        </button>
      </form>
    </div>
  );
}

const SORTERS: Record<string, (a: Township, b: Township) => number> = {
  soonest: (a, b) => {
    const score = (t: Township) => {
      if (t.status === "open") return t.daysUntilClose;
      if (t.status === "opening-soon") return 100 + t.daysUntilOpen;
      return 10000 + t.daysUntilOpen;
    };
    return score(a) - score(b);
  },
  alpha: (a, b) => a.name.localeCompare(b.name),
};

function TownshipsTable() {
  const [filter, setFilter] = useState<"all" | TownshipStatus>("all");
  const [sort, setSort] = useState<"soonest" | "alpha">("soonest");

  const rows = useMemo(() => {
    const filtered = filter === "all" ? TOWNSHIPS : TOWNSHIPS.filter((t) => t.status === filter);
    return [...filtered].sort(SORTERS[sort]);
  }, [filter, sort]);

  const filterButtons: Array<{ id: "all" | TownshipStatus; label: string; count: number }> = [
    { id: "all", label: "All", count: TOWNSHIPS.length },
    { id: "open", label: "Open now", count: TOWNSHIP_STATUS_COUNTS.open },
    { id: "opening-soon", label: "Opening soon", count: TOWNSHIP_STATUS_COUNTS["opening-soon"] },
    { id: "closed", label: "Closed", count: TOWNSHIP_STATUS_COUNTS.closed },
  ];

  const formatDays = (t: Township) => {
    if (t.status === "open") return `${t.daysUntilClose} until close`;
    if (t.status === "opening-soon") return `${t.daysUntilOpen} until open`;
    const yearsOut = Math.max(0, t.cycleYear - REFERENCE_DATE.getUTCFullYear());
    return yearsOut > 0 ? `~${yearsOut} year${yearsOut !== 1 ? "s" : ""}` : "—";
  };

  return (
    <section className="ot-tbl-section">
      <div className="ot-tbl-inner">
        <div className="ot-tbl-head">
          <h2 className="ot-h2">Every township, every deadline.</h2>
          <div className="ot-tbl-controls">
            <div className="ot-tbl-filter">
              {filterButtons.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`ot-tbl-filter-btn ${filter === b.id ? "is-active" : ""}`}
                  onClick={() => setFilter(b.id)}
                >
                  {b.label}
                  <span className="ot-tbl-filter-count">{b.count}</span>
                </button>
              ))}
            </div>
            <div className="ot-tbl-sort">
              <label htmlFor="ot-tbl-sort">Sort</label>
              <select
                id="ot-tbl-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as "soonest" | "alpha")}
                className="ot-input ot-input-sm"
              >
                <option value="soonest">Closing soonest</option>
                <option value="alpha">Alphabetical</option>
              </select>
            </div>
          </div>
        </div>
        <div className="ot-tbl-wrap">
          <table className="ot-tbl">
            <thead>
              <tr>
                <th scope="col">Township</th>
                <th scope="col">Status</th>
                <th scope="col">Window</th>
                <th scope="col">Days</th>
                <th scope="col">Cycle</th>
                <th scope="col" aria-label="Open township page" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.slug} className={`ot-tbl-row ot-tbl-row-${t.status}`}>
                  <td className="ot-tbl-name">
                    <Link href={`/township/${t.slug}`}>{t.name}</Link>
                  </td>
                  <td><StatusPill status={t.status} size="sm" /></td>
                  <td className="ot-tbl-window">{t.openDateShort} – {t.closeDateShort}</td>
                  <td className="ot-tbl-days">{formatDays(t)}</td>
                  <td className="ot-tbl-cycle">{t.cycleYear}</td>
                  <td className="ot-tbl-arrow">
                    <Link href={`/township/${t.slug}`} aria-label={`See ${t.name} details`}>→</Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="ot-tbl-empty">No townships match this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function BottomCheckCta() {
  return (
    <section className="ot-bottom-cta">
      <div className="ot-bottom-cta-inner">
        <div className="ot-bottom-cta-eyebrow">While you&apos;re here</div>
        <h2 className="ot-h2">Check if your assessment is too high.</h2>
        <p className="ot-bottom-cta-sub">
          Knowing the deadline is half of it. The other half is knowing whether
          your assessed value is actually out of line with comparable properties.
          Free, takes 30 seconds, no signup.
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
            placeholder="Enter your Cook County address"
            className="ot-input"
            aria-label="Cook County address"
          />
          <button type="submit" className="ot-cta">
            Run free check <span className="ot-cta-arrow">→</span>
          </button>
        </form>
        <div className="ot-bottom-cta-meta">
          See your specific overpayment estimate before you decide whether to file.
        </div>
      </div>
    </section>
  );
}

/**
 * Pass 1: Static township grid instead of the interactive map.
 * The interactive SVG map + floating card + hover/click filtering is
 * deferred. The grid below preserves the visible content (slug, status,
 * window dates) and a link to the per-township page, which is what the
 * map drives users to anyway.
 */
function TownshipGrid() {
  const groups: Record<TownshipStatus, Township[]> = {
    "open": TOWNSHIPS.filter((t) => t.status === "open"),
    "opening-soon": TOWNSHIPS.filter((t) => t.status === "opening-soon"),
    "closed": TOWNSHIPS.filter((t) => t.status === "closed"),
  };
  return (
    <section className="ot-fullmap">
      <div className="ot-fullmap-inner">
        <div className="ot-fullmap-head">
          <div>
            <h2 className="ot-h2">All 38 townships at a glance.</h2>
            <p className="ot-fullmap-sub">
              Click any township to see its window status and a complete deadline
              summary.
            </p>
          </div>
        </div>
        <div className="ot-fullmap-stage" style={{ minHeight: 0 }}>
          <div className="ot-fullmap-grid">
            {(["open", "opening-soon", "closed"] as TownshipStatus[]).map(
              (status) => (
                <div key={status} className={`ot-fullmap-group ot-fullmap-group-${status}`}>
                  <div className="ot-fullmap-group-head">
                    <StatusPill status={status} />
                    <span className="ot-fullmap-group-count">{groups[status].length}</span>
                  </div>
                  <ul className="ot-fullmap-group-list">
                    {groups[status].map((t) => (
                      <li key={t.slug}>
                        <Link href={`/township/${t.slug}`} className="ot-fullmap-twp">
                          <span className="ot-fullmap-twp-name">{t.name}</span>
                          <span className="ot-fullmap-twp-dates">
                            {t.openDateShort} – {t.closeDateShort}, {t.cycleYear}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        </div>
        <div className="ot-fullmap-foot">
          Three triennial reassessment districts: 2026 South & West Suburbs,
          2027 North Suburbs, 2028 City of Chicago.
        </div>
      </div>
    </section>
  );
}

export default function DeadlinesPage() {
  return (
    <>
      <DeadlinesHero />
      <section className="ot-reminder-section">
        <div className="ot-reminder-section-inner">
          <PageReminderCapture />
        </div>
      </section>
      <TownshipGrid />
      <TownshipsTable />
      <BottomCheckCta />
    </>
  );
}
