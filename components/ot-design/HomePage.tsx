"use client";
import { useCallback, useEffect, useState } from "react";
import {
  RiskReversalBadge,
  StatusChip,
  StickyAddressBar,
  LiveTicker,
} from "@/components/ot-design/SiteChrome";

/* ── Sample result returned by /api/check stub ─────────────────────────── */
const SAMPLE_RESULT = {
  address: "Sample result — not your submitted address",
  township: "Lyons",
  windowStatus: "open" as const,
  windowCloses: "Window closes Jun 9, 2026",
  windowDaysRemaining: 27,
  yourAssessed: 42500,
  compsAvg: 35100,
  assessmentLevel: 12.1,
  overpayPerYear: 1420,
  overpay3Year: 4260,
  comps: 3,
};

type WindowStatus = "open" | "closed" | "future_cycle" | "unknown";

type Result = Omit<typeof SAMPLE_RESULT, "windowStatus"> & {
  windowStatus: WindowStatus;
  windowOpens?: string;
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
  } | null;
  source?: string | null;
  mode?: string | null;
};

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatIsoDateLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntilIso(iso?: string | null): number {
  if (!iso) return 0;
  const close = new Date(`${iso}T23:59:59`);
  if (Number.isNaN(close.getTime())) return 0;
  const now = new Date();
  return Math.max(0, Math.ceil((close.getTime() - now.getTime()) / 86_400_000));
}

function normalizeCheckResult(
  raw?: RawCheckResult | null,
  preview = true,
  submittedInput = "",
): Result {
  const r = raw ?? {};
  const subject = r.subject;
  const aw = r.appealWindowStatus;
  const isFreeCheckShape = Boolean(subject);
  const township = aw?.township ?? subject?.township ?? r.township ?? SAMPLE_RESULT.township;
  const closeLabel = formatIsoDateLabel(aw?.closeDate);
  const openLabel = formatIsoDateLabel(aw?.openDate);
  const status: WindowStatus =
    aw?.status === "closed" || aw?.status === "unknown" || aw?.status === "future_cycle" ? aw.status : "open";

  return {
    ...SAMPLE_RESULT,
    ...(!isFreeCheckShape ? r : {}),
    address: subject
      ? [subject.address, subject.city, subject.zipCode].filter(Boolean).join(", ")
      : (r.address ?? SAMPLE_RESULT.address),
    township,
    windowStatus: status,
    windowCloses: closeLabel
      ? `${township} window closes ${closeLabel}`
      : (isFreeCheckShape ? "Exact appeal dates unavailable" : (r.windowCloses ?? SAMPLE_RESULT.windowCloses)),
    windowOpens: openLabel ? `Opens ${openLabel}` : undefined,
    windowDaysRemaining: asFiniteNumber(r.windowDaysRemaining, status === "unknown" || status === "future_cycle" ? 0 : daysUntilIso(aw?.closeDate)),
    yourAssessed: asFiniteNumber(subject?.assessedTotalValue ?? r.yourAssessed, SAMPLE_RESULT.yourAssessed),
    compsAvg: asFiniteNumber(r.avgComparableAssessedValue ?? r.compsAvg, SAMPLE_RESULT.compsAvg),
    assessmentLevel: asFiniteNumber(r.equityRatio ?? r.assessmentLevel, SAMPLE_RESULT.assessmentLevel),
    overpayPerYear: isFreeCheckShape
      ? asFiniteNumber(r.potentialOverpaymentPerYear, 0)
      : asFiniteNumber(r.potentialOverpaymentPerYear ?? r.overpayPerYear, SAMPLE_RESULT.overpayPerYear),
    overpay3Year: isFreeCheckShape
      ? asFiniteNumber(r.potentialOverpayment3Year, 0)
      : asFiniteNumber(r.potentialOverpayment3Year ?? r.overpay3Year, SAMPLE_RESULT.overpay3Year),
    comps: asFiniteNumber(r.compCount ?? r.comps, SAMPLE_RESULT.comps),
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
        Cook County is probably <em>over-assessing</em> your home.
      </h1>
      <p className="ot-hero-subhead">See whether your home is over-assessed — free, no signup.</p>
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

function TownshipDeadline({
  township,
  daysRemaining,
  closeDate,
  openDate,
  status = "open",
  sticky = false,
}: {
  township: string;
  daysRemaining: number;
  closeDate: string;
  openDate?: string;
  status?: WindowStatus;
  sticky?: boolean;
}) {
  let tier: "info" | "urgent" | "soon" | "future" | "unknown" = "info";
  if (status === "future_cycle") tier = "future";
  else if (status === "unknown" || status === "closed") tier = "unknown";
  else if (status === "open" && daysRemaining < 7) tier = "urgent";
  else if (status === "open" && daysRemaining < 30) tier = "soon";

  const stickyClass = sticky && tier === "urgent" ? "is-sticky" : "";

  return (
    <div
      className={`ot-deadline ot-deadline-${tier} ${stickyClass}`}
      role="status"
    >
      <div className="ot-deadline-l">
        <span className="ot-deadline-dot" />
        <strong>{township} Township</strong>
      </div>
      <div className="ot-deadline-c">
        {status === "closed" ? (
          <><strong>Closed</strong><span>Appeal window closed</span></>
        ) : status === "unknown" ? (
          <><strong>Unknown</strong><span>{closeDate}</span></>
        ) : status === "future_cycle" ? (
          <><strong>Future cycle</strong><span>{openDate ?? "Appeal window not open"}</span></>
        ) : (
          <><strong>{daysRemaining} days</strong><span>until close</span></>
        )}
      </div>
      <div className="ot-deadline-r">{status === "unknown" ? "Check dates →" : closeDate}</div>
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
        onResult(normalizeCheckResult(data?.result ?? data, isPreview, submittedInput));
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
              href="https://www.cookcountyassessor.com/address-search"
              target="_blank"
              rel="noopener noreferrer"
            >
              cookcountyassessor.com
            </a>
          </span>
        </label>
      ) : (
        <label className="ot-field">
          <span className="ot-field-label">Street address</span>
          <input
            type="text"
            placeholder="123 Main St, Chicago, IL 60601"
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
  const gap = result.yourAssessed - result.compsAvg;
  const gapPct = result.compsAvg > 0 ? ((gap / result.compsAvg) * 100).toFixed(1) : "0.0";
  const gapDisplay = `${gap >= 0 ? "+" : ""}${fmtUSD(gap)}`;
  const resultOpportunity = result.overpayPerYear > 0;
  const resultWindowOpen = result.windowStatus === "open";
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
      <div className={`ot-result-savings${result.preview ? " ot-result-savings--sample" : ""}`}>
        <div className="ot-result-savings-label">
          {resultOpportunity ? "Estimated annual overpayment found" : "No overpayment flagged"}
        </div>
        <div className="ot-result-savings-amount">
          {fmtUSD(result.overpayPerYear)}
          <span>/yr</span>
        </div>
        <div className="ot-result-savings-3yr">
          ≈ {fmtUSD(result.overpay3Year)} over the 3-year cycle
        </div>
      </div>
      {result.preview && <div className="ot-result-sample-strip">SAMPLE DATA</div>}
      <div className={`ot-result-table${result.preview ? " ot-result-table--sample" : ""}`}>
        <div className="ot-result-row">
          <span className="ot-result-row-key">Your assessed value</span>
          <span className="ot-result-row-val">{fmtUSD(result.yourAssessed)}</span>
        </div>
        <div className="ot-result-row">
          <span className="ot-result-row-key">Avg of {result.comps} nearby comps</span>
          <span className="ot-result-row-val">{fmtUSD(result.compsAvg)}</span>
        </div>
        <div className="ot-result-row ot-result-row-emph">
          <span className="ot-result-row-key">Assessment gap</span>
          <span className="ot-result-row-val">
            {gapDisplay}{" "}
            <span className="ot-result-pct">({gapPct}%)</span>
          </span>
        </div>
        <div className="ot-result-row">
          <span className="ot-result-row-key">Assessment level</span>
          <span className="ot-result-row-val">
            {result.assessmentLevel.toFixed(1)}%
          </span>
        </div>
      </div>

      <TownshipDeadline
        township={result.township}
        daysRemaining={result.windowDaysRemaining}
        closeDate={result.windowCloses}
        openDate={result.windowOpens}
        status={result.windowStatus}
      />

      {resultOpportunity && resultWindowOpen ? (
        <>
          <div className="ot-result-tier-actions" aria-label="Filing options">
            <a href="/checkout?plan=diy" className="ot-cta ot-cta-block ot-result-tier-cta">DIY $69</a>
            <a href="/checkout?plan=done-for-you" className="ot-cta ot-cta-block ot-result-tier-cta">Done-For-You $97</a>
            <a href="/appeal-contingency" className="ot-cta ot-cta-block ot-result-tier-cta ot-result-tier-cta-secondary">Contingency</a>
          </div>
          <div className="ot-result-altline">
            Pick a filing option if the check shows a real opportunity · no account required to review
          </div>
        </>
      ) : resultOpportunity ? (
        <div className="ot-result-altline" role="status">
          This property shows a potential over-assessment, but {result.township} Township is not currently in an open appeal window. Save this check and verify filing dates before buying a filing package.
        </div>
      ) : (
        <div className="ot-result-altline" role="status">
          This property does not show a clear over-assessment from the available public-record comps. No filing package is recommended from this free check.
        </div>
      )}
    </div>
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
          <span className="ot-sample-stamp-line ot-sample-stamp-l2">Lyons Twp</span>
        </div>
        <div className="ot-sample-head">
          <div className="ot-sample-eyebrow">Your free check · sample</div>
          <div className="ot-sample-addr">1234 S Sample Ave, La Grange IL 60526</div>
          <div className="ot-sample-meta">PIN 18-06-214-011-0000 · Lyons Township</div>
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
          <span className="ot-sample-foot-dot" /> Lyons Township appeal window open through Jun 9, 2026
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
            Cook County Assessor + Board of Review public records, refreshed weekly
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
            All 38 Cook County townships · tracks every 2026 triennial window
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

const PRICING_PLANS = [
  {
    id: "diy", name: "DIY Appeal Packet", price: "$69",
    priceNote: "one-time · keep 100% of your savings",
    summary: "Everything you need to file the appeal yourself in your township.",
    tag: "Recommended",
    href: "/checkout",
    cta: "Get the DIY Packet",
    features: [
      { label: "Pre-written appeal argument", ok: true, detail: "Tailored to assessment level + comp uniformity" },
      { label: "3 nearby comparables", ok: true, detail: "Formatted for Board of Review" },
      { label: "Step-by-step filing instructions", ok: true, detail: "Specific to your township" },
      { label: "Deadline reminders", ok: true, detail: "2026 window + 2027 second pass" },
      { label: "We submit on your behalf", ok: false, detail: "You file yourself (~15 min)" },
    ],
  },
  {
    id: "dfy", name: "Done-For-You", price: "$97",
    priceNote: "one-time · we file and follow up",
    summary: "We prepare and submit the appeal — you just sign the authorization.",
    tag: null,
    href: "/checkout",
    cta: "Choose Done-For-You",
    features: [
      { label: "Pre-written appeal argument", ok: true, detail: "Tailored to assessment level + comp uniformity" },
      { label: "3 nearby comparables", ok: true, detail: "Formatted for Board of Review" },
      { label: "Step-by-step filing instructions", ok: true, detail: "Or skip — we file for you" },
      { label: "Deadline reminders", ok: true, detail: "2026 window + 2027 second pass" },
      { label: "We submit on your behalf", ok: true, detail: "Tracked through BoR decision" },
    ],
  },
  {
    id: "contingency", name: "Contingency", price: "22%",
    priceNote: "of first-year savings · only if granted",
    summary: "For larger potential reductions: no upfront service fee, reviewed before acceptance.",
    tag: "No upfront fee",
    href: "/appeal-contingency",
    cta: "Request contingency review",
    features: [
      { label: "Pre-written appeal argument", ok: true, detail: "Built after case review" },
      { label: "3 nearby comparables", ok: true, detail: "Formatted for Board of Review" },
      { label: "Step-by-step filing instructions", ok: false, detail: "We handle accepted cases" },
      { label: "Deadline reminders", ok: true, detail: "Tracked through decision" },
      { label: "We submit on your behalf", ok: true, detail: "After explicit authorization" },
    ],
  },
];

function PricingCompare() {
  return (
    <section id="pricing" className="ot-pcompare">
      <div className="ot-pcompare-inner">
        <div className="ot-pcompare-head">
          <div className="ot-eyebrow">Three ways to file</div>
          <h2 className="ot-h2">Same outcome. Pick flat-fee help or contingency review.</h2>
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
    q: "When is the deadline to file an appeal?",
    a: "Each Cook County township has its own appeal window. The county runs on a rolling 3-year triennial cycle, and only about a third of townships are open at any given time. Once you enter your address, we show your specific township's window and exact close date. The 2026 triennial covers the South and West Suburbs first; North Suburbs and the City of Chicago follow in 2027 and 2028.",
    expanded: true,
  },
  {
    id: "after-check",
    q: "What happens after I submit my free check?",
    a: "You'll see your full report on the next screen — assessed value vs. comparable properties, assessment-level gap, estimated annual and 3-year overpayment, and your township's appeal window status. No signup, no credit card. If your check shows over-assessment, you can pick the DIY Appeal Packet ($69), Done-For-You ($97), or request contingency review for larger cases. If your numbers don't suggest an appeal, we'll tell you that too.",
    expanded: true,
  },
  {
    id: "data",
    q: "Where does your data come from? How fresh is it?",
    a: "Cook County Assessor and Board of Review public records, refreshed every Sunday night. It's the same data the Board of Review uses to decide appeals.",
    expanded: true,
  },
  {
    id: "win-rate",
    q: "What if my appeal isn't successful?",
    a: "Cook County doesn't penalize you for filing — you keep the assessed value on file. Flat-fee filings include a procedural money-back guarantee if an OverTaxed IL error causes the county to reject the filing.",
    expanded: true,
  },
  {
    id: "diy-vs-dfy",
    q: "DIY Packet vs Done-For-You — which should I pick?",
    a: "Most homeowners pick the $69 DIY Appeal Packet when they want us to build the comp package and they are comfortable filing it themselves. Done-For-You at $97 is for homeowners who want us to submit after they sign explicit filing authorization.",
    expanded: true,
  },
  {
    id: "law-firm",
    q: "Are you a law firm?",
    a: "No. OverTaxed IL is not a law firm and does not provide legal advice. We help you organize public records into the format the Board of Review accepts.",
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
          legal-representation claim, no per-unit upsell. Drop your email and we&apos;ll
          come back with a packet plan once your township is in cycle.
        </p>

        {status === "success" ? (
          <div className="ot-rrb ot-rrb-inline" style={{ marginTop: 16 }}>
            <span className="ot-rrb-shield" aria-hidden="true">○</span>
            <span className="ot-rrb-text">
              <strong>You&apos;re on the list.</strong> We&apos;ll email you with a packet plan once we can support your township.
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
        1234 S Sample Ave · Lyons Township
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
            <HeroPreviewCard />
          </div>
          <div className="ot-hero-r">
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
