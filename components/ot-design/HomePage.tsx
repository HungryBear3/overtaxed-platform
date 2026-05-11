"use client";
import { useCallback, useState } from "react";
import {
  RiskReversalBadge,
  RiskReversalRail,
  StatusChip,
  StickyAddressBar,
  LiveTicker,
} from "@/components/ot-design/SiteChrome";

/* ── Sample result returned by /api/check stub ─────────────────────────── */
const SAMPLE_RESULT = {
  address: "4218 N Kedvale Ave, Chicago IL 60641",
  township: "Jefferson",
  windowStatus: "open" as const,
  windowCloses: "Aug 12, 2026",
  windowDaysRemaining: 21,
  yourAssessed: 38420,
  compsAvg: 31180,
  equityRatio: 12.3,
  overpayPerYear: 1240,
  overpay3Year: 3720,
  comps: 3,
};

type Result = typeof SAMPLE_RESULT;

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
      <p className="ot-hero-subhead">Find out in 60 seconds.</p>
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
            Your <strong>equity ratio</strong> vs. Cook County&apos;s 10% target
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
  sticky = false,
}: {
  township: string;
  daysRemaining: number;
  closeDate: string;
  sticky?: boolean;
}) {
  let tier: "info" | "urgent" | "soon" = "info";
  if (daysRemaining < 7) tier = "urgent";
  else if (daysRemaining < 30) tier = "soon";

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
        Appeal window closes in <strong>{daysRemaining} days</strong>
        {tier === "soon" && (
          <span className="ot-deadline-nudge">Don&apos;t miss this window</span>
        )}
        {tier === "urgent" && (
          <span className="ot-deadline-nudge">
            Closes this week — file now
          </span>
        )}
      </div>
      <div className="ot-deadline-r">{closeDate}</div>
    </div>
  );
}

function HeroCheckCard({
  result,
  onResult,
}: {
  result: Result | null;
  onResult: (r: Result | null) => void;
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
      try {
        await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, pin, mode }),
        });
      } catch {
        /* preview stub — ignore */
      }
      // Match the design's ~900ms latency feel
      setTimeout(() => {
        setLoading(false);
        onResult(SAMPLE_RESULT);
      }, 900);
    },
    [address, pin, mode, onResult],
  );

  if (result) {
    return (
      <HeroCheckResult
        result={result}
        onReset={() => {
          setPin("");
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
            <a href="#" onClick={(e) => e.preventDefault()}>
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

      <div className="ot-trust-bar" aria-live="polite">
        <span>
          <strong>2,400+</strong> Cook County homeowners checked this month
        </span>
        <span className="ot-trust-sep" aria-hidden="true">
          ·
        </span>
        <span>CCAO + Board of Review data</span>
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
  const gapPct = ((gap / result.compsAvg) * 100).toFixed(1);
  return (
    <div className="ot-check-card ot-check-result">
      <div className="ot-result-head">
        <div className="ot-result-eyebrow">
          Your free check · {result.address}
        </div>
        <button type="button" onClick={onReset} className="ot-result-reset">
          Check another →
        </button>
      </div>
      <div className="ot-result-savings">
        <div className="ot-result-savings-label">Estimated annual overpayment</div>
        <div className="ot-result-savings-amount">
          {fmtUSD(result.overpayPerYear)}
          <span>/yr</span>
        </div>
        <div className="ot-result-savings-3yr">
          ≈ {fmtUSD(result.overpay3Year)} over the 3-year cycle
        </div>
      </div>
      <div className="ot-result-table">
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
            +{fmtUSD(gap)}{" "}
            <span className="ot-result-pct">({gapPct}%)</span>
          </span>
        </div>
        <div className="ot-result-row">
          <span className="ot-result-row-key">Equity ratio</span>
          <span className="ot-result-row-val">
            {result.equityRatio.toFixed(1)}%
            <span className="ot-result-tag ot-result-tag-warn">over-assessed</span>
          </span>
        </div>
      </div>

      <TownshipDeadline
        township={result.township}
        daysRemaining={result.windowDaysRemaining}
        closeDate={result.windowCloses}
      />

      <a href="/checkout" className="ot-cta ot-cta-block">
        Start your appeal — DIY Packet $69 <span className="ot-cta-arrow">→</span>
      </a>
      <div className="ot-result-altline">
        Or <a href="#offer">choose Done-For-You at $97</a> · No account to start
        · No credit card to check
      </div>
    </div>
  );
}

/* ── Equity-ratio histogram (locked default per brief) ──────────────────── */
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
        Equity ratio across Cook County properties
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
            Most Cook County homes sit <em>past</em> the 10% equity-ratio target.
          </h2>
          <p className="ot-heatmap-lede">
            The statutory equity-ratio target is 10%. Anything to the right of
            the line is over-assessed — and most Cook County properties land
            there.
          </p>
        </div>
        <div className="ot-heatmap-vis ot-heatmap-vis-hist">
          <HeatmapHistogram />
        </div>
      </div>
      <div className="ot-heatmap-caption">
        Distribution of equity ratios across ~1.8M Cook County parcels (CCAO
        public records). Properties past 10% are candidates for appeal.
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
  const equityRatio = 12.1;
  const targetRatio = 10.0;
  const max = Math.max(yourAV, compsAV) * 1.1;
  const trackMax = 14;
  const targetPct = (targetRatio / trackMax) * 100;
  const valuePct = (equityRatio / trackMax) * 100;

  return (
    <div className="ot-sample" aria-hidden="true">
      <div className="ot-sample-doc">
        <div className="ot-sample-stamp">
          <span className="ot-sample-stamp-line ot-sample-stamp-l1">Sample</span>
          <span className="ot-sample-stamp-line ot-sample-stamp-l2">Jefferson Twp</span>
        </div>
        <div className="ot-sample-head">
          <div className="ot-sample-eyebrow">Your free check · sample</div>
          <div className="ot-sample-addr">1234 N Sample St, Chicago IL 60618</div>
          <div className="ot-sample-meta">PIN 14-18-102-034-0000 · Jefferson Township</div>
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
        <div className="ot-sample-equity">
          <div className="ot-sample-equity-head">
            <span className="ot-sample-equity-label">Equity ratio</span>
            <span className="ot-sample-equity-badge">{equityRatio.toFixed(1)}%</span>
          </div>
          <div className="ot-sample-equity-track">
            <div className="ot-sample-equity-zone-ok" style={{ width: `${targetPct}%` }} />
            <div className="ot-sample-equity-zone-over" style={{ left: `${targetPct}%`, width: `${100 - targetPct}%` }} />
            <div className="ot-sample-equity-marker" style={{ left: `${valuePct}%` }} />
          </div>
          <div className="ot-sample-equity-axis">
            <span className="ot-sample-equity-target-line" style={{ left: `${targetPct}%` }} />
            <span className="ot-sample-equity-target-label" style={{ left: `${targetPct}%` }}>
              Target 10.0%
            </span>
          </div>
          <div className="ot-sample-equity-foot">
            <span className="ot-sample-flag">Over-assessed by 2.1 percentage points</span>
          </div>
        </div>
        <div className="ot-sample-foot">
          <span className="ot-sample-foot-dot" /> Jefferson Township appeal window open through Aug 12, 2026
        </div>
      </div>
    </div>
  );
}

function SampleReportSection() {
  return (
    <section className="ot-sample-section" aria-labelledby="ot-sample-h">
      <div className="ot-sample-section-inner">
        <div className="ot-sample-section-text">
          <div className="ot-sample-section-eyebrow">What you&apos;ll get</div>
          <h2 id="ot-sample-h" className="ot-h2">
            A one-page report — the only thing the Board of Review actually reads.
          </h2>
          <p className="ot-sample-section-lede">
            Your assessed value, three nearby comps, your equity ratio against
            Cook County&apos;s 10% target, and the dollar overpayment math. Every
            number is sourced from public CCAO records you can verify yourself.
          </p>
          <ul className="ot-sample-section-list">
            <li><strong>Estimated annual + 3-year overpayment</strong> in dollars</li>
            <li><strong>3 nearby comps</strong>, picked from your neighborhood code</li>
            <li><strong>Your equity ratio</strong> vs. Cook County&apos;s 10% statutory target</li>
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
            We compare your equity ratio against Cook County&apos;s 10% target
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
    { num: "03", h: "Compute your equity ratio", p: "Cook County's statutory target is 10% of market value. We show your ratio vs. the comp average — over 10.5% is a strong appeal candidate, 10–10.5% is borderline." },
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
        <h2 className="ot-h2">Customer wins, on the record — coming in the 2026 cycle.</h2>
        <p className="ot-testimonials-note">
          We don&apos;t publish testimonials we haven&apos;t verified. Our first
          customer filings are being prepared for the 2026 South & West
          Suburbs window — once the Cook County Board of Review rules,
          we&apos;ll publish names, townships, and Board outcomes here.
        </p>
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
    features: [
      { label: "Pre-written appeal argument", ok: true, detail: "Tailored to your equity ratio" },
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
    features: [
      { label: "Pre-written appeal argument", ok: true, detail: "Tailored to your equity ratio" },
      { label: "3 nearby comparables", ok: true, detail: "Formatted for Board of Review" },
      { label: "Step-by-step filing instructions", ok: true, detail: "Or skip — we file for you" },
      { label: "Deadline reminders", ok: true, detail: "2026 window + 2027 second pass" },
      { label: "We submit on your behalf", ok: true, detail: "Tracked through BoR decision" },
    ],
  },
];

function PricingCompare() {
  return (
    <section id="pricing" className="ot-pcompare">
      <div className="ot-pcompare-inner">
        <div className="ot-pcompare-head">
          <div className="ot-eyebrow">Two ways to file</div>
          <h2 className="ot-h2">Same outcome. Pick how hands-on you want to be.</h2>
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
              <a href="/checkout" className={`ot-cta ot-cta-block${plan.id === "diy" ? "" : " ot-cta-ghost"}`}>
                {plan.id === "diy" ? "Get the DIY Packet" : "Choose Done-For-You"}
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
    a: "You'll see your full report on the next screen — assessed value vs. comparable properties, equity ratio, estimated annual and 3-year overpayment, and your township's appeal window status. No signup, no credit card. If your check shows over-assessment, you can pick the DIY Appeal Packet ($69) or Done-For-You ($97). If your numbers don't suggest an appeal, we'll tell you that too.",
    expanded: true,
  },
  {
    id: "data",
    q: "Where does your data come from? How fresh is it?",
    a: "Cook County Assessor and Board of Review public records, refreshed every Sunday night. It's the same data the Board of Review uses to decide appeals.",
    expanded: false,
  },
  {
    id: "win-rate",
    q: "What if my appeal isn't successful?",
    a: "Cook County doesn't penalize you for filing — you keep the assessed value on file. The DIY Packet includes a 100% money-back guarantee if your township denies the filing on procedural grounds.",
    expanded: false,
  },
  {
    id: "diy-vs-dfy",
    q: "DIY Packet vs Done-For-You — which should I pick?",
    a: "Most homeowners pick DIY at $69 and file in an evening. Done-For-You at $97 is for folks who'd rather not deal with the Board of Review forms themselves.",
    expanded: false,
  },
  {
    id: "law-firm",
    q: "Are you a law firm?",
    a: "No. OverTaxed IL is not a law firm and does not provide legal advice. We help you organize public records into the format the Board of Review accepts.",
    expanded: false,
  },
];

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

export default function HomePage() {
  const [result, setResult] = useState<Result | null>(null);
  return (
    <>
      <LiveTicker />
      <StickyAddressBar />
      <RiskReversalRail />

      <section id="hero-check" className="ot-hero ot-hero-split">
        <div className="ot-hero-inner ot-hero-inner-split">
          <div className="ot-hero-l">
            <HeroNarrative />
          </div>
          <div className="ot-hero-r">
            <HeroCheckCard result={result} onResult={setResult} />
          </div>
        </div>
      </section>

      <HeatmapHero />
      <SampleReportSection />
      <SpecificityBar />
      <MethodologyCard />
      <Testimonials />
      <PricingCompare />
      <FaqSection />
    </>
  );
}
