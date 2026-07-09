import { readFileSync } from "fs";
import path from "path";

import {
  loadOtDeadlineApprovalCards,
  toDisplayRow,
  getFixtureReferenceNow,
  type LoadedOtDeadlineCard,
} from "@/lib/social/ot-deadline-fixtures";

function byId(loaded: LoadedOtDeadlineCard[], id: string): LoadedOtDeadlineCard {
  const found = loaded.find((l) => l.card.content_id === id);
  if (!found) throw new Error(`fixture ${id} not found`);
  return found;
}

const CLEARED_ID = "ot-deadline-2026-07-09-cook-county";
const BLOCKED_ID = "ot-deadline-2026-07-09-closed-as-open";
const STALE_ID = "ot-deadline-2026-07-06-stale";

describe("OT deadline approval — internal read-only fixture surface", () => {
  const loaded = loadOtDeadlineApprovalCards();

  test("loads the demo fixtures and they are all brand 'ot'", () => {
    expect(loaded.length).toBeGreaterThanOrEqual(3);
    for (const { card } of loaded) expect(card.brand).toBe("ot");
  });

  test("source-verified card is approved for Facebook only, read-only", () => {
    const { card, row } = byId(loaded, CLEARED_ID);
    expect(card.source_verification_status).toBe("cleared");
    expect(card.public_action_status).toBe("approved_only");
    expect(row.approved_platforms).toEqual(["facebook"]);
    expect(row.badge).toEqual({ label: "Source verified", tone: "green" });
  });

  test("closed-township-as-open card is blocked and approved for nothing", () => {
    const { card, row } = byId(loaded, BLOCKED_ID);
    expect(card.source_verification_status).toBe("blocked");
    expect(row.approved_platforms).toEqual([]);
    expect(row.reasons.join(" ")).toMatch(/Oak Park/);
  });

  test("stale card is not cleared and approved for nothing", () => {
    const { card, row } = byId(loaded, STALE_ID);
    expect(card.source_verification_status).toBe("stale");
    expect(row.approved_platforms).toEqual([]);
  });

  test("every display row is non-postable (post_allowed false, approval_required true)", () => {
    for (const { row, card } of loaded) {
      expect(row.post_allowed).toBe(false);
      expect(card.post_allowed).toBe(false);
      expect(row.approval_required).toBe(true);
      expect(card.public_action_status).not.toBe("posted");
    }
  });

  test("source-sensitive (cleared) cards carry source_url, checked_at, verified_deadlines, expires_at", () => {
    for (const { card } of loaded) {
      if (card.source_verification_status !== "cleared") continue;
      expect(card.source_url).toBeTruthy();
      expect(card.source_checked_at).toBeTruthy();
      expect(card.verified_deadlines.length).toBeGreaterThan(0);
      expect(card.expires_at).toBeTruthy();
    }
  });

  test("date-specific cards expire same-day and no later than the nearest advertised deadline", () => {
    for (const { card } of loaded) {
      if (card.source_verification_status !== "cleared") continue;
      if (!card.source_checked_at || !card.expires_at) continue;

      const checked = new Date(card.source_checked_at).getTime();
      const expires = new Date(card.expires_at).getTime();
      const sameDayCeiling = checked + 24 * 60 * 60 * 1000;

      const openEnds = card.verified_deadlines
        .filter((d) => d.status === "open" || d.status === "closing_soon")
        .map((d) => new Date(`${d.deadline_date}T23:59:59.999Z`).getTime());
      const nearestDeadline = Math.min(...openEnds);

      expect(expires).toBeLessThanOrEqual(sameDayCeiling);
      expect(expires).toBeLessThanOrEqual(nearestDeadline);
    }
  });

  test("closed townships never appear as open verified deadlines", () => {
    for (const { card } of loaded) {
      const closed = new Set(card.closed_townships_mentioned.map((t) => t.toLowerCase()));
      const openTownships = card.verified_deadlines
        .filter((d) => d.status === "open" || d.status === "closing_soon")
        .map((d) => d.township.toLowerCase());
      for (const t of openTownships) expect(closed.has(t)).toBe(false);
    }
  });

  test("toDisplayRow can never surface a postable affordance", () => {
    const { card, decision } = byId(loaded, CLEARED_ID);
    // Even if a caller mutates the card object, the projection pins post_allowed false.
    const tampered = { ...card, post_allowed: true } as unknown as typeof card;
    const row = toDisplayRow(tampered, decision);
    expect(row.post_allowed).toBe(false);
    expect(Object.keys(row)).not.toContain("caption"); // raw caption not exposed as postable content
  });

  test("reference clock is a valid date", () => {
    expect(Number.isFinite(getFixtureReferenceNow().getTime())).toBe(true);
  });
});

describe("OT deadline surface performs no network / posting", () => {
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  test("fixtures loader has no network client or posting call", () => {
    const code = stripComments(
      readFileSync(path.join(__dirname, "../../lib/social/ot-deadline-fixtures.ts"), "utf8"),
    );
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\baxios\b/i);
    expect(code).not.toMatch(/\bbuffer\b/i);
    expect(code).not.toMatch(/graph\.facebook|\/me\/feed|instagram/i);
    expect(code).not.toMatch(/\.(post|publish|schedule|upload|send)\s*\(/i);
    expect(code).not.toMatch(/process\.env/);
  });

  test("admin page is a read-only server component with no posting action", () => {
    const page = readFileSync(
      path.join(__dirname, "../../app/admin/ot-deadline-approval/page.tsx"),
      "utf8",
    );
    // Server component (no client interactivity), noindex, no mutation surface.
    expect(page).not.toMatch(/["']use client["']/);
    expect(page).not.toMatch(/onClick=|onSubmit=|<form\b|<button\b/);
    expect(page).not.toMatch(/\bfetch\s*\(/);
    expect(page).not.toMatch(/\.(post|publish|schedule|upload|send)\s*\(/i);
    expect(page).not.toMatch(/process\.env/);
    expect(page).toMatch(/index:\s*false/);
  });
});
