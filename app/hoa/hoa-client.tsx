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

// ── Resident-resource flyer download ────────────────────────────────────────
//
// Single source of truth for the flyer asset paths + the GA4 event
// shape. Two surfaces (hero + above the notice section) both use this,
// so the analytics payload stays consistent. The HTML version is the
// canonical asset — it's the same standalone export the design team
// approved. The PDF is a one-page Letter-size render of the same HTML
// produced via headless Chrome (run locally; see commit for details).
// Either is safe to share; the click tracks which format the visitor
// actually picked.

export const HOA_RESOURCE_HTML_PATH = "/resources/overtaxed-hoa-resident-resource.html";
export const HOA_RESOURCE_PDF_PATH = "/resources/overtaxed-hoa-resident-resource.pdf";

export type HoaResourceSurface = "hero" | "resident_notice_section";
type HoaResourceFormat = "html" | "pdf";

interface ResourceDownloadGroupProps {
  source: HoaResourceSurface;
  primaryLabel?: string;
  helperText?: string;
}

/**
 * Quiet two-button group: primary "Download" (PDF) + secondary "Preview"
 * (HTML in a new tab). Both fire `hoa_resource_download` with the
 * format and surface in the payload so we can split downloads from
 * previews and hero clicks from in-context clicks. No popups, no
 * gates, no email capture.
 */
export function ResourceDownloadGroup({
  source,
  primaryLabel = "Download the resident resource flyer",
  helperText = "Prefer to copy-paste? Use the notices below.",
}: ResourceDownloadGroupProps) {
  function emit(format: HoaResourceFormat) {
    trackEvent("hoa_resource_download", {
      format,
      source,
      utm_campaign: NOTICE_CAMPAIGN,
    });
  }
  return (
    <div className="ot-hoa-resource-cta" style={{ display: "grid", gap: 10, marginTop: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <a
          href={HOA_RESOURCE_PDF_PATH}
          download="overtaxed-hoa-resident-resource.pdf"
          className="ot-cta"
          data-action="download-hoa-resource"
          data-format="pdf"
          data-source={source}
          onClick={() => emit("pdf")}
        >
          {primaryLabel} <span className="ot-cta-arrow">↓</span>
        </a>
        <a
          href={HOA_RESOURCE_HTML_PATH}
          target="_blank"
          rel="noopener"
          className="ot-cta ot-cta-ghost"
          data-action="download-hoa-resource"
          data-format="html"
          data-source={source}
          onClick={() => emit("html")}
        >
          Preview in browser
        </a>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft, #6f6457)" }}>{helperText}</p>
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

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://overtaxed-il.com").replace(/\/$/, "");

function noticeUrl(target: HoaLinkTarget): string {
  const params = new URLSearchParams({
    utm_source: "hoa_notice",
    utm_medium: "email",
    utm_campaign: NOTICE_CAMPAIGN,
  });
  return `${APP_URL}${target}?${params.toString()}`;
}

const SHORT_NOTICE = (): string =>
  [
    "Cook County property tax appeal deadlines vary by township, and owners often miss the window simply because they do not know when to check.",
    "",
    `If you'd like to check your township's appeal window and your current assessment, the free tools are at ${APP_URL} — see ${noticeUrl("/deadlines")} for your appeal window and ${noticeUrl("/check")} to look up your assessment.`,
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
    `Cook County reassesses property in cycles, and the formal appeal window varies by township. Some owners may find appeal opportunities they otherwise would have missed if they don't check before their deadline. Updated for 2026 Cook County appeal windows, OverTaxed IL maintains two free tools:`,
    "",
    `  • Township deadline lookup: ${noticeUrl("/deadlines")}`,
    `  • Free assessment check (no signup): ${noticeUrl("/check")}`,
    "",
    "What you'd typically do, in plain steps:",
    "  1. Look up your township to see whether your appeal window is open.",
    "  2. Check your current assessment level against comparable properties.",
    "  3. Decide whether you want to act before your deadline.",
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
