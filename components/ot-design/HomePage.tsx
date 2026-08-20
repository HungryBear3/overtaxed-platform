"use client";
import { useCallback, useEffect, useState } from "react";
import {
  RiskReversalBadge,
  StatusChip,
  StickyAddressBar,
  LiveTicker,
} from "@/components/ot-design/SiteChrome";
import { analytics } from "@/lib/analytics/events";
import { CC_01, CC_10, CC_11, CC_12 } from "@/lib/copy/canonical";

/*
 * The local `SAMPLE_RESULT` is gone.
 *
 * It held Cicero, an open window closing "Jul 31, 2026" with 17 days left, and
 * $1,420/yr — $4,260 over three years — and `normalizeCheckResult` spread it as
 * the *base object* of every result it produced. Any field the real response
 * did not carry was therefore filled in from the sample and rendered with no
 * mark distinguishing it, so a genuine Cook County lookup that came back thin
 * displayed a stranger's township, a fabricated deadline, a countdown, and a
 * dollar figure, and the surface had no way to tell that had happened.
 *
 * Absent data is now null and renders as absent.
 */

type WindowStatus = "open" | "closed" | "upcoming" | "unknown";

/** Mirrors `FreeCheckOutcome` in `lib/free-check-appeal-window.ts`. */
interface ResultOutcome {
  code: "supportive" | "not_supportive" | "insufficient_evidence" | "unsupported_property";
  headline: string;
  allowCheckout: boolean;
  reason: string | null;
  showFigures: boolean;
}

type Result = {
  address: string;
  township: string | null;
  windowStatus: WindowStatus;
  windowCloses: string | null;
  windowOpens: string | null;
  /** Null unless the window verified open. Never defaulted. */
  windowDaysRemaining: number | null;
  yourAssessed: number | null;
  compsAvg: number | null;
  assessmentLevel: number | null;
  overpayPerYear: number | null;
  overpay3Year: number | null;
  comps: number;
  /** The route's single evaluated outcome. Null only for a malformed response. */
  outcome: ResultOutcome | null;
  /** CC-02, from the route. Rendered above every state. */
  disclosure: string | null;
  preview?: boolean;
  submittedInput?: string;
  source?: string;
};

type RawCheckResult = Partial<Result> & {
  equityRatio?: number | null;
  subject?: {
    address?: string | null;
    city?: string | null;
    zipCode?: string | null;
    township?: string | null;
    assessedTotalValue?: number | null;
    marketValue?: number | null;
  };
  avgComparableAssessedValue?: number | null;
  assessmentGap?: number | null;
  potentialOverpaymentPerYear?: number | null;
  potentialOverpayment3Year?: number | null;
  compCount?: number | null;
  appealWindowStatus?: {
    township?: string | null;
    status?: WindowStatus | null;
    openDate?: string | null;
    closeDate?: string | null;
    pendingReason?: string | null;
    allowCheckout?: boolean | null;
  } | null;
  source?: string | null;
  mode?: string | null;
};

/** Null, not a fallback. A number we do not have must not become one we do. */
function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatIsoDateLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Days remaining, derived at render rather than trusted from the payload.
 *
 * Null when there is no verified close date. It used to return 0 in that case,
 * which the countdown rendered as "0 days left" — a deadline claim, and the most
 * alarming one available, produced by the absence of a deadline.
 */
function daysUntilIso(iso?: string | null): number | null {
  if (!iso) return null;
  const close = new Date(`${iso}T23:59:59`);
  if (Number.isNaN(close.getTime())) return null;
  return Math.max(0, Math.ceil((close.getTime() - Date.now()) / 86_400_000));
}

function normalizeCheckResult(
  raw?: RawCheckResult | null,
  preview = true,
  submittedInput = "",
): Result {
  const r = raw ?? {};
  const subject = r.subject;
  const aw = r.appealWindowStatus;
  const township = aw?.township ?? subject?.township ?? r.township ?? null;
  const closeLabel = formatIsoDateLabel(aw?.closeDate);
  const openLabel = formatIsoDateLabel(aw?.openDate);

  // Unrecognized statuses resolve to "unknown". This previously resolved to
  // "open" — the one value that unlocks the deadline CTA — so a status the
  // client did not recognize became the most permissive state it had.
  const status: WindowStatus =
    aw?.status === "open" || aw?.status === "closed" || aw?.status === "upcoming"
      ? aw.status
      : "unknown";

  const verifiedOpen = status === "open" && Boolean(aw?.closeDate);

  return {
    address: subject
      ? [subject.address, subject.city, subject.zipCode].filter(Boolean).join(", ")
      : (r.address ?? "This property"),
    township,
    windowStatus: status,
    windowCloses: closeLabel && township ? `${township} window closes ${closeLabel}` : null,
    windowOpens: openLabel ? `Opens ${openLabel}` : null,
    windowDaysRemaining: verifiedOpen ? daysUntilIso(aw?.closeDate) : null,
    yourAssessed: asFiniteNumber(subject?.assessedTotalValue ?? r.yourAssessed),
    compsAvg: asFiniteNumber(r.avgComparableAssessedValue ?? r.compsAvg),
    assessmentLevel: asFiniteNumber(r.equityRatio ?? r.assessmentLevel),
    overpayPerYear: asFiniteNumber(r.potentialOverpaymentPerYear ?? r.overpayPerYear),
    overpay3Year: asFiniteNumber(r.potentialOverpayment3Year ?? r.overpay3Year),
    comps: asFiniteNumber(r.compCount ?? r.comps) ?? 0,
    outcome: (r.outcome as ResultOutcome | undefined) ?? null,
    disclosure: typeof r.disclosure === "string" ? r.disclosure : null,
    preview,
    submittedInput: submittedInput.trim(),
    source: typeof r.source === "string" ? r.source : undefined,
  };
}

const FREE_CHECK_RESULT_EVENT = "ot:free-check-result";

const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

function formatPinDisplay(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 14);
  let f = "";
  if (digits.length > 0) f += digits.slice(0, 2);
  if (digits.length > 2) f += "-" + digits.slice(2, 4);
  if (digits.length > 4) f += "-" + digits.slice(4, 7);
  if (digits.length > 7) f += "-" + digits.slice(7, 10);
  if (digits.length > 10) f += "-" + digits.slice(10, 14);
  return f;
}

function HeroNarrative() {
  return (
    <div className="ot-hero-narrative">
      <StatusChip />
      <h1 className="ot-h1">
        Is Cook County <em>over-assessing</em> your home?
      </h1>
      <p className="ot-hero-subhead">See where your assessed value lands against comparable nearby homes.</p>
      <p className="ot-hero-valueprop">
        Plain math on Cook County&apos;s own public records — no signup, no
        credit card. If you&apos;re fairly assessed, we&apos;ll tell you.
      </p>
      <ul className="ot-hero-deliverables">
        <li>
          <span className="ot-tick">✓</span>
          <span>
            Estimated <strong>annual + 3-year overpayment</strong> in dollars
          </span>
        </li>
        <li>
          <span className="ot-tick">✓</span>
          <span>
            Your assessed value vs. <strong>3 nearby comps</strong>
          </span>
        </li>
        <li>
          <span className="ot-tick">✓</span>
          <span>
            Your assessment level vs. <strong>similar nearby homes</strong> and Cook County&apos;s 10% residential target
          </span>
        </li>
        <li>
          <span className="ot-tick">✓</span>
          <span>
            Your township&apos;s <strong>appeal window status</strong>
          </span>
        </li>
      </ul>
    </div>
  );
}

/**
 * The window strip under a check result.
 *
 * Every field is nullable now, which is the point: the old signature required a
 * township name, a close date, and a day count, so the only way to render an
 * unverified window was to invent all three. The `unknown` arm previously
 * printed `closeDate` — a value it had just been told did not exist — into the
 * slot where a date belongs, and the right-hand cell fell through to the same
 * string. A row with no verified date now says so and sends the reader to the
 * county, which is the only source that can answer it today.
 */
function TownshipDeadline({
  township,
  daysRemaining,
  closeDate,
  openDate,
  status = "unknown",
  sticky = false,
}: {
  township: string | null;
  daysRemaining: number | null;
  closeDate: string | null;
  openDate?: string | null;
  status?: WindowStatus;
  sticky?: boolean;
}) {
  // A day count is only meaningful beside a verified close date. Without one,
  // urgency is a claim about a schedule we have not read.
  const verified =
    status === "open" && closeDate !== null && daysRemaining !== null;

  let tier: "info" | "urgent" | "soon" | "future" | "unknown" = "unknown";
  if (status === "upcoming") tier = "future";
  else if (status === "unknown" || status === "closed") tier = "unknown";
  else if (verified && daysRemaining! < 7) tier = "urgent";
  else if (verified && daysRemaining! < 30) tier = "soon";
  else if (status === "open") tier = "info";

  const stickyClass = sticky && tier === "urgent" ? "is-sticky" : "";

  return (
    <div
      className={`ot-deadline ot-deadline-${tier} ${stickyClass}`}
      role="status"
    >
      <div className="ot-deadline-l">
        <span className="ot-deadline-dot" />
        <strong>{township ? `${township} Township` : "Township not established"}</strong>
      </div>
      <div className="ot-deadline-c">
        {status === "closed" ? (
          <><strong>Closed</strong><span>Appeal window closed</span></>
        ) : status === "upcoming" ? (
          <><strong>Not open yet</strong><span>{openDate ?? "Opening date not published"}</span></>
        ) : verified ? (
          <>
            <strong>{daysRemaining! <= 0 ? "Closes today" : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`}</strong>
            <span>{daysRemaining! <= 0 ? "appeal window closes" : "until close"}</span>
          </>
        ) : (
          <><strong>No verified date</strong><span>Confirm with the county</span></>
        )}
      </div>
      <div className="ot-deadline-r">
        {verified || status === "upcoming" ? (
          closeDate ?? openDate ?? ""
        ) : (
          <a
            href="https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
            target="_blank"
            rel="noopener noreferrer"
          >
            County calendar →
          </a>
        )}
      </div>
    </div>
  );
}

function HeroCheckCard({
  result,
  error,
  onResult,
  onError,
}: {
  result: Result | null;
  error: string;
  onResult: (r: Result | null) => void;
  onError: (message: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState<"address" | "pin">("address");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPin(formatPinDisplay(e.target.value));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      onError("");
      try {
        const submittedInput = mode === "pin" ? pin : address;
        const res = await fetch("/api/free-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, pin, mode }),
        });
        const data = await res.json().catch(() => null);
        setLoading(false);
        if (res.ok === false) {
          onResult(null);
          onError(data?.error ?? "We couldn't find a Cook County property for that input. Try your 14-digit PIN instead.");
          return;
        }
        const isPreview = Boolean(data?.preview || data?.mode === "preview_noop" || data?.source === "preview-noop");
        const normalized = normalizeCheckResult(data?.result ?? data, isPreview, submittedInput);
        onResult(normalized);
        // Absent data is null and stays null. A qualified event carries a real
        // township and a real dollar figure or it is not sent; nothing here
        // substitutes a placeholder to satisfy the event shape.
        if (
          !normalized.preview &&
          normalized.township !== null &&
          normalized.overpayPerYear !== null &&
          normalized.overpayPerYear > 0
        ) {
          analytics.freeCheckQualified({
            township: normalized.township,
            windowStatus: normalized.windowStatus,
            estimatedAnnualSavings: normalized.overpayPerYear,
            preview: false,
          });
        }
      } catch {
        setLoading(false);
        onResult(null);
        onError("We couldn't complete the lookup. Please try again, or enter your 14-digit PIN.");
      }
    },
    [address, pin, mode, onResult],
  );

  if (result) {
    return (
      <HeroCheckResult
        result={result}
        onReset={() => {
          setPin("");
          onError("");
          onResult(null);
        }}
      />
    );
  }

  return (
    <form className="ot-check-card" onSubmit={handleSubmit}>
      <div className="ot-check-head">
        <div className="ot-check-eyebrow">Free Check · No signup</div>
        <div className="ot-check-title">Start your free check</div>
      </div>

      {mode === "pin" ? (
        <label className="ot-field">
          <span className="ot-field-label">Cook County PIN</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="16-01-216-001-0000"
            value={pin}
            onChange={handlePinChange}
            maxLength={18}
            className="ot-input ot-input-mono"
            aria-describedby="pin-hint"
          />
          <span id="pin-hint" className="ot-field-hint">
            14 digits · dashes added as you type · find yours at{" "}
            <a
              href="https://www.cookcountyassessoril.gov/address-search"
              target="_blank"
              rel="noopener noreferrer"
            >
              cookcountyassessoril.gov
            </a>
          </span>
        </label>
      ) : (
        <label className="ot-field">
          <span className="ot-field-label">Street address</span>
          <input
            type="text"
            placeholder="123 S Sample Ave, La Grange IL"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="ot-input"
          />
          <span className="ot-field-hint">
            We&apos;ll find your PIN automatically
          </span>
        </label>
      )}

      {error && (
        <div className="ot-result-altline" role="alert">
          {error}
        </div>
      )}

      <div className="ot-trust-bar" aria-live="polite">
        <span>Real Cook County public-record lookup</span>
        <span className="ot-trust-sep" aria-hidden="true">
          ·
        </span>
        <span>No signup · no credit card</span>
      </div>

      <button
        type="submit"
        className="ot-cta ot-cta-block ot-cta-tall"
        disabled={loading}
      >
        {loading ? (
          <>
            <span className="ot-spin" /> Pulling your records…
          </>
        ) : (
          <>
            Check my assessment <span className="ot-cta-arrow">→</span>
          </>
        )}
      </button>

      <div className="ot-cta-sub">
        If you&apos;re fairly assessed, we&apos;ll tell you. No upsell.
      </div>

      <RiskReversalBadge variant="inline" />

      <button
        type="button"
        className="ot-pin-link"
        onClick={() => setMode(mode === "pin" ? "address" : "pin")}
      >
        {mode === "pin"
          ? "← Look up by address instead"
          : "I have my PIN instead →"}
      </button>
    </form>
  );
}

function HeroCheckResult({
  result,
  onReset,
}: {
  result: Result;
  onReset: () => void;
}) {
  // Every figure is conditional on actually having it. `showFigures` is the
  // route's call, not this component's — the surface renders the decision, it
  // does not re-make it.
  const showFigures = result.outcome?.showFigures ?? false;
  const hasGap = showFigures && result.yourAssessed !== null && result.compsAvg !== null;
  const gap = hasGap ? result.yourAssessed! - result.compsAvg! : null;
  const gapPct =
    gap !== null && result.compsAvg! > 0 ? ((gap / result.compsAvg!) * 100).toFixed(1) : null;
  const gapDisplay = gap === null ? null : `${gap >= 0 ? "+" : ""}${fmtUSD(gap)}`;

  // The only gate on the offer. It is the route's `allowCheckout`, which already
  // requires a supportive outcome, a window the canonical state verified open
  // for an official property record, and a signed eligibility policy. This used
  // to be `overpayPerYear > 0 && windowStatus === "open"`, both of which the
  // client derived for itself from values it had defaulted.
  const canOffer = result.outcome?.allowCheckout === true;
  const projection = showFigures ? result.overpayPerYear : null;
  return (
    <div className="ot-check-card ot-check-result">
      <div className="ot-result-head">
        <div className="ot-result-eyebrow">
          {result.preview ? "Sample data — not your submitted address" : "Your free check"} · {result.address}
        </div>
        <button type="button" onClick={onReset} className="ot-result-reset">
          Check another →
        </button>
      </div>
      {result.preview && (
        <div className="ot-result-altline" role="note">
          Preview sample — this is not a Cook County lookup{result.submittedInput ? ` for ${result.submittedInput}` : ""}.
          Live public-record results run only on the production domain.
        </div>
      )}
      {/* CC-02 sits above the outcome on every state, not beneath the figures
          where it read as a footnote to a number. */}
      {result.disclosure && (
        <p className="ot-result-altline" role="note">{result.disclosure}</p>
      )}

      <div className={`ot-result-savings${result.preview ? " ot-result-savings--sample" : ""}`}>
        {/* The headline is CC-03…CC-06, byte-exact, chosen by the route. */}
        <div className="ot-result-savings-label">
          {result.outcome?.headline ?? "We could not complete this check."}
        </div>
        {projection !== null && (
          <>
            <div className="ot-result-savings-amount">
              {fmtUSD(projection)}
              <span>/yr</span>
            </div>
            {result.overpay3Year !== null && (
              <div className="ot-result-savings-3yr">
                ≈ {fmtUSD(result.overpay3Year)} over the 3-year cycle
              </div>
            )}
          </>
        )}
      </div>
      {result.preview && <div className="ot-result-sample-strip">SAMPLE DATA</div>}
      {showFigures && (
        <div className={`ot-result-table${result.preview ? " ot-result-table--sample" : ""}`}>
          {result.yourAssessed !== null && (
            <div className="ot-result-row">
              <span className="ot-result-row-key">Your assessed value</span>
              <span className="ot-result-row-val">{fmtUSD(result.yourAssessed)}</span>
            </div>
          )}
          {result.compsAvg !== null && (
            <div className="ot-result-row">
              <span className="ot-result-row-key">Avg of {result.comps} nearby comps</span>
              <span className="ot-result-row-val">{fmtUSD(result.compsAvg)}</span>
            </div>
          )}
          {gapDisplay !== null && (
            <div className="ot-result-row ot-result-row-emph">
              <span className="ot-result-row-key">Assessment gap</span>
              <span className="ot-result-row-val">
                {gapDisplay}
                {gapPct !== null && <> <span className="ot-result-pct">({gapPct}%)</span></>}
              </span>
            </div>
          )}
          {result.assessmentLevel !== null && (
            <div className="ot-result-row">
              <span className="ot-result-row-key">Assessment level</span>
              <span className="ot-result-row-val">{result.assessmentLevel.toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}

      <TownshipDeadline
        township={result.township}
        daysRemaining={result.windowDaysRemaining}
        closeDate={result.windowCloses}
        openDate={result.windowOpens}
        status={result.windowStatus}
      />

      {canOffer ? (
        <>
          {/* One option, because one is offered. The Done-For-You and
              Contingency CTAs are removed rather than disabled: a held product
              presented as a choice is still an offer. BL-F3 requires CC-10
              wherever $69 appears, so it renders directly beneath the price. */}
          <div className="ot-result-tier-actions" aria-label="Filing options">
            <a href="/checkout?plan=diy" className="ot-cta ot-cta-block ot-result-tier-cta">DIY Appeal Packet $69</a>
          </div>
          <div className="ot-result-altline">{CC_10}</div>
        </>
      ) : (
        <div className="ot-result-altline" role="status">
          {/* One closed branch, not two. The old pair split on "is there an
              opportunity" and then on "is the window open", so a reader whose
              check established nothing was still told a filing package was "not
              recommended" — a conclusion about their property drawn from the
              absence of one. This says what is true in every closed case. */}
          We are not offering a filing package from this check.{" "}
          <a href="https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines" target="_blank" rel="noopener noreferrer">
            Confirm your own filing deadline with the county
          </a>{" "}
          — your right to appeal is not affected by anything on this page, and you can file on your
          own with the county at no cost.
        </div>
      )}
      {!result.preview && (
        <FollowupSignup result={result} />
      )}
    </div>
  );
}

function FollowupSignup({ result }: { result: Result }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emailConsent, setEmailConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailConsent || status === "saving") return;
    setStatus("saving");
    setMessage("");
    const response = await fetch("/api/followups/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        phone,
        emailConsent,
        smsConsent,
        township: result.township,
        propertyAddress: result.address,
        potentialSavings: result.overpayPerYear,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok) {
      setStatus("error");
      setMessage(data?.error ?? "We couldn't save your reminder preference. Please try again.");
      return;
    }
    setStatus("saved");
    setMessage("You're enrolled. You can unsubscribe from any email.");
  }

  if (status === "saved") {
    return <div className="ot-result-altline" role="status">{message}</div>;
  }

  return (
    <form onSubmit={submit} className="ot-result-followup" aria-label="Free check follow-up reminders">
      <strong>Want help remembering what comes next?</strong>
      <p>Optional reminders about this free check and the current township filing window.</p>
      <label className="ot-field">
        <span className="ot-field-label">Email</span>
        <input className="ot-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <label className="ot-followup-consent">
        <input type="checkbox" checked={emailConsent} onChange={(e) => setEmailConsent(e.target.checked)} />
        <span>Email me this result and a short follow-up sequence. Consent is optional and not required to use the free check.</span>
      </label>
      <label className="ot-followup-consent">
        <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} />
        <span>Also text me one deadline reminder. Message and data rates may apply. Reply STOP to opt out.</span>
      </label>
      {smsConsent && (
        <label className="ot-field">
          <span className="ot-field-label">Mobile number</span>
          <input className="ot-input" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="(312) 555-0123" />
        </label>
      )}
      {message && <div className="ot-result-altline" role="alert">{message}</div>}
      <button className="ot-cta ot-cta-block" type="submit" disabled={!emailConsent || status === "saving"}>
        {status === "saving" ? "Saving…" : "Send my reminders"}
      </button>
    </form>
  );
}

/* ── Assessment-level histogram (locked default per brief) ──────────────────── */
const HISTOGRAM_BUCKETS = [
  { x: 6.0, h: 4 }, { x: 6.5, h: 7 }, { x: 7.0, h: 12 }, { x: 7.5, h: 18 },
  { x: 8.0, h: 26 }, { x: 8.5, h: 34 }, { x: 9.0, h: 42 }, { x: 9.5, h: 47 },
  { x: 10.0, h: 50 }, { x: 10.5, h: 46 }, { x: 11.0, h: 40 }, { x: 11.5, h: 33 },
  { x: 12.0, h: 26 }, { x: 12.5, h: 21 }, { x: 13.0, h: 15 }, { x: 13.5, h: 10 },
  { x: 14.0, h: 6 },
];

function HeatmapHistogram() {
  const w = 480;
  const h = 240;
  const padL = 36, padR = 18, padT = 18, padB = 38;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const maxH = Math.max(...HISTOGRAM_BUCKETS.map((b) => b.h));
  const barW = innerW / HISTOGRAM_BUCKETS.length - 2;
  const targetX = padL + (innerW * (10.0 - 6.0)) / (14.0 - 6.0);

  return (
    <svg
      className="ot-heatmap-svg"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect
        x={targetX}
        y={padT}
        width={padL + innerW - targetX}
        height={innerH}
        className="ot-hist-overzone"
      />
      {HISTOGRAM_BUCKETS.map((b, i) => {
        const bh = (b.h / maxH) * innerH;
        const x = padL + (innerW / HISTOGRAM_BUCKETS.length) * i + 1;
        const y = padT + innerH - bh;
        const over = b.x >= 10.0;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={bh}
            rx="1"
            className={over ? "ot-hist-bar ot-hist-bar-over" : "ot-hist-bar"}
          />
        );
      })}
      <line
        x1={targetX}
        y1={padT - 2}
        x2={targetX}
        y2={padT + innerH + 6}
        className="ot-hist-target-line"
      />
      <text
        x={targetX}
        y={padT - 6}
        textAnchor="middle"
        className="ot-hist-target-label"
      >
        10% target
      </text>
      <line
        x1={padL}
        y1={padT + innerH}
        x2={padL + innerW}
        y2={padT + innerH}
        className="ot-hist-axis"
      />
      {[6, 8, 10, 12, 14].map((tick) => {
        const x = padL + (innerW * (tick - 6)) / 8;
        return (
          <g key={tick}>
            <line
              x1={x}
              y1={padT + innerH}
              x2={x}
              y2={padT + innerH + 4}
              className="ot-hist-axis"
            />
            <text
              x={x}
              y={padT + innerH + 18}
              textAnchor="middle"
              className="ot-hist-axis-label"
            >
              {tick}%
            </text>
          </g>
        );
      })}
      <text
        x={padL + innerW / 2}
        y={h - 6}
        textAnchor="middle"
        className="ot-hist-axis-title"
      >
        Assessment level across Cook County properties
      </text>
    </svg>
  );
}

function HeatmapHero() {
  return (
    <section className="ot-heatmap" aria-labelledby="ot-heatmap-h">
      <div className="ot-heatmap-inner">
        <div className="ot-heatmap-text">
          <div className="ot-heatmap-eyebrow">Cook County · 2024–2026 cycle</div>
          <h2 id="ot-heatmap-h" className="ot-h2 ot-heatmap-h">
            Cook County residential assessments are tested against a 10% level — and uniformity with comparable homes.
          </h2>
          <p className="ot-heatmap-lede">
            For class 2 residential property, assessed value is generally targeted at 10% of market value. Appeals also depend on uniformity: whether comparable homes are assessed lower than yours.
          </p>
        </div>
        <div className="ot-heatmap-vis ot-heatmap-vis-hist">
          <HeatmapHistogram />
        </div>
      </div>
      <div className="ot-heatmap-caption">
        Illustrative distribution based on public Cook County assessment records. Treat this as methodology context, not a claim about your property or a guaranteed appeal outcome.
      </div>
    </section>
  );
}

/* ── Sample Report mockup ───────────────────────────────────────────────── */
function SampleReportPreview() {
  const yourAV = 42500;
  const compsAV = 35100;
  const comps = [
    { label: "123 Sample Ave", val: 36400 },
    { label: "127 Sample Ave", val: 34800 },
    { label: "131 Sample Ave", val: 34100 },
  ];
  const assessmentLevel = 12.1;
  const targetRatio = 10.0;
  const max = Math.max(yourAV, compsAV) * 1.1;
  const trackMax = 14;
  const targetPct = (targetRatio / trackMax) * 100;
  const valuePct = (assessmentLevel / trackMax) * 100;

  return (
    <div className="ot-sample" aria-hidden="true">
      <div className="ot-sample-doc">
        <div className="ot-sample-stamp">
          <span className="ot-sample-stamp-line ot-sample-stamp-l1">Sample</span>
          <span className="ot-sample-stamp-line ot-sample-stamp-l2">Cicero Twp</span>
        </div>
        <div className="ot-sample-head">
          <div className="ot-sample-eyebrow">Your free check · sample</div>
          <div className="ot-sample-addr">1234 S Sample Ave, La Grange IL 60526</div>
          <div className="ot-sample-meta">Synthetic sample PIN · Cicero Township</div>
        </div>
        <div className="ot-sample-savings">
          <div className="ot-sample-savings-key">Estimated annual overpayment</div>
          <div className="ot-sample-savings-val">$1,420<span>/yr</span></div>
          <div className="ot-sample-savings-3yr">≈ $4,260 over the 3-year cycle</div>
        </div>
        <div className="ot-sample-bars">
          <div className="ot-sample-bar-row ot-sample-bar-row-you">
            <span className="ot-sample-bar-key">Your assessed value</span>
            <div className="ot-sample-bar-track">
              <div className="ot-sample-bar-fill ot-sample-bar-you" style={{ width: `${(yourAV / max) * 100}%` }} />
            </div>
            <span className="ot-sample-bar-val">$42,500</span>
          </div>
          {comps.map((c, i) => (
            <div className="ot-sample-bar-row" key={c.label}>
              <span className="ot-sample-bar-key">{c.label}</span>
              <div className="ot-sample-bar-track">
                <div className={`ot-sample-bar-fill ot-sample-bar-comp ot-sample-bar-comp-${i + 1}`} style={{ width: `${(c.val / max) * 100}%` }} />
              </div>
              <span className="ot-sample-bar-val">${c.val.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="ot-sample-assessment">
          <div className="ot-sample-assessment-head">
            <span className="ot-sample-assessment-label">Assessment level</span>
            <span className="ot-sample-assessment-badge">{assessmentLevel.toFixed(1)}%</span>
          </div>
          <div className="ot-sample-assessment-track">
            <div className="ot-sample-assessment-zone-ok" style={{ width: `${targetPct}%` }} />
            <div className="ot-sample-assessment-zone-over" style={{ left: `${targetPct}%`, width: `${100 - targetPct}%` }} />
            <div className="ot-sample-assessment-marker" style={{ left: `${valuePct}%` }} />
          </div>
          <div className="ot-sample-assessment-axis">
            <span className="ot-sample-assessment-target-line" style={{ left: `${targetPct}%` }} />
            <span className="ot-sample-assessment-target-label" style={{ left: `${targetPct}%` }}>
              Target 10.0%
            </span>
          </div>
          <div className="ot-sample-assessment-foot">
            <span className="ot-sample-flag">Over-assessed by 2.1 percentage points</span>
          </div>
        </div>
        <div className="ot-sample-foot">
          <span className="ot-sample-foot-dot" /> Cicero Township appeal window open through Jul 31, 2026
        </div>
      </div>
    </div>
  );
}

function SampleReportSection() {
  return (
    <section id="sample-report" className="ot-sample-section" aria-labelledby="ot-sample-h">
      <div className="ot-sample-section-inner">
        <div className="ot-sample-section-text">
          <div className="ot-sample-section-eyebrow">What you&apos;ll get</div>
          <h2 id="ot-sample-h" className="ot-h2">
            A one-page report — the only thing the Board of Review actually reads.
          </h2>
          <p className="ot-sample-section-lede">
            Your assessed value, three nearby comps, your assessment level against
            Cook County&apos;s 10% residential target, and the uniformity gap vs. similar homes. Every
            number is sourced from public CCAO records you can verify yourself.
          </p>
          <ul className="ot-sample-section-list">
            <li><strong>Estimated annual + 3-year overpayment</strong> in dollars</li>
            <li><strong>3 nearby comps</strong>, picked from your neighborhood code</li>
            <li><strong>Assessment level + uniformity gap</strong> vs. Cook County&apos;s 10% residential target and nearby comps</li>
            <li><strong>Township appeal window</strong> with the close date</li>
          </ul>
        </div>
        <div className="ot-sample-section-vis">
          <SampleReportPreview />
        </div>
      </div>
    </section>
  );
}

function SpecificityBar() {
  return (
    <section className="ot-specbar">
      <div className="ot-specbar-inner">
        <div className="ot-spec">
          <div className="ot-spec-key">Data</div>
          <div className="ot-spec-val">
            Cook County Assessor + Board of Review public records, checked regularly
          </div>
        </div>
        <div className="ot-spec-divider" />
        <div className="ot-spec">
          <div className="ot-spec-key">Method</div>
          <div className="ot-spec-val">
            We compare residential assessment level and comp uniformity, not black-box averages
          </div>
        </div>
        <div className="ot-spec-divider" />
        <div className="ot-spec">
          <div className="ot-spec-key">Scope</div>
          <div className="ot-spec-val">
            All 38 Cook County townships · schedule links are public-record backed
          </div>
        </div>
      </div>
    </section>
  );
}

function MethodologyCard() {
  const steps = [
    { num: "01", h: "Pull your record", p: "Your PIN returns your assessed value, market value, square footage, year built, and property class — straight from CCAO records." },
    { num: "02", h: "Find three comparables", p: "We search your neighborhood code for properties of similar size, age, and class — the same logic the Board of Review applies to comparable-sales appeals." },
    { num: "03", h: "Check level and uniformity", p: "For class 2 residential property, Cook County targets an assessed value near 10% of market value. We separately compare your assessment level with similar nearby homes so the appeal argument is about both statutory level and uniformity." },
    { num: "04", h: "Estimate the overpayment", p: "Gap × your township's effective tax rate × the 3-year triennial window. The arithmetic is shown on your result page — copy it into your appeal verbatim." },
  ];
  return (
    <section id="method" className="ot-method">
      <div className="ot-method-inner">
        <div className="ot-method-eyebrow">How we estimate your overpayment</div>
        <h2 className="ot-h2">Plain math on public records — not a black box.</h2>
        <p className="ot-method-lede">
          Cook County publishes every assessment, every comparable, and every
          appeal outcome. We use that data — the same data the Board of Review
          uses — to tell you whether your number is out of line.
        </p>
        <ol className="ot-method-steps">
          {steps.map((s) => (
            <li key={s.num}>
              <div className="ot-method-num">{s.num}</div>
              <div className="ot-method-body">
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="ot-method-foot">
          <div className="ot-method-disclosure">
            We don&apos;t publish countywide savings averages or success-rate
            claims until we have verified, named Cook County outcomes. Our first
            customer wins are being filed in the 2026 cycle — we&apos;ll show
            them here, by name and township, when the Board of Review rules.
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Verified outcomes placeholder — Pass 2.
 *
 * The Pass 1 testimonials were invented (Maria R. / David T. / Anita K.
 * with fabricated savings numbers). Per the launch-blockers brief, all
 * unverified claims and made-up names are removed. The methodology
 * disclaimer below the steps already states "we don't publish countywide
 * savings averages or success-rate claims until we have verified, named
 * Cook County outcomes" — this section now matches that promise.
 */
function Testimonials() {
  return (
    <section className="ot-testimonials ot-ledger">
      <div className="ot-ledger-grain" aria-hidden="true" />
      <div className="ot-testimonials-inner">
        <div className="ot-testimonials-eyebrow">Outcomes</div>
        <div className="ot-testimonials-compact">
          <div>
            <h2 className="ot-h2">Verified Cook County outcomes will publish after 2026 Board decisions.</h2>
            <p className="ot-testimonials-note">
              We don&apos;t publish testimonials or savings averages we haven&apos;t
              verified. Until the first 2026 decisions come back, review the
              actual deliverable instead: a Cook County-ready appeal packet with
              comps, assessment-level analysis, filing instructions, and deadline tracking.
            </p>
          </div>
          <div className="ot-testimonials-actions">
            <a href="/appeal-packet" className="ot-cta ot-cta-sm">
              See what the packet includes <span className="ot-cta-arrow">→</span>
            </a>
            <a href="/#sample-report" className="ot-link-muted">
              View sample report
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * One plan, because one is offered.
 *
 * The Done-For-You and Contingency cards are removed, not disabled. Beyond
 * pricing held products they carried the lexicon's most severe claims:
 * "We prepare and submit the appeal" and "we file for you" (BL-A1), "you just
 * sign the authorization" (BL-A3), "Tracked through BoR decision" (BL-A2 —
 * Board Rule 1 bars us from practising there at any price), and "only if
 * granted" (BL-A5).
 *
 * The surviving card is also corrected: "keep 100% of your savings" is BL-B4,
 * and the packet's comparables are prepared for the Assessor stage, which is
 * the stage OverTaxed IL operates at — labelling them "Formatted for Board of
 * Review" described the one stage we cannot serve.
 */
const PRICING_PLANS = [
  {
    id: "diy", name: "DIY Appeal Packet", price: "$69",
    priceNote: "one-time",
    summary: "Everything you need to file the appeal yourself in your township.",
    tag: null,
    href: "/checkout",
    cta: "Get the DIY Packet",
    features: [
      { label: "Pre-written appeal argument", ok: true, detail: "Tailored to assessment level + comp uniformity" },
      { label: "3 nearby comparables", ok: true, detail: "Prepared for an Assessor-stage appeal" },
      { label: "Step-by-step filing instructions", ok: true, detail: "Specific to your township" },
      { label: "Deadline reminders", ok: true, detail: "For a future eligible window" },
      { label: "You file it yourself", ok: true, detail: "We prepare it; you review, sign, and file" },
    ],
  },
];

function PricingCompare() {
  return (
    <section id="pricing" className="ot-pcompare">
      <div className="ot-pcompare-inner">
        <div className="ot-pcompare-head">
          <div className="ot-eyebrow">One way to file</div>
          {/* "Same outcome" claimed the county decides identically whichever
              tier you buy — an outcome claim about a decision that is not
              ours. With one plan there is nothing left to compare anyway. */}
          <h2 className="ot-h2">The DIY Appeal Packet.</h2>
          <p className="ot-pcompare-sub">{CC_10}</p>
        </div>
        <div className="ot-pcompare-grid">
          {PRICING_PLANS.map((plan) => (
            <div key={plan.id} className={`ot-pcompare-card ot-pcompare-card--${plan.id}`}>
              {plan.tag && <div className="ot-pcompare-tag">{plan.tag}</div>}
              <div className="ot-pcompare-name">{plan.name}</div>
              <div className="ot-pcompare-price">
                <span className="ot-pcompare-price-amount">{plan.price}</span>
                <span className="ot-pcompare-price-note">{plan.priceNote}</span>
              </div>
              <p className="ot-pcompare-summary">{plan.summary}</p>
              <ul className="ot-pcompare-feats">
                {plan.features.map((f, i) => (
                  <li key={i} className={f.ok ? "is-ok" : "is-no"}>
                    <span className="ot-pcompare-feat-mark" aria-hidden="true">{f.ok ? "✓" : "—"}</span>
                    <span className="ot-pcompare-feat-text">
                      <span className="ot-pcompare-feat-label">{f.label}</span>
                      <span className="ot-pcompare-feat-detail">{f.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <a href={plan.href} className={`ot-cta ot-cta-block${plan.id === "diy" ? "" : " ot-cta-ghost"}`}>
                {plan.cta}
                <span className="ot-cta-arrow">→</span>
              </a>
            </div>
          ))}
        </div>
        <div className="ot-pcompare-footer">
          <RiskReversalBadge variant="inline" />
        </div>
      </div>
    </section>
  );
}

const FAQ_ITEMS = [
  {
    id: "deadline",
    // The cycle-year schedule ("2026 triennial covers the South and West
    // Suburbs first ... 2027 and 2028") was a hard-coded window status with no
    // source and no retrieval timestamp, restated on the busiest page on the
    // site and never refreshed. The answer now points at the one surface that
    // carries provenance instead of holding a second, drifting copy.
    q: "When is the deadline to file an appeal?",
    a: "Each Cook County township has its own appeal window, and the county opens them on a rolling schedule. Enter your address and we show your township's status as published by the county, with the source and the time we retrieved it. Confirm your filing deadline with the county before you file.",
    expanded: true,
  },
  {
    id: "after-check",
    q: "What happens after I submit my free check?",
    // "estimated annual and 3-year overpayment" put a dollar figure on a
    // decision the county has not made (BL-B3). The report describes the
    // comparison it actually performed.
    a: "You'll see your full report on the next screen — assessed value against comparable properties, the assessment-level gap, and your township's appeal window status as published by the county. No signup, no credit card. If the evidence appears to support closer review and your window is open, you can order the $69 DIY Appeal Packet. If it does not, we'll tell you that too.",
    expanded: true,
  },
  {
    id: "data",
    q: "Where does your data come from? How fresh is it?",
    a: "Cook County Assessor public records. Every deadline we show carries the source it came from and the time we retrieved it, and we publish no outcome claims.",
    expanded: true,
  },
  {
    id: "win-rate",
    q: "What if my appeal isn't successful?",
    // The refund rule is a Terms of Service term and an owner policy decision
    // (OD-5, unsigned), so it is not restated or reworded here. CC-12 replaces
    // only the outcome framing.
    a: `Cook County doesn't penalize you for filing — you keep the assessed value on file. The $69 packet is a flat fee for preparing your appeal materials and is paid regardless of what the county decides. ${CC_12}`,
    expanded: true,
  },
  // The "DIY Packet vs Done-For-You" entry is removed. It compared the packet
  // against a held product, and opened with "Most homeowners pick..." (BL-B2).
  {
    id: "law-firm",
    q: "Are you a law firm?",
    // "the format the Board of Review accepts" described our packet as built
    // for the one stage we cannot serve. Every Board of Review mention has to
    // co-render CC-11, and this is the answer where that belongs.
    a: `${CC_12} ${CC_01} ${CC_11}`,
    expanded: true,
  },
];

/**
 * HOA / condo association capture. Routes to /api/township-alert with the
 * "HOA Waitlist" sentinel — the same gated endpoint other capture forms
 * use, so it inherits the P0 preview-noop behavior automatically.
 */
function HoaSection() {
  const [email, setEmail] = useState("");
  const [pins, setPins] = useState("");
  const [association, setAssociation] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/township-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          township: "HOA Waitlist",
          address: [association, pins ? `${pins} PINs` : null].filter(Boolean).join(" · "),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  return (
    <section id="hoa" className="ot-faq" aria-labelledby="ot-hoa-h">
      <div className="ot-faq-inner">
        <div className="ot-faq-eyebrow">HOA & condo associations</div>
        <h2 id="ot-hoa-h" className="ot-h2">
          Managing many PINs? We&apos;ll build a bulk packet for your association.
        </h2>
        <p className="ot-method-lede">
          Condo boards and HOA managers in Cook County can use the same comparable-property +
          assessment-level packet, run across every PIN in the association. No
          legal-representation claim, no per-unit upsell. Drop your email and one
          OverTaxed IL contact will reply within 2 business days with the next-step plan.
        </p>

        {status === "success" ? (
          <div className="ot-rrb ot-rrb-inline" style={{ marginTop: 16 }}>
            <span className="ot-rrb-shield" aria-hidden="true">○</span>
            <span className="ot-rrb-text">
              <strong>You&apos;re on the list.</strong> One OverTaxed IL contact will email you within 2 business days with next steps.
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginTop: 16, display: "grid", gap: 12, maxWidth: 540 }}>
            <label className="ot-field">
              <span className="ot-field-label">Association name</span>
              <input
                type="text"
                value={association}
                onChange={(e) => setAssociation(e.target.value)}
                placeholder="e.g. Lakeside Condominium Association"
                className="ot-input"
                maxLength={120}
              />
            </label>
            <label className="ot-field">
              <span className="ot-field-label">Approximate number of PINs</span>
              <input
                type="text"
                value={pins}
                onChange={(e) => setPins(e.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="e.g. 48"
                className="ot-input"
                inputMode="numeric"
              />
            </label>
            <label className="ot-field">
              <span className="ot-field-label">Contact email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="board@example.com"
                className="ot-input"
                autoComplete="email"
              />
            </label>
            <button
              type="submit"
              className="ot-cta ot-cta-block"
              disabled={status === "loading" || !email}
            >
              {status === "loading" ? "Saving…" : "Get an association packet plan"}
            </button>
            <p className="ot-method-disclosure">
              OverTaxed IL is not a law firm and does not provide legal advice.
              We do not guarantee a reduction — county decisions are final.
            </p>
            {status === "error" && (
              <p style={{ color: "#b91c1c", fontSize: 13 }}>{errorMsg}</p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}

function FaqSection() {
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => Object.fromEntries(FAQ_ITEMS.map((it) => [it.id, !!it.expanded])),
  );
  return (
    <section id="faq" className="ot-faq">
      <div className="ot-faq-inner">
        <div className="ot-faq-eyebrow">Common questions</div>
        <h2 className="ot-h2">Frequently asked questions.</h2>
        <ul className="ot-faq-list">
          {FAQ_ITEMS.map((it) => (
            <li key={it.id} className={`ot-faq-item${open[it.id] ? " is-open" : ""}`}>
              <button
                type="button"
                className="ot-faq-q"
                aria-expanded={!!open[it.id]}
                onClick={() => setOpen((m) => ({ ...m, [it.id]: !m[it.id] }))}
              >
                <span>{it.q}</span>
                <span className="ot-faq-q-icon" aria-hidden="true">
                  {open[it.id] ? "−" : "+"}
                </span>
              </button>
              {open[it.id] && <div className="ot-faq-a"><p>{it.a}</p></div>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Compact above-the-fold preview of the assessment-check report a user
 * receives after running the free check. The product output is visible
 * without scrolling, and the "Sample" badge is always rendered — there is
 * no live data path into this card.
 */
function HeroPreviewCard() {
  const Row = ({
    label,
    value,
    emph,
  }: {
    label: string;
    value: string;
    emph?: boolean;
  }) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        padding: "6px 0",
        borderTop: "1px dashed var(--border)",
      }}
    >
      <span style={{ color: "var(--muted-foreground)" }}>{label}</span>
      <span
        style={{
          fontWeight: emph ? 700 : 500,
          color: emph ? "oklch(0.42 0.12 150)" : "var(--foreground)",
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <aside
      className="ot-hero-preview"
      aria-label="Sample of the assessment-check report you receive"
      style={{
        marginTop: 22,
        padding: 18,
        background: "var(--background)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        boxShadow: "0 12px 30px -18px rgba(0,0,0,0.16)",
        maxWidth: 380,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--muted-foreground)",
          }}
        >
          What your check returns
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.8,
            background:
              "color-mix(in oklab, var(--primary) 14%, var(--background))",
            color: "oklch(0.42 0.12 150)",
            border:
              "1px solid color-mix(in oklab, var(--primary) 30%, var(--border))",
            padding: "2px 8px",
            borderRadius: 999,
          }}
        >
          Sample
        </span>
      </div>

      <div
        style={{
          fontSize: 13,
          color: "var(--muted-foreground)",
          marginBottom: 4,
        }}
      >
        1234 S Sample Ave · Cicero Township · synthetic sample
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--muted-foreground)",
          marginBottom: 2,
        }}
      >
        Estimated annual overpayment
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: "var(--foreground)",
          lineHeight: 1.1,
        }}
      >
        $1,420
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--muted-foreground)",
          }}
        >
          /yr
        </span>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 0 }}>
        <Row label="Your assessed value" value="$42,500" />
        <Row label="Avg of 3 nearby comps" value="$35,100" />
        <Row label="Assessment gap" value="+$7,400 (21%)" emph />
        <Row label="Assessment level" value="12.1% vs. 10% residential target" />
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 11,
          color: "var(--muted-foreground)",
          lineHeight: 1.45,
        }}
      >
        Illustrative figures. Your real check runs against Cook County
        public records — no signup, no card. We do not guarantee a
        reduction.
      </div>
    </aside>
  );
}

export default function HomePage() {
  const [result, setResult] = useState<Result | null>(null);
  const [checkError, setCheckError] = useState("");

  useEffect(() => {
    function handleStickyResult(event: Event) {
      const detail = (event as CustomEvent<{ result?: RawCheckResult; preview?: boolean; submittedInput?: string; error?: string }>).detail;
      if (detail?.error) {
        setResult(null);
        setCheckError(detail.error);
        return;
      }
      setCheckError("");
      setResult(normalizeCheckResult(detail?.result, Boolean(detail?.preview ?? true), detail?.submittedInput ?? ""));
    }
    window.addEventListener(FREE_CHECK_RESULT_EVENT, handleStickyResult);
    return () => window.removeEventListener(FREE_CHECK_RESULT_EVENT, handleStickyResult);
  }, []);

  return (
    <>
      <LiveTicker />
      <StickyAddressBar />

      <section id="hero-check" className="ot-hero ot-hero-split">
        <div className="ot-hero-inner ot-hero-inner-split">
          <div className="ot-hero-l">
            <HeroNarrative />
          </div>
          <div className="ot-hero-r ot-hero-r-stack">
            <HeroPreviewCard />
            <HeroCheckCard result={result} error={checkError} onResult={setResult} onError={setCheckError} />
          </div>
        </div>
      </section>

      <HeatmapHero />
      <SampleReportSection />
      <SpecificityBar />
      <MethodologyCard />
      <Testimonials />
      <PricingCompare />
      <HoaSection />
      <FaqSection />
    </>
  );
}
