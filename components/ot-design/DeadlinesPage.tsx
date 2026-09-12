"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { OT_PUBLIC_CONTACT } from "@/components/ot-design/SiteChrome";
import {
  OFFICIAL_DEADLINE_SOURCES,
  DEADLINE_PENDING_NOTICE,
  ASSESSOR_CALENDAR_URL,
} from "@/lib/deadline-sources";
import { analytics } from "@/lib/analytics/events";
import { cc08 } from "@/lib/copy/canonical";
import {
  type Deadline2026Status,
  type Township2026View,
} from "@/lib/deadlines-2026";

import { unavailableCalendar, useInformationalCalendar } from "@/lib/deadlines/use-informational-calendar";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";

// Every surface observes one mounted, canonically evaluated informational state.
const CalendarContext = createContext(unavailableCalendar);
const PENDING_LABEL = "Pending official date";
const MAP_BBOX = "-88.45,41.45,-87.2055556,42.15";
const MAP_IMAGE_SIZE = "1600,900";
const SATELLITE_MAP_URL =
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${MAP_BBOX}&bboxSR=4326&imageSR=4326&size=${MAP_IMAGE_SIZE}&format=png&f=image`;
const TOWNSHIP_BOUNDARY_URL =
  `https://gis.cookcountyil.gov/traditional/rest/services/politicalBoundary/MapServer/export?bbox=${MAP_BBOX}&bboxSR=4326&imageSR=4326&size=${MAP_IMAGE_SIZE}&format=png32&transparent=true&layers=show:3&f=image`;

interface MapDot {
  name: string;
  x: number;
  y: number;
}

// Dot positions are centroids from Cook County GIS Political Township polygons,
// projected into the same WGS84 bbox used by the satellite/boundary exports.
const MAP_DOTS: MapDot[] = [
  { name: "Barrington", x: 21.7, y: 5.6 },
  { name: "Berwyn", x: 53.0, y: 43.8 },
  { name: "Bloom", x: 68.3, y: 90.9 },
  { name: "Bremen", x: 57.5, y: 78.3 },
  { name: "Calumet", x: 64.0, y: 70.2 },
  { name: "Cicero", x: 55.5, y: 43.6 },
  { name: "Elk Grove", x: 38.0, y: 17.1 },
  { name: "Evanston", x: 60.8, y: 14.8 },
  { name: "Hanover", x: 19.8, y: 17.5 },
  { name: "Hyde Park", x: 69.9, y: 61.3 },
  { name: "Jefferson", x: 53.1, y: 26.8 },
  { name: "Lake", x: 61.4, y: 56.3 },
  { name: "Lake View", x: 63.2, y: 27.3 },
  { name: "Lemont", x: 39.0, y: 68.7 },
  { name: "Leyden", x: 46.6, y: 31.2 },
  { name: "Lyons", x: 47.4, y: 53.6 },
  { name: "Maine", x: 47.1, y: 16.7 },
  { name: "New Trier", x: 56.7, y: 7.0 },
  { name: "Niles", x: 55.6, y: 16.8 },
  { name: "North Chicago", x: 65.1, y: 34.6 },
  { name: "Northfield", x: 49.7, y: 6.0 },
  { name: "Norwood Park", x: 51.0, y: 26.7 },
  { name: "Oak Park", x: 53.0, y: 37.5 },
  { name: "Orland", x: 48.0, y: 78.4 },
  { name: "Palatine", x: 31.1, y: 5.7 },
  { name: "Palos", x: 47.9, y: 66.0 },
  { name: "Proviso", x: 46.5, y: 40.7 },
  { name: "Rich", x: 57.6, y: 90.9 },
  { name: "River Forest", x: 50.7, y: 36.4 },
  { name: "Riverside", x: 50.4, y: 44.9 },
  { name: "Rogers Park", x: 61.6, y: 20.2 },
  { name: "Schaumburg", x: 29.1, y: 17.3 },
  { name: "South Chicago", x: 65.0, y: 43.6 },
  { name: "Stickney", x: 54.6, y: 56.5 },
  { name: "Thornton", x: 68.2, y: 78.3 },
  { name: "West Chicago", x: 60.0, y: 38.8 },
  { name: "Wheeling", x: 40.5, y: 5.7 },
  { name: "Worth", x: 56.7, y: 65.7 },
];

/**
 * Narrow the view status to what the analytics event contract accepts.
 *
 * `lib/analytics/events.ts` types this field as `open | closed | pending` and
 * is outside the authorized file set for this change, so `upcoming` is reported
 * as `pending` here. That under-reports one telemetry field — it never affects
 * anything a reader sees — and widening the event union is left as a separate
 * authorized change.
 */
function analyticsStatus(status: Deadline2026Status): "open" | "closed" | "pending" {
  return status === "open" || status === "closed" ? status : "pending";
}

function trackingPayloadForTownship(t: Township2026View, source: "reminder_dropdown" | "township_grid" | "township_table" | "map_dot") {
  return {
    source,
    townshipSlug: t.slug,
    townshipName: t.name,
    status: analyticsStatus(t.status),
  } as const;
}

function trackTownshipSelection(
  t: Township2026View | undefined,
  source: "reminder_dropdown" | "township_grid" | "township_table" | "map_dot",
) {
  if (!t) return;
  analytics.deadlineTownshipSelected(trackingPayloadForTownship(t, source));
}

function StatusPill({
  status,
  size = "sm",
}: {
  status: Deadline2026Status;
  size?: "sm" | "md";
}) {
  const map: Record<Deadline2026Status, { label: string; cls: string; dot?: string }> = {
    open: { label: "Open", cls: "is-open" },
    // Not open. It carries no CTA and no countdown, so it takes the closed
    // treatment rather than the open one.
    upcoming: { label: "Not yet open", cls: "is-closed", dot: "var(--ink-soft, #9a8f80)" },
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
  const { COUNTS, PROVENANCE, NOTHING_VERIFIED } = useContext(CalendarContext);
  return (
    <section className="ot-page-hero">
      <div className="ot-page-hero-inner">
        <div className="ot-page-eyebrow">A free tool from OverTaxed IL</div>
        <h1 className="ot-page-h1">
          Cook County property tax<br />
          <span className="ot-page-h1-tail">appeal deadlines.</span>
        </h1>
        <p className="ot-page-sub">
          {NOTHING_VERIFIED ? (
            <>
              We have not verified any township&apos;s 2026 filing deadline against the Cook
              County Assessor&apos;s published calendar, so this page shows none. Every township
              below is marked pending — we don&apos;t guess. Confirm your exact deadline with the
              county before filing.
            </>
          ) : (
            <>
              The {COUNTS.official} township{COUNTS.official === 1 ? "" : "s"} with a 2026 filing
              deadline we verified against the Cook County Assessor&apos;s calendar. The rest are
              marked pending — we don&apos;t guess. Always confirm your exact deadline with the
              county before filing.
            </>
          )}
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
          {PROVENANCE
            ? cc08({ source: PROVENANCE.source, timestamp: PROVENANCE.retrievedAt })
            : "No township deadline on this page has been verified against the Cook County Assessor's published calendar, so none is shown. Confirm your filing deadline with the county before you file."}
        </div>
      </div>
    </section>
  );
}

function PageCalendarNotice() {
  // Informational township identity cannot authorize a personalized reminder.
  return (
    <div className="ot-reminder-block">
      <h2 className="ot-reminder-block-title">Confirm your deadline with the county.</h2>
      <p className="ot-reminder-block-body">
        This calendar does not determine your property's eligibility or enroll you in reminders.
        Check the <a href={ASSESSOR_CALENDAR_URL} target="_blank" rel="noopener noreferrer">official Cook County Assessor calendar</a> before filing.
      </p>
    </div>
  );
}

const SORTERS: Record<string, (a: Township2026View, b: Township2026View) => number> = {
  soonest: (a, b) => {
    // Open windows first (soonest deadline), then published-but-not-yet-open,
    // then closed, then pending.
    const score = (t: Township2026View) => {
      if (t.status === "open") return t.daysUntilLastFile ?? 0;
      if (t.status === "upcoming") return 50000;
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

function viewForMapTownship(township: Pick<MapDot, "name">, views: Township2026View[]) {
  return views.find(v => normalizeName(v.name) === normalizeName(township.name));
}

function mapDotClass(status: Deadline2026Status) {
  return `ot-deadline-map-dot ot-deadline-map-dot-${status}`;
}

function DeadlineSatelliteMap() {
  const { VIEWS } = useContext(CalendarContext);
  const [activeName, setActiveName] = useState<string | null>(null);
  const activeTownship = activeName
    ? MAP_DOTS.find((t) => t.name === activeName) ?? null
    : null;
  const activeView = activeTownship ? viewForMapTownship(activeTownship, VIEWS) : null;

  const activeTitle = activeView?.name ?? activeTownship?.name ?? "Township";
  const activeDeadline = activeView
    ? activeView.official
      ? `Last file: ${activeView.lastFileLabel}`
      : PENDING_LABEL
    : PENDING_LABEL;

  return (
    <div className="ot-deadline-map-shell">
      <div className="ot-deadline-map-wrap">
        <div className="ot-deadline-map-base" aria-hidden="true" />
        <img
          src={SATELLITE_MAP_URL}
          alt="Satellite view of Cook County"
          className="ot-deadline-map-img"
        />
        <img
          src={TOWNSHIP_BOUNDARY_URL}
          alt=""
          aria-hidden="true"
          className="ot-deadline-map-boundaries"
        />
        <div
          className="ot-deadline-map-dots"
          role="img"
          aria-label="Cook County township deadline status dots over official township boundaries"
        >
          {MAP_DOTS.map((township) => {
            const view = viewForMapTownship(township, VIEWS);
            const status = view?.status ?? "pending";
            const isActive = activeName === township.name;
            const trackingView = view;
            return (
              <button
                key={township.name}
                type="button"
                onClick={() => trackTownshipSelection(trackingView, "map_dot")}
                onMouseEnter={() => setActiveName(township.name)}
                onFocus={() => setActiveName(township.name)}
                onMouseLeave={() => setActiveName(null)}
                onBlur={() => setActiveName(null)}
                className={`${mapDotClass(status)} ${isActive ? "is-active" : ""}`}
                style={{ left: `${township.x}%`, top: `${township.y}%` }}
                aria-label={`${view?.name ?? township.name}: ${view?.official ? view.lastFileLabel : PENDING_LABEL}`}
              >
                <span className="ot-deadline-map-dot-core" />
              </button>
            );
          })}
          <div className="ot-deadline-map-lake">Lake Michigan</div>
        </div>
        <div className="ot-deadline-map-legend" aria-label="Map legend">
          <span><i className="ot-map-key-open" /> Open</span>
          <span><i className="ot-map-key-pending" /> Pending</span>
          <span><i className="ot-map-key-closed" /> Closed</span>
        </div>
        <div className="ot-deadline-map-credit">Imagery: Esri, Maxar</div>
      </div>
      <div className="ot-deadline-map-card">
        <div className="ot-floatcard-cycle">Cook County 2026</div>
        <div className="ot-floatcard-name">{activeTownship ? activeTitle : "Hover a township"}</div>
        <div className="ot-deadline-map-card-status">
          {activeView ? <StatusPill status={activeView.status} /> : <StatusPill status="pending" />}
        </div>
        <div className="ot-deadline-map-card-deadline">{activeTownship ? activeDeadline : "Official Assessor dates only"}</div>
        <div className="ot-deadline-map-card-note">
          Satellite imagery with Cook County GIS township boundaries. Pending means we do not have a freshly verified official date.
        </div>
      </div>
    </div>
  );
}

function TownshipsTable() {
  const { VIEWS, COUNTS } = useContext(CalendarContext);
  const [filter, setFilter] = useState<"all" | Deadline2026Status>("all");
  const [sort, setSort] = useState<"soonest" | "alpha">("soonest");

  const rows = useMemo(() => {
    const filtered = filter === "all" ? VIEWS : VIEWS.filter((t) => t.status === filter);
    return [...filtered].sort(SORTERS[sort]);
  }, [filter, sort, VIEWS]);

  const filterButtons: Array<{ id: "all" | Deadline2026Status; label: string; count: number }> = [
    { id: "all", label: "All", count: VIEWS.length },
    { id: "open", label: "Open now", count: COUNTS.open },
    { id: "upcoming", label: "Not yet open", count: COUNTS.upcoming },
    { id: "pending", label: "Pending date", count: COUNTS.pending },
    { id: "closed", label: "Closed", count: COUNTS.closed },
  ];

  const formatDeadline = (t: Township2026View) =>
    t.official ? `Last file: ${t.lastFileLabel}` : PENDING_LABEL;

  const formatDays = (t: Township2026View) => {
    if (t.status === "open") {
      const d = t.daysUntilLastFile;
      if (d === undefined) return "—";
      return d === 0 ? "closes today" : `${d} day${d === 1 ? "" : "s"} left`;
    }
    if (t.status === "upcoming") return "not yet open";
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
            {" "}Townships marked &ldquo;{PENDING_LABEL}&rdquo; do not have a freshly verified
            official date here. We do not estimate missing dates or infer whether the county has posted them.{" "}
            Confirm any date on the{" "}
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
                    <Link href={`/township/${t.slug}`} onClick={() => trackTownshipSelection(t, "township_table")}>{t.name}</Link>
                  </td>
                  <td><StatusPill status={t.status} size="sm" /></td>
                  <td className="ot-tbl-window" style={!t.official ? { color: "var(--ink-soft, #6b6258)" } : undefined}>
                    {formatDeadline(t)}
                  </td>
                  <td className="ot-tbl-days">{formatDays(t)}</td>
                  <td className="ot-tbl-cycle">{t.cycleYear}</td>
                  <td className="ot-tbl-arrow">
                    <Link href={`/township/${t.slug}`} aria-label={`See ${t.name} details`} onClick={() => trackTownshipSelection(t, "township_table")}>→</Link>
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
  const [address, setAddress] = useState("");

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
            analytics.deadlineFreeCheckStart({
              source: "deadline_bottom_cta",
              hasAddressInput: address.trim().length > 0,
            });
            window.location.href = "/#hero-check";
          }}
        >
          <input
            type="text"
            placeholder="Enter your Cook County address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
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
  const { VIEWS } = useContext(CalendarContext);
  const order: Deadline2026Status[] = ["open", "upcoming", "closed", "pending"];
  const heads: Record<Deadline2026Status, string> = {
    open: "Open now",
    upcoming: "Not yet open",
    closed: "Closed",
    pending: "Pending official date",
  };
  const groups: Record<Deadline2026Status, Township2026View[]> = {
    open: VIEWS.filter((t) => t.status === "open"),
    upcoming: VIEWS.filter((t) => t.status === "upcoming"),
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
              means{" "}
              we do not have a freshly verified official date here{" "}
              — confirm yours before filing.
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
                      <Link href={`/township/${t.slug}`} className="ot-fullmap-twp" onClick={() => trackTownshipSelection(t, "township_grid")}>
                        <span className="ot-fullmap-twp-name">{t.name}</span>
                        <span className="ot-fullmap-twp-dates">
                          {t.official ? `Last file ${t.lastFileLabelShort}, ${t.lastFileDate?.slice(0, 4)}` : PENDING_LABEL}
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
        <p style={{ maxWidth: "60ch" }}>{DEADLINE_PENDING_NOTICE}</p>
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

export default function DeadlinesPage({ snapshot }: { snapshot?: OfficialDeadlineSnapshot } = {}) {
  const calendar = useInformationalCalendar(snapshot);
  const { COUNTS, PROVENANCE } = calendar;
  const [tracked, setTracked] = useState(false);
  useEffect(() => {
    if (tracked || calendar === unavailableCalendar) return;
    setTracked(true);
    analytics.deadlineMapView({
      officialCount: COUNTS.official,
      openCount: COUNTS.open,
      closedCount: COUNTS.closed,
      pendingCount: COUNTS.pending,
      // The real retrieval backing the oldest date on the page, or empty when
      // nothing verified. Never the day a constant was last edited.
      sourceUpdated: PROVENANCE?.retrievedAt ?? "",
    });
  }, [calendar, tracked, COUNTS, PROVENANCE]);

  return (
    <CalendarContext.Provider value={calendar}>
      <DeadlinesHero />
      <VerifyAndSources />
      <section className="ot-reminder-section">
        <div className="ot-reminder-section-inner">
          <PageCalendarNotice />
        </div>
      </section>
      <TownshipGrid />
      <TownshipsTable />
      <BottomCheckCta />
    </CalendarContext.Provider>
  );
}
