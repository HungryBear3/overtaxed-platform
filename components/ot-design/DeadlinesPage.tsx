"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TOWNSHIPS, TOWNSHIPS_BY_SLUG, type Township } from "@/lib/townships";
import { OT_PUBLIC_CONTACT } from "@/components/ot-design/SiteChrome";
import {
  OFFICIAL_DEADLINE_SOURCES,
  DEADLINE_VERIFY_NOTICE,
  ASSESSOR_CALENDAR_URL,
} from "@/lib/deadline-sources";
import { TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED } from "@/lib/appeals/township-deadlines";
import {
  buildTownship2026Views,
  count2026Views,
  type Deadline2026Status,
  type Township2026View,
} from "@/lib/deadlines-2026";

// Built once from official Tax Year 2026 data. Townships without a published
// Assessor Last File Date are "pending" and never show a specific date.
const VIEWS: Township2026View[] = buildTownship2026Views();
const COUNTS = count2026Views(VIEWS);
const PENDING_LABEL = "Pending official date";

function StatusPill({
  status,
  size = "sm",
}: {
  status: Deadline2026Status;
  size?: "sm" | "md";
}) {
  const map: Record<Deadline2026Status, { label: string; cls: string; dot?: string }> = {
    open: { label: "Open", cls: "is-open" },
    closed: { label: "Closed", cls: "is-closed" },
    pending: { label: "Pending date", cls: "is-closed", dot: "var(--ink-soft, #9a8f80)" },
  };
  const item = map[status];
  return (
    <span className={`ot-status-pill ot-status-${size} ${item.cls}`}>
      <span className="ot-status-dot" style={item.dot ? { background: item.dot } : undefined} />
      {item.label}
    </span>
  );
}

function DeadlinesHero() {
  return (
    <section className="ot-page-hero">
      <div className="ot-page-hero-inner">
        <div className="ot-page-eyebrow">A free tool from OverTaxed IL</div>
        <h1 className="ot-page-h1">
          Cook County property tax<br />
          <span className="ot-page-h1-tail">appeal deadlines.</span>
        </h1>
        <p className="ot-page-sub">
          The {COUNTS.official} township{COUNTS.official === 1 ? "" : "s"} with a published
          2026 filing deadline, straight from the Cook County Assessor&apos;s calendar. The rest
          are marked pending until the Assessor posts them — we don&apos;t guess. Always confirm
          your exact deadline with the county before filing.
        </p>
        <div className="ot-status-summary">
          <div className="ot-status-summary-item">
            <span className="ot-status-summary-num" style={{ color: "var(--success)" }}>{COUNTS.open}</span>
            <span className="ot-status-summary-label">open now</span>
          </div>
          <div className="ot-status-summary-divider" />
          <div className="ot-status-summary-item">
            <span className="ot-status-summary-num" style={{ color: "var(--ink-soft)" }}>{COUNTS.pending}</span>
            <span className="ot-status-summary-label">pending official date</span>
          </div>
          <div className="ot-status-summary-divider" />
          <div className="ot-status-summary-item">
            <span className="ot-status-summary-num" style={{ color: "var(--ink-soft)" }}>{COUNTS.closed}</span>
            <span className="ot-status-summary-label">closed</span>
          </div>
        </div>
        <div className="ot-page-hero-meta">
          Source: Cook County Assessor 2026 calendar, last updated {TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED}. Confirm with the county before filing.
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
          We&apos;ll email you when <strong>{t?.name} Township</strong>&apos;s official 2026
          appeal deadline is posted by the Assessor, and again before it closes. Nothing else.
        </p>
      </div>
    );
  }

  return (
    <div className="ot-reminder-block">
      <div className="ot-reminder-block-eyebrow">Get a reminder</div>
      <h2 className="ot-reminder-block-title">
        Get a reminder when your township&apos;s official deadline is posted.
      </h2>
      <p className="ot-reminder-block-body">
        We&apos;ll email you when the Assessor publishes your township&apos;s 2026 deadline and
        again before it closes. Nothing else.
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

const SORTERS: Record<string, (a: Township2026View, b: Township2026View) => number> = {
  soonest: (a, b) => {
    // Official open windows first (soonest deadline), then closed, then pending.
    const score = (t: Township2026View) => {
      if (t.status === "open") return t.daysUntilLastFile ?? 0;
      if (t.status === "closed") return 100000 + (t.daysUntilLastFile ?? 0);
      return 1000000; // pending — no date, sort last
    };
    return score(a) - score(b) || a.name.localeCompare(b.name);
  },
  alpha: (a, b) => a.name.localeCompare(b.name),
};

function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+township$/i, "");
}

const VIEWS_BY_NAME = new Map(VIEWS.map((v) => [normalizeName(v.name), v]));

function viewForMapTownship(township: Township) {
  return VIEWS_BY_NAME.get(normalizeName(township.name));
}

function mapFill(status: Deadline2026Status) {
  if (status === "open") return "rgba(34, 197, 94, 0.52)";
  if (status === "closed") return "rgba(30, 41, 59, 0.30)";
  return "rgba(245, 158, 11, 0.34)";
}

function mapStroke(status: Deadline2026Status) {
  if (status === "open") return "rgba(34, 197, 94, 0.95)";
  if (status === "closed") return "rgba(226, 232, 240, 0.75)";
  return "rgba(245, 158, 11, 0.9)";
}

// Esri World Imagery export and transparent SVG overlay share this exact
// lon/lat bbox and viewBox. Township pins are projected from real approximate
// centroids, not from the old arbitrary rectangular schematic grid.
const MAP_BBOX = { west: -88.3, east: -87.5, south: 41.45, north: 42.15 } as const;
const MAP_WIDTH = 900;
const MAP_HEIGHT = 720;
const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export" +
  "?bbox=-88.3,41.45,-87.5,42.15&bboxSR=4326&imageSR=4326&size=900,720&format=png&f=image";

type TownshipCentroid = { lat: number; lon: number };

const TOWNSHIP_CENTROIDS: Record<string, TownshipCentroid> = {
  barrington: { lat: 42.14, lon: -88.16 },
  hanover: { lat: 42.01, lon: -88.15 },
  palatine: { lat: 42.115, lon: -88.045 },
  wheeling: { lat: 42.135, lon: -87.925 },
  schaumburg: { lat: 42.03, lon: -88.09 },
  "elk-grove": { lat: 42.005, lon: -87.985 },
  maine: { lat: 42.045, lon: -87.87 },
  northfield: { lat: 42.1, lon: -87.79 },
  "new-trier": { lat: 42.11, lon: -87.74 },
  niles: { lat: 42.028, lon: -87.8 },
  evanston: { lat: 42.045, lon: -87.7 },
  leyden: { lat: 41.945, lon: -87.88 },
  "norwood-park": { lat: 42.002, lon: -87.808 },
  "rogers-park": { lat: 42.008, lon: -87.672 },
  jefferson: { lat: 41.945, lon: -87.755 },
  "north-chicago": { lat: 41.918, lon: -87.662 },
  "lake-view": { lat: 41.945, lon: -87.655 },
  "west-chicago": { lat: 41.888, lon: -87.712 },
  lake: { lat: 41.8, lon: -87.628 },
  "hyde-park": { lat: 41.795, lon: -87.588 },
  "south-chicago": { lat: 41.735, lon: -87.585 },
  "river-forest": { lat: 41.895, lon: -87.815 },
  "oak-park": { lat: 41.885, lon: -87.79 },
  proviso: { lat: 41.87, lon: -87.882 },
  cicero: { lat: 41.842, lon: -87.755 },
  berwyn: { lat: 41.83, lon: -87.792 },
  stickney: { lat: 41.815, lon: -87.775 },
  riverside: { lat: 41.83, lon: -87.82 },
  lyons: { lat: 41.8, lon: -87.855 },
  lemont: { lat: 41.665, lon: -87.99 },
  palos: { lat: 41.665, lon: -87.83 },
  worth: { lat: 41.7, lon: -87.785 },
  calumet: { lat: 41.662, lon: -87.61 },
  orland: { lat: 41.61, lon: -87.855 },
  bremen: { lat: 41.585, lon: -87.755 },
  thornton: { lat: 41.585, lon: -87.615 },
  rich: { lat: 41.505, lon: -87.71 },
  bloom: { lat: 41.49, lon: -87.59 },
};

function projectTownship({ lat, lon }: TownshipCentroid) {
  return {
    x: ((lon - MAP_BBOX.west) / (MAP_BBOX.east - MAP_BBOX.west)) * MAP_WIDTH,
    y: ((MAP_BBOX.north - lat) / (MAP_BBOX.north - MAP_BBOX.south)) * MAP_HEIGHT,
  };
}

function DeadlineSatelliteMap() {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const activeTownship = activeSlug
    ? TOWNSHIPS.find((t) => t.slug === activeSlug) ?? null
    : null;
  const activeView = activeTownship ? viewForMapTownship(activeTownship) : null;

  const activeTitle = activeView?.name ?? activeTownship?.name ?? "Township";
  const activeDeadline = activeView
    ? activeView.official
      ? `Last file: ${activeView.lastFileLabel}`
      : PENDING_LABEL
    : PENDING_LABEL;

  const plottedTownships = TOWNSHIPS.filter((township) => Boolean(TOWNSHIP_CENTROIDS[township.slug]));

  return (
    <div className="ot-deadline-map-wrap">
      <div className="ot-deadline-map-base" aria-hidden="true" />
      <img
        src={SATELLITE_URL}
        alt="Satellite view of Cook County"
        className="ot-deadline-map-img"
        loading="lazy"
        draggable={false}
      />
      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="ot-deadline-map-svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Cook County township deadline status map"
      >
        <defs>
          <clipPath id="ot-deadline-map-clip">
            <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} rx="12" />
          </clipPath>
          <filter id="ot-deadline-pin-shadow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.4" floodColor="#000" floodOpacity="0.55" />
          </filter>
          <linearGradient id="ot-deadline-map-bottom-scrim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b1220" stopOpacity="0" />
            <stop offset="1" stopColor="#0b1220" stopOpacity="0.48" />
          </linearGradient>
        </defs>
        <g clipPath="url(#ot-deadline-map-clip)">
          <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="#0b1220" opacity="0.18" />
          <rect x="0" y={MAP_HEIGHT - 120} width={MAP_WIDTH} height="120" fill="url(#ot-deadline-map-bottom-scrim)" />
          <text x="16" y="26" className="ot-deadline-map-caption">
            COOK COUNTY, IL
          </text>
          {plottedTownships.map((township) => {
            const view = viewForMapTownship(township);
            const status = view?.status ?? "pending";
            const isActive = activeSlug === township.slug;
            const { x, y } = projectTownship(TOWNSHIP_CENTROIDS[township.slug]);
            const radius = isActive ? 8 : status === "closed" ? 4.5 : 6;
            const showLabel = status === "open" || isActive;
            const labelWidth = Math.max(54, township.name.length * 6.6 + 16);
            return (
              <g
                key={township.slug}
                onMouseEnter={() => setActiveSlug(township.slug)}
                onFocus={() => setActiveSlug(township.slug)}
                onMouseLeave={() => setActiveSlug(null)}
                tabIndex={0}
                role="button"
                aria-label={`${view?.name ?? township.name}: ${view?.official ? view.lastFileLabel : PENDING_LABEL}`}
                className="ot-deadline-map-pin"
              >
                {isActive && (
                  <circle cx={x} cy={y} r={radius + 6} fill={mapStroke(status)} opacity="0.28" />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={mapFill(status)}
                  stroke={mapStroke(status)}
                  strokeWidth={isActive ? 2.4 : 1.6}
                  filter="url(#ot-deadline-pin-shadow)"
                  className="ot-deadline-map-marker"
                />
                {showLabel ? (
                  <g pointerEvents="none" transform={`translate(${x + radius + 5}, ${y})`}>
                    <rect
                      x="0"
                      y="-10"
                      width={labelWidth}
                      height="20"
                      rx="5"
                      fill="#0b1220"
                      opacity={isActive ? 0.9 : 0.68}
                    />
                    <text x="8" y="4" className="ot-deadline-map-label">
                      {township.name}
                    </text>
                  </g>
                ) : (
                  <title>{`${view?.name ?? township.name}: ${view?.official ? view.lastFileLabel : PENDING_LABEL}`}</title>
                )}
              </g>
            );
          })}
          <text x={MAP_WIDTH - 12} y={MAP_HEIGHT - 14} textAnchor="end" className="ot-deadline-map-credit-svg">
            IMAGERY: ESRI, MAXAR
          </text>
        </g>
      </svg>
      <div className="ot-deadline-map-card">
        <div className="ot-floatcard-cycle">Cook County 2026</div>
        <div className="ot-floatcard-name">{activeTownship ? activeTitle : "Hover a township"}</div>
        <div className="ot-deadline-map-card-status">
          {activeView ? <StatusPill status={activeView.status} /> : <StatusPill status="pending" />}
        </div>
        <div className="ot-deadline-map-card-deadline">{activeTownship ? activeDeadline : "Official Assessor dates only"}</div>
        <div className="ot-deadline-map-card-note">
          Satellite imagery with township pins projected from approximate lat/lon centroids. Pending means the Assessor has not posted a 2026 last-file date yet.
        </div>
      </div>
      <div className="ot-deadline-map-legend" aria-label="Map legend">
        <span><i className="ot-map-key-open" /> Open</span>
        <span><i className="ot-map-key-pending" /> Pending</span>
        <span><i className="ot-map-key-closed" /> Closed</span>
      </div>
      <div className="ot-deadline-map-credit">Imagery: Esri, Maxar</div>
    </div>
  );
}

function TownshipsTable() {
  const [filter, setFilter] = useState<"all" | Deadline2026Status>("all");
  const [sort, setSort] = useState<"soonest" | "alpha">("soonest");

  const rows = useMemo(() => {
    const filtered = filter === "all" ? VIEWS : VIEWS.filter((t) => t.status === filter);
    return [...filtered].sort(SORTERS[sort]);
  }, [filter, sort]);

  const filterButtons: Array<{ id: "all" | Deadline2026Status; label: string; count: number }> = [
    { id: "all", label: "All", count: VIEWS.length },
    { id: "open", label: "Open now", count: COUNTS.open },
    { id: "pending", label: "Pending date", count: COUNTS.pending },
    { id: "closed", label: "Closed", count: COUNTS.closed },
  ];

  const formatDeadline = (t: Township2026View) =>
    t.official ? `Last file: ${t.lastFileLabel}` : PENDING_LABEL;

  const formatDays = (t: Township2026View) => {
    if (t.status === "open") {
      const d = t.daysUntilLastFile ?? 0;
      return d === 0 ? "closes today" : `${d} day${d === 1 ? "" : "s"} left`;
    }
    if (t.status === "closed") return "deadline passed";
    return "—";
  };

  return (
    <section className="ot-tbl-section">
      <div className="ot-tbl-inner">
        <div className="ot-tbl-head">
          <h2 className="ot-h2">Official 2026 township deadlines.</h2>
          <p className="ot-tbl-note" style={{ fontSize: 14, color: "var(--ink-soft, #6b6258)", margin: "4px 0 0", maxWidth: "62ch" }}>
            Dates shown are the Cook County Assessor&apos;s official 2026 Last File Date.
            Townships marked &ldquo;{PENDING_LABEL}&rdquo; have not been posted yet — we don&apos;t
            estimate them. Confirm any date on the{" "}
            <a href={ASSESSOR_CALENDAR_URL} target="_blank" rel="noopener noreferrer">
              official Cook County Assessor calendar
            </a>{" "}
            before filing.
          </p>
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
                <th scope="col">Official 2026 deadline</th>
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
                  <td className="ot-tbl-window" style={!t.official ? { color: "var(--ink-soft, #6b6258)" } : undefined}>
                    {formatDeadline(t)}
                  </td>
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
            Check eligibility <span className="ot-cta-arrow">→</span>
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
 * Static township grid grouped by official 2026 status. Pending townships show
 * "Pending official date" — never an inferred window.
 */
function TownshipGrid() {
  const order: Deadline2026Status[] = ["open", "closed", "pending"];
  const heads: Record<Deadline2026Status, string> = {
    open: "Open now",
    closed: "Closed",
    pending: "Pending official date",
  };
  const groups: Record<Deadline2026Status, Township2026View[]> = {
    open: VIEWS.filter((t) => t.status === "open"),
    closed: VIEWS.filter((t) => t.status === "closed"),
    pending: VIEWS.filter((t) => t.status === "pending"),
  };
  return (
    <section className="ot-fullmap">
      <div className="ot-fullmap-inner">
        <div className="ot-fullmap-head">
          <div>
            <h2 className="ot-h2">Township deadlines at a glance.</h2>
            <p className="ot-fullmap-sub">
              Grouped by the Assessor&apos;s official 2026 status. &ldquo;{PENDING_LABEL}&rdquo;
              means the county hasn&apos;t posted that township yet — confirm yours before filing.
            </p>
          </div>
        </div>
        <div className="ot-fullmap-stage" style={{ minHeight: 0 }}>
          <DeadlineSatelliteMap />
          <div className="ot-fullmap-grid ot-fullmap-grid-after-map">
            {order.map((status) => (
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
                          {t.official ? `Last file ${t.lastFileLabel}` : PENDING_LABEL}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="ot-fullmap-foot">
          Three triennial reassessment districts: 2026 South &amp; West Suburbs,
          2027 North Suburbs, 2028 City of Chicago.
        </div>
      </div>
    </section>
  );
}

function VerifyAndSources() {
  return (
    <section className="ot-tbl-section" aria-labelledby="ot-verify-heading">
      <div
        className="ot-tbl-inner"
        style={{
          border: "1px solid var(--line, #e5e0d8)",
          borderRadius: 12,
          padding: "20px 22px",
          background: "var(--surface-soft, #faf8f4)",
        }}
      >
        <h2 id="ot-verify-heading" className="ot-h2" style={{ marginTop: 0 }}>
          Verify your deadline before you file.
        </h2>
        <p style={{ maxWidth: "60ch" }}>{DEADLINE_VERIFY_NOTICE}</p>
        <ul className="ot-deadline-source-list">
          {OFFICIAL_DEADLINE_SOURCES.map((s) => (
            <li key={s.href} className="ot-deadline-source-item">
              <a className="ot-deadline-source-link" href={s.href} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
              <span className="ot-deadline-source-note">
                {s.note}
              </span>
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 16, fontSize: 14, color: "var(--ink-soft, #6b6258)" }}>
          Not sure which window applies to you? Request a review and we&apos;ll help you
          confirm it — email{" "}
          <a href={`mailto:${OT_PUBLIC_CONTACT.email}`}>{OT_PUBLIC_CONTACT.email}</a> or call{" "}
          <a href={OT_PUBLIC_CONTACT.phoneHref}>{OT_PUBLIC_CONTACT.phoneDisplay}</a>. We never
          file anything without your go-ahead.
        </p>
      </div>
    </section>
  );
}

export default function DeadlinesPage() {
  return (
    <>
      <DeadlinesHero />
      <VerifyAndSources />
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
