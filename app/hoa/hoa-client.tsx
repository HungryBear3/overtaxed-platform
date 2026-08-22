"use client";

import Link from "next/link";
import { useState } from "react";
import { trackEvent } from "@/lib/analytics/events";

/**
 * Client-side interactive pieces for /hoa.
 *
 * - Two resident-notice templates with copy-to-clipboard buttons. Each
 *   copy fires a `hoa_notice_copy` GA4 event tagged with the variant.
 * - One tracked outbound link helper. Every /deadlines and /check
 *   link out of /hoa flows through this so we can measure how often
 *   property managers (or their residents, once distributed) click
 *   through to the actual tools. UTM params on the href let
 *   downstream analytics distinguish HOA-driven traffic.
 *
 * Copy stance is enforced at the source — both templates use the
 * "may find appeal opportunities they otherwise would have missed"
 * framing and explicitly disclaim guarantees / legal advice. Nothing
 * in this file collects PII or opens a contact form.
 */

const NOTICE_CAMPAIGN = "hoa_resident_notice_2026";

type HoaLinkSource =
  | "hero_deadlines_button"
  | "hero_check_button"
  | "explainer_deadlines_link"
  | "explainer_check_link"
  | "footer_deadlines_link"
  | "footer_check_link";

type HoaLinkTarget = "/deadlines" | "/check";

function buildHref(target: HoaLinkTarget, source: HoaLinkSource): string {
  const params = new URLSearchParams({
    utm_source: "hoa",
    utm_medium: "internal",
    utm_campaign: NOTICE_CAMPAIGN,
    utm_content: source,
  });
  return `${target}?${params.toString()}`;
}

export interface TrackedHoaLinkProps {
  target: HoaLinkTarget;
  source: HoaLinkSource;
  className?: string;
  children: React.ReactNode;
}

export function TrackedHoaLink({ target, source, className, children }: TrackedHoaLinkProps) {
  const href = buildHref(target, source);
  return (
    <Link
      href={href}
      className={className}
      data-utm-content={source}
      onClick={() => {
        trackEvent("hoa_outbound_click", {
          target,
          source,
          utm_campaign: NOTICE_CAMPAIGN,
        });
      }}
    >
      {children}
    </Link>
  );
}

// ── Resident-resource flyer download — WITHDRAWN ────────────────────────────
//
// The two artifacts under `public/resources/` are no longer offered. They are
// left on disk (nothing links to them, and deleting a design asset is not this
// change's call) but they are not served from any surface.
//
// Their content is the reason. The flyer carries a standing "Current appeal
// windows" badge, the line "Refreshed monthly", and a description of
// `/deadlines` as a "lookup table of all 38 Cook County townships, with open
// and close dates for the 2026 cycle". None of those is true:
//
//   - No township has a verified window today. `evaluateOfficialDeadlineState`
//     refuses the committed snapshot, so `/deadlines` shows no dates at all.
//     The flyer describes a page that does not exist as described.
//   - Nothing refreshes it monthly. It was produced once by a local headless
//     Chrome run, and the JSX it was rendered from is not in this repository —
//     it survives only inside the self-extracting HTML bundle. There is no
//     source to correct and no pipeline to correct it from.
//   - It also names the Board of Review's decision as what outcomes depend on,
//     without CC-11, on an Assessor-stage artifact.
//
// This is the worst carrier in the product for a stale window claim. It is
// designed to be printed and pinned in a lobby, where it outlives the page it
// came from, carries no retrieval timestamp a reader could check, and is read
// by residents who never visit the site. A date we cannot attribute is bad on a
// web page; on a poster with our name on it, it is a claim we cannot withdraw.
//
// Correcting the artifacts would mean re-encoding the bundle payload and
// re-rendering the PDF through headless Chrome. Re-rendering is a build action
// and the two would disagree until both were done. Suppressing the surface is
// the narrow fix; regenerating the flyer from real verified state is separate
// work that needs a real snapshot first.

export type HoaResourceSurface = "hero" | "resident_notice_section";

interface ResourceDownloadGroupProps {
  source: HoaResourceSurface;
  primaryLabel?: string;
  helperText?: string;
}

/**
 * Replaces the flyer download with a link to the live deadlines page.
 *
 * `/deadlines` states what is and is not verified at the moment it is read,
 * which is the property the printed flyer structurally cannot have.
 */
export function ResourceDownloadGroup({
  source,
  helperText = "Prefer to copy-paste? Use the notices below.",
}: ResourceDownloadGroupProps) {
  return (
    <div className="ot-hoa-resource-cta" style={{ display: "grid", gap: 10, marginTop: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <a
          href="/deadlines"
          className="ot-cta"
          data-action="hoa-resource-deadlines"
          data-source={source}
          onClick={() =>
            trackEvent("hoa_resource_deadlines_click", {
              source,
              utm_campaign: NOTICE_CAMPAIGN,
            })
          }
        >
          Look up your township&apos;s appeal window <span className="ot-cta-arrow">→</span>
        </a>
        <a
          href="https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
          target="_blank"
          rel="noopener noreferrer"
          className="ot-cta ot-cta-ghost"
          data-action="hoa-resource-county-calendar"
          data-source={source}
        >
          Cook County Assessor calendar
        </a>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft, #6f6457)" }}>
        We no longer publish a printable deadline flyer. Appeal dates are set by township and
        revised through the year, and a printed sheet cannot say when it was last checked — so
        it stays accurate only until the county changes something. {helperText}
      </p>
    </div>
  );
}

// ── Notice templates ────────────────────────────────────────────────────────
//
// Both templates link to overtaxed-il.com/deadlines and /check with a
// distinct UTM `medium=hoa_notice` so post-distribution clicks come
// in tagged differently from on-page CTAs. The base URL is read from
// the public NEXT_PUBLIC_APP_URL env so dev/staging notices don't
// hardcode production. Falls back to the production host.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com").replace(/\/$/, "");

function noticeUrl(target: HoaLinkTarget): string {
  const params = new URLSearchParams({
    utm_source: "hoa_notice",
    utm_medium: "email",
    utm_campaign: NOTICE_CAMPAIGN,
  });
  return `${APP_URL}${target}?${params.toString()}`;
}

/**
 * The two copy-paste notices.
 *
 * These are the most durable text this product emits: a board pastes one into a
 * newsletter or a lobby noticeboard, and it is then read months later by people
 * who never came here and cannot tell when it was written. So they name the
 * county as the authority on dates and never imply that we hold one. The
 * previous long notice said it was "Updated for 2026 Cook County appeal
 * windows" and told owners to "look up your township to see whether your appeal
 * window is open" — a currency claim we cannot support and an instruction to a
 * page that, with no verified snapshot, cannot answer it.
 */
const COUNTY_CALENDAR_URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";

const SHORT_NOTICE = (): string =>
  [
    "Cook County property tax appeal deadlines vary by township, and owners often miss the window simply because they do not know when to check.",
    "",
    `The county publishes and revises those dates through the year, so confirm yours directly at ${COUNTY_CALENDAR_URL} before you rely on it.`,
    "",
    `If you'd also like to look up your current assessment, there are free tools at ${APP_URL} — ${noticeUrl("/check")} compares your assessment against public-record comparable properties, and ${noticeUrl("/deadlines")} shows a township's filing window where it has been verified against the county's calendar, and says so plainly where it has not.`,
    "",
    "The board is sharing this resource only; there's no signup, no fee, and no commitment. Whether to appeal is each owner's decision.",
  ].join("\n");

const LONG_NOTICE = (): string =>
  [
    "Subject: Cook County property tax appeal deadlines — informational only",
    "",
    "Dear neighbors,",
    "",
    "The board is sharing a free property tax resource owners may want to use. We are not endorsing a service, signing a vendor agreement, or collecting a referral fee — this is informational only.",
    "",
    "Cook County reassesses property in cycles, and the formal appeal window varies by township. Filing dates are published and revised by the county through the year.",
    "",
    `Please treat the county as the authority on your own deadline, not this notice and not any website — including the one below. Confirm it at ${COUNTY_CALENDAR_URL}. Late filings are not accepted.`,
    "",
    "OverTaxed IL maintains two free tools:",
    "",
    `  • Free assessment check (no signup): ${noticeUrl("/check")}`,
    `  • Township deadline pages: ${noticeUrl("/deadlines")} — these show a filing window only where it has been verified against the county's calendar, together with when it was read. Where it has not been verified, they show no date and say so.`,
    "",
    "What you'd typically do, in plain steps:",
    "  1. Confirm your township and your filing deadline with the county.",
    "  2. Check your current assessment level against comparable properties.",
    "  3. Decide whether you want to act before that deadline.",
    "",
    "What this is NOT: legal advice, a guarantee that your taxes will go down, an obligation, or an endorsement by the board. OverTaxed IL is not a law firm. For legal questions about your property or appeal, please consult a licensed Illinois attorney.",
    "",
    "Thanks,",
    "The board",
  ].join("\n");

type Variant = "short" | "long";

export function HoaNoticeTemplates() {
  const [copied, setCopied] = useState<Variant | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copyVariant(variant: Variant) {
    const body = variant === "short" ? SHORT_NOTICE() : LONG_NOTICE();
    setError(null);
    try {
      await navigator.clipboard.writeText(body);
      setCopied(variant);
      trackEvent("hoa_notice_copy", {
        variant,
        utm_campaign: NOTICE_CAMPAIGN,
        length_chars: body.length,
      });
      window.setTimeout(() => setCopied((current) => (current === variant ? null : current)), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not access clipboard");
    }
  }

  return (
    <div className="ot-hoa-notices" style={{ display: "grid", gap: 24, marginTop: 16 }}>
      <NoticeCard
        variant="short"
        title="Short notice (2-3 sentences)"
        helper="Drop into a community email, building lobby sign, or HOA portal post."
        body={SHORT_NOTICE()}
        onCopy={() => copyVariant("short")}
        justCopied={copied === "short"}
      />
      <NoticeCard
        variant="long"
        title="Long notice (full resident email)"
        helper="Use as a complete email body. Already framed as board-shared, informational, no fee."
        body={LONG_NOTICE()}
        onCopy={() => copyVariant("long")}
        justCopied={copied === "long"}
      />
      {error && (
        <p className="ot-method-lede" role="alert" style={{ color: "var(--coral-dark, #a3360c)" }}>
          Couldn&apos;t copy automatically — {error}. Select the text manually and copy.
        </p>
      )}
    </div>
  );
}

function NoticeCard({
  variant,
  title,
  helper,
  body,
  onCopy,
  justCopied,
}: {
  variant: Variant;
  title: string;
  helper: string;
  body: string;
  onCopy: () => void;
  justCopied: boolean;
}) {
  return (
    <div
      className="ot-hoa-notice-card"
      style={{
        border: "1px solid rgba(36,31,25,0.14)",
        background: "var(--surface, #fff8ec)",
        borderRadius: 14,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h3>
        <span style={{ fontSize: 12, color: "var(--ink-soft, #6f6457)" }}>{helper}</span>
      </div>
      <textarea
        readOnly
        value={body}
        data-variant={variant}
        aria-label={`${title} body`}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: variant === "short" ? 140 : 280,
          fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)",
          fontSize: 13,
          lineHeight: 1.55,
          padding: 12,
          border: "1px solid rgba(36,31,25,0.16)",
          borderRadius: 8,
          background: "#fff",
          color: "var(--ink, #241f19)",
          resize: "vertical",
        }}
      />
      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          onClick={onCopy}
          className="ot-cta"
          style={{ minWidth: 200, justifyContent: "center" }}
          data-action="copy-hoa-notice"
          data-variant={variant}
        >
          {justCopied ? "Copied ✓" : `Copy ${variant === "short" ? "short" : "long"} notice`}
        </button>
        <span style={{ fontSize: 12, color: "var(--ink-soft, #6f6457)" }}>
          Clipboard-only. No data sent.
        </span>
      </div>
    </div>
  );
}
