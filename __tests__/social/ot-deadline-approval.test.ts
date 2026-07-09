import { readFileSync } from "fs";
import path from "path";

import {
  evaluateOtDeadlinePost,
  buildOtDeadlineApprovalCard,
  isApprovedForPlatform,
  EXAMPLE_OT_DEADLINE_POST,
  ASSESSOR_CALENDAR_URL,
  type OtDeadlinePostInput,
} from "@/lib/social/ot-deadline-approval";

// Same-day as Rex's source check in the example (2026-07-09).
const CHECK_DAY = new Date("2026-07-09T15:00:00.000Z");

function makePost(overrides: Partial<OtDeadlinePostInput> = {}): OtDeadlinePostInput {
  return { ...EXAMPLE_OT_DEADLINE_POST, ...overrides };
}

describe("OT deadline social approval — source verification gating", () => {
  // 1. Source-verified OT post can be marked approval-ready for Facebook only.
  test("source-verified post is approval-ready for Facebook only", () => {
    const card = buildOtDeadlineApprovalCard(makePost(), { now: CHECK_DAY });

    expect(card.source_verification_status).toBe("cleared");
    expect(card.public_action_status).toBe("approved_only");
    expect(card.platform_scope).toEqual(["facebook"]);

    // Facebook is in scope...
    expect(isApprovedForPlatform(card, "facebook")).toBe(true);
    // ...but approval does NOT extend to other surfaces or boosting.
    expect(isApprovedForPlatform(card, "instagram")).toBe(false);
    expect(isApprovedForPlatform(card, "buffer")).toBe(false);
    expect(isApprovedForPlatform(card, "boost")).toBe(false);

    // Approval is never permission to post.
    expect(card.post_allowed).toBe(false);
    expect(card.approval_required).toBe(true);
    expect(card.source_url).toBe(ASSESSOR_CALENDAR_URL);
  });

  // 2. Missing source URL blocks approval.
  test("missing source URL blocks approval", () => {
    const decision = evaluateOtDeadlinePost(makePost({ source_url: null }), { now: CHECK_DAY });
    expect(decision.source_verification_status).toBe("missing");
    expect(decision.approval_ready).toBe(false);

    const card = buildOtDeadlineApprovalCard(makePost({ source_url: null }), { now: CHECK_DAY });
    expect(card.public_action_status).toBe("held");
    expect(isApprovedForPlatform(card, "facebook")).toBe(false);
  });

  // 3. Stale checked date blocks approval.
  test("stale (non same-day) source check blocks approval for date-specific copy", () => {
    const decision = evaluateOtDeadlinePost(
      makePost({ source_checked_at: "2026-07-06T14:00:00.000Z" }),
      { now: CHECK_DAY },
    );
    expect(decision.source_verification_status).toBe("stale");
    expect(decision.approval_ready).toBe(false);
  });

  // 4. Caption with deadline dates but no verification blocks approval.
  test("deadline dates in caption with no verified_deadlines blocks approval", () => {
    const decision = evaluateOtDeadlinePost(
      makePost({ verified_deadlines: [], closed_townships_mentioned: [] }),
      { now: CHECK_DAY },
    );
    expect(decision.source_verification_status).toBe("blocked");
    expect(decision.approval_ready).toBe(false);
  });

  // 5. Closed township mentioned as open blocks approval.
  test("a closed township presented as open blocks approval", () => {
    const decision = evaluateOtDeadlinePost(
      makePost({
        caption: "Cook County appeals are open now — Oak Park file by Jul 20, Lakeview Jul 13.",
        verified_deadlines: [{ township: "Lakeview", deadline_date: "2026-07-13", status: "open" }],
        closed_townships_mentioned: ["Oak Park", "Riverside", "Berwyn"],
      }),
      { now: CHECK_DAY },
    );
    expect(decision.source_verification_status).toBe("blocked");
    expect(decision.approval_ready).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/Oak Park/);
  });

  // 6. Non-OT evergreen post is unaffected.
  test("non-OT evergreen post is out of scope (unaffected)", () => {
    const evergreen: OtDeadlinePostInput = {
      brand: "hsb",
      content_id: "hsb-evergreen-1",
      platform_scope: ["instagram"],
      asset_path: "public/social/hsb/evergreen.png",
      caption: "Turn your child into the hero of their own storybook.",
      source_url: null,
      source_name: null,
      source_checked_at: null,
      source_last_updated_marker: null,
      verified_deadlines: [],
      closed_townships_mentioned: [],
    };
    const decision = evaluateOtDeadlinePost(evergreen, { now: CHECK_DAY });
    // OT source-verification rules do not apply to a non-OT post.
    expect(decision.applies).toBe(false);
    expect(decision.post_allowed).toBe(false);
  });

  // 7. No function performs network posting or Buffer/Facebook mutation.
  test("module performs no network / Buffer / Facebook posting", () => {
    const raw = readFileSync(
      path.join(__dirname, "../../lib/social/ot-deadline-approval.ts"),
      "utf8",
    );
    // Scan CODE only — doc comments legitimately describe the boundaries
    // ("no fetch/axios/Buffer", "no secrets/tokens"), so strip comments first.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    // No network clients or posting surfaces anywhere in the code.
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\baxios\b/i);
    expect(code).not.toMatch(/XMLHttpRequest/);
    expect(code).not.toMatch(/graph\.facebook|facebook\.com\/.*\/(feed|photos)|\/me\/feed/i);
    expect(code).not.toMatch(/\bbuffer\b/i);
    expect(code).not.toMatch(/\.(post|publish|schedule|upload|send)\s*\(/i);
    // No secret USAGE (env reads, bearer headers, or token-shaped literals).
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/Bearer\s/i);
    expect(code).not.toMatch(/\b(?:sk|pk|rw|ghp|xox|github_pat)[_-][A-Za-z0-9]{6,}/);

    // post_allowed can never become true, even if an attacker-supplied input tries.
    const sneaky = { ...makePost(), post_allowed: true } as unknown as OtDeadlinePostInput;
    const card = buildOtDeadlineApprovalCard(sneaky, { now: CHECK_DAY });
    expect(card.post_allowed).toBe(false);
    expect(card.public_action_status).not.toBe("posted");
  });
});
