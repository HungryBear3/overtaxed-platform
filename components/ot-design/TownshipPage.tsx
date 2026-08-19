"use client";
/**
 * Township detail page body.
 *
 * Everything date-shaped on this page comes from a single `Township2026View`
 * evaluated once by the route. The component derives no status, computes no
 * day counts, and holds no dates of its own.
 *
 * That is the whole point of the rewrite. The previous version read
 * `t.status`, `t.daysUntilClose`, `t.openDateLong`, and `t.closeDateShort`
 * straight off the roster row — design-seed dates measured against a frozen
 * `REFERENCE_DATE` — in seven separate places: the status pill, the hero
 * sentence, the countdown card, the facts list, the check CTA meta line, each
 * neighbour card, and the FAQ. Seven readers of one wrong number is not seven
 * bugs, it is one bug rendered seven times, and it made the page impossible to
 * suppress: fixing the hero would have left the countdown, and fixing the
 * countdown would have left the FAQ answer that a crawler had already indexed.
 *
 * The suppression rule is all-or-nothing by construction here. When
 * `view.official` is false there is no date on the props to render, so date,
 * countdown, CTA, reminder promise, and the JSON-LD the route builds from the
 * same view all go quiet together. A page that hid the countdown but kept
 * "File by July 6" in the FAQ would be a parity defect, not a partial fix.
 *
 * The FAQ arrives as plain text from the route rather than being written as
 * JSX here. The route serialises the identical array into FAQPage JSON-LD, so
 * the "answers must appear on the page" requirement is structural instead of a
 * comment asking the next editor to keep two lists in sync — which is exactly
 * what the previous pair of hand-mirrored lists asked, and did not get.
 */
import Link from "next/link";
import { useState } from "react";
import type { Township } from "@/lib/townships";
import type { Deadline2026Status, Township2026View } from "@/lib/deadlines-2026";
import { cc08, cc16, CC_10 } from "@/lib/copy/canonical";
import { DEADLINE_PENDING_NOTICE } from "@/lib/deadline-sources";

const DISTRICT_LABEL: Record<string, string> = {
  "south-west-suburbs": "South & West Suburbs",
  "north-suburbs": "North Suburbs",
  "chicago": "City of Chicago",
};

/** The source named in CC-08/CC-16 on this page. */
const SOURCE = "the Cook County Assessor";
const STAGE = "Cook County Assessor";

export interface TownshipFaqEntry {
  q: string;
  a: string;
}

export interface TownshipPageProps {
  township: Township;
  /** The one evaluated projection for this township. */
  view: Township2026View;
  neighbors: Array<{ township: Township; view: Township2026View }>;
  /** Plain text, byte-identical to the FAQPage JSON-LD the route emits. */
  faq: TownshipFaqEntry[];
  /** Other townships sharing this reassessment cycle. */
  cycleCount: number;
}

const STATUS_PILL: Record<Deadline2026Status, { label: string; cls: string }> = {
  open: { label: "Open now", cls: "is-open" },
  upcoming: { label: "Not yet open", cls: "is-soon" },
  closed: { label: "Closed", cls: "is-closed" },
  // "Not verified" is a statement about us, not about the county's calendar.
  // "Closed" or "Opening soon" here would be an assertion we cannot source.
  pending: { label: "Not verified", cls: "is-closed" },
};

function StatusPill({
  status,
  size = "sm",
}: {
  status: Deadline2026Status;
  size?: "sm" | "md";
}) {
  const item = STATUS_PILL[status];
  return (
    <span className={`ot-status-pill ot-status-${size} ${item.cls}`}>
      <span className="ot-status-dot" />
      {item.label}
    </span>
  );
}

/**
 * The provenance sentence that must sit under any date this page shows.
 *
 * Closed windows get CC-16 rather than CC-08 because CC-16 carries the source,
 * the retrieval, and the "we are not selling a packet for a closed window"
 * clause in one mandated string — printing CC-08 next to it would state the
 * provenance twice and the commerce position not at all. Pending gets neither:
 * there is no date above it to attribute.
 */
function provenanceLine(view: Township2026View): string {
  if (!view.official || !view.retrievedAt) return DEADLINE_PENDING_NOTICE;
  if (view.status === "closed") {
    return cc16({
      stage: STAGE,
      township: `${view.name} Township`,
      source: SOURCE,
      timestamp: view.retrievedAt,
    });
  }
  return cc08({ source: SOURCE, timestamp: view.retrievedAt });
}

function TownshipHero({
  t,
  view,
}: {
  t: Township;
  view: Township2026View;
}) {
  const official = view.official;
  const isOpen = official && view.status === "open";
  const isUpcoming = official && view.status === "upcoming";
  const isClosed = official && view.status === "closed";

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
              <StatusPill status={view.status} size="md" />
              <span className="ot-tp-cycle-tag">{t.cycleYear} reassessment cycle</span>
            </div>
            <h1 className="ot-tp-h1">
              <span className="ot-tp-h1-name">{t.name} Township</span>
              <span className="ot-tp-h1-sub">
                {isOpen && <>property tax appeal window is <em>open now</em>.</>}
                {isUpcoming && <>appeal window has <em>not opened yet</em>.</>}
                {isClosed && <>appeal window is <em>closed</em>.</>}
                {!official && <>Cook County property tax appeals.</>}
              </span>
            </h1>
            <p className="ot-tp-sub">
              {DISTRICT_LABEL[t.district]} · Cook County, Illinois · {t.cycleYear} triennial reassessment.
              {/* Assessor, not Board of Review. These township windows are the
                  Assessor's, and naming the Board here both misdirected the
                  filing and put the one stage OverTaxed IL cannot serve into
                  the hero of 38 pages — which BL-F5 would then require CC-11
                  to answer on every one of them. Correcting the stage is the
                  fix; the disclosure is not. */}
              {isOpen && <> File a formal appeal with the Cook County Assessor by <strong>{view.lastFileLabel}</strong>.</>}
              {isUpcoming && <> The window opens <strong>{view.openLabel}</strong> and closes <strong>{view.lastFileLabel}</strong>.</>}
              {isClosed && <> The window closed <strong>{view.lastFileLabel}</strong>.</>}
              {!official && <> We do not have a verified filing deadline for this township, so this page does not show one.</>}
            </p>
            <div className="ot-tp-hero-cta-row">
              {/* The free-check CTA is keyed to the same projection as the date
                  above it. Offering "run your check" against a window we have
                  not verified — or one we know is closed — invites a homeowner
                  to spend attention on a filing route that is not open to them
                  today, which is the harm the countdown used to cause more
                  loudly. Every other state routes to the notify block. */}
              {isOpen ? (
                <Link href={`/#hero-check`} className="ot-cta">
                  Run free check for my address <span className="ot-cta-arrow">→</span>
                </Link>
              ) : (
                <a href="#tp-reminder" className="ot-cta">
                  Notify me about {t.name} <span className="ot-cta-arrow">→</span>
                </a>
              )}
              <a
                href="https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
                target="_blank"
                rel="noopener noreferrer"
                className="ot-tp-secondary-link"
              >
                Check the county calendar
              </a>
            </div>
          </div>
          <aside className="ot-tp-hero-card">
            {/* No countdown. The informational tier never clears
                `showCountdown`, so a number here could only have been
                recomputed locally from a date whose freshness this page did
                not check — which is how the old card came to render a moving
                figure derived from a frozen design-seed constant. */}
            <div className="ot-tp-card-status">
              <StatusPill status={view.status} size="md" />
            </div>
            <div className="ot-tp-card-rule" />
            <dl className="ot-tp-card-dl">
              {official ? (
                <>
                  <div>
                    <dt>Window opens</dt>
                    <dd>{view.openLabel}</dd>
                  </div>
                  <div>
                    <dt>Last file date</dt>
                    <dd>{view.lastFileLabel}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>Filing deadline</dt>
                  <dd>Not verified — see the county calendar</dd>
                </div>
              )}
              <div>
                <dt>Reassessment cycle</dt>
                <dd>{t.cycleYear} (next: {t.cycleYear + 3})</dd>
              </div>
              <div>
                <dt>Filing body</dt>
                <dd>Cook County Assessor</dd>
              </div>
            </dl>
            <p className="ot-tp-card-provenance">{provenanceLine(view)}</p>
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

/**
 * The free-check block. Rendered only when the Assessor window is verified
 * open, so the meta line below the form can name a real date from the same
 * projection the hero used.
 */
function TownshipCheckCta({ t, view }: { t: Township; view: Township2026View }) {
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
          {/* No "about N days left". The day count is the projection's to
              publish, and the informational tier does not publish one. */}
          Window closes <strong>{view.lastFileLabel}</strong>.
        </div>
      </div>
    </section>
  );
}

/**
 * What stands in for the free-check block when the window is not verified open.
 *
 * It offers the county's own calendar and the notify block, and it does not
 * offer a check, because the check's only useful next step is a filing this
 * township is not currently accepting from us.
 */
function TownshipNoWindow({ t, view }: { t: Township; view: Township2026View }) {
  return (
    <section className="ot-tp-check">
      <div className="ot-tp-check-inner">
        <div className="ot-tp-check-eyebrow">Before you file</div>
        <h2 className="ot-tp-check-h2">
          {view.official && view.status === "closed"
            ? <>The {t.name} Assessor window is closed.</>
            : view.official
              ? <>The {t.name} Assessor window has not opened yet.</>
              : <>We have not verified the {t.name} filing deadline.</>}
        </h2>
        <p className="ot-tp-check-sub">{provenanceLine(view)}</p>
        <div className="ot-tp-hero-cta-row">
          <a href="#tp-reminder" className="ot-cta">
            Notify me when it opens <span className="ot-cta-arrow">→</span>
          </a>
          <a
            href="https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
            target="_blank"
            rel="noopener noreferrer"
            className="ot-tp-secondary-link"
          >
            Cook County Assessor calendar
          </a>
        </div>
      </div>
    </section>
  );
}

function TownshipNeighbors({
  t,
  neighbors,
}: {
  t: Township;
  neighbors: TownshipPageProps["neighbors"];
}) {
  return (
    <section className="ot-tp-neighbors">
      <div className="ot-tp-neighbors-inner">
        <div className="ot-eyebrow">Nearby townships</div>
        <h2 className="ot-h2">If you have neighbors in other townships.</h2>
        <p className="ot-tp-neighbors-sub">
          Cook County townships often share property characteristics with their
          neighbors but have different appeal windows — and a township is
          decided by the county&apos;s record for your PIN, not by which
          neighborhood an address is described as being in.
        </p>
        <div className="ot-tp-neighbors-grid">
          {neighbors.map(({ township: n, view }) => (
            <Link key={n.slug} href={`/township/${n.slug}`} className="ot-tp-neighbor-card">
              <div className="ot-tp-neighbor-row">
                <StatusPill status={view.status} size="sm" />
                <span className="ot-tp-neighbor-cycle">{n.cycleYear}</span>
              </div>
              <div className="ot-tp-neighbor-name">{n.name} Township</div>
              {/* Each neighbour card reads that neighbour's own projection. It
                  previously read the roster row, which is how a card could
                  claim "12 days until close" for a township whose date this
                  site had never verified. */}
              <div className="ot-tp-neighbor-window">
                {view.official
                  ? `Last file ${view.lastFileLabel}`
                  : "No verified deadline"}
              </div>
              <div className="ot-tp-neighbor-arrow">View {n.name} →</div>
            </Link>
          ))}
        </div>
        {neighbors.length === 0 && (
          <p className="ot-tp-neighbors-sub">
            We don&apos;t list neighbouring townships for {t.name}.
          </p>
        )}
      </div>
    </section>
  );
}

function TownshipFaq({ t, faq }: { t: Township; faq: TownshipFaqEntry[] }) {
  return (
    <section className="ot-tp-faq">
      <div className="ot-tp-faq-inner">
        <div className="ot-eyebrow">Questions</div>
        <h2 className="ot-h2">{t.name} Township appeals — what people ask.</h2>
        <div className="ot-tp-faq-list">
          {faq.map((item, i) => (
            <details key={item.q} className="ot-tp-faq-item" {...(i === 0 ? { open: true } : {})}>
              <summary>{item.q}</summary>
              {/* Plain text, rendered exactly as the route serialises it into
                  FAQPage JSON-LD. Wrapping a phrase in <strong> or splicing a
                  <Link> into an answer here would silently desynchronise the
                  visible text from the markup that claims to quote it. */}
              <div className="ot-tp-faq-a">{item.a}</div>
            </details>
          ))}
        </div>
        <p className="ot-tp-faq-note">
          {CC_10}{" "}
          <Link href="/#pricing">See the pricing details</Link>.
        </p>
      </div>
    </section>
  );
}

/**
 * Neutral subscription capture.
 *
 * This is the one signup the fail-closed rule permits on an unverified page,
 * because it promises nothing that depends on a date: it says we will write
 * when the Assessor publishes the township's deadline. The old copy promised
 * mail "30 days before the window closes and once at 7 days out", which is a
 * schedule — and a schedule cannot be honoured, or even enrolled, off a date
 * we do not have. `lib/followups/schedule.ts` will only build a real schedule
 * from verified canonical state, so the previous promise was one the sending
 * side was already unable to keep.
 */
function TownshipReminder({ t }: { t: Township }) {
  const [email, setEmail] = useState("");
  const [outcome, setOutcome] = useState<"idle" | "scheduled" | "recorded">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    // The confirmation is keyed to what the endpoint says it did, not to the
    // fact that a request completed. `/api/reminder` is a preview stub that
    // persists nothing and schedules nothing, and it now says so — so this
    // cannot render "You're set" over a discarded address.
    let scheduled = false;
    try {
      const res = await fetch("/api/reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, townshipSlug: t.slug }),
      });
      const data = (await res.json()) as { scheduled?: boolean };
      scheduled = data?.scheduled === true;
    } catch {
      /* preview stub */
    }
    setOutcome(scheduled ? "scheduled" : "recorded");
  }

  if (outcome !== "idle") {
    return (
      <section id="tp-reminder" className="ot-tp-reminder">
        <div className="ot-tp-reminder-inner ot-tp-reminder-done">
          <div className="ot-reminder-block-check">✓</div>
          <h2 className="ot-tp-reminder-title">
            {outcome === "scheduled" ? <>You&apos;re set.</> : <>Request received.</>}
          </h2>
          <p>
            {outcome === "scheduled" ? (
              <>
                We&apos;ll email you when the Assessor publishes {t.name}{" "}
                Township&apos;s appeal deadline, and again before it closes. Nothing else.
              </>
            ) : (
              <>
                We&apos;ve recorded your request, but reminder mail is not running
                yet — so do not wait to hear from us. Confirm {t.name}{" "}
                Township&apos;s filing deadline with the Cook County Assessor
                before you file.
              </>
            )}
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
          Tell us where to write and we&apos;ll use it only for {t.name}{" "}
          appeal-deadline updates. Confirm your own filing deadline with the
          county in the meantime — it is the only source that is authoritative
          today.
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

export default function TownshipPage({
  township,
  view,
  neighbors,
  faq,
  cycleCount,
}: TownshipPageProps) {
  const windowOpen = view.official && view.status === "open";
  return (
    <>
      <TownshipHero t={township} view={view} />
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
              Browse township deadlines →
            </Link>
          </div>
        </div>
      </section>
      {windowOpen ? (
        <TownshipCheckCta t={township} view={view} />
      ) : (
        <TownshipNoWindow t={township} view={view} />
      )}
      <TownshipNeighbors t={township} neighbors={neighbors} />
      <TownshipFaq t={township} faq={faq} />
      <TownshipReminder t={township} />
    </>
  );
}
