import {
  captureUTMParams,
  getStoredUTMParams,
} from "@/lib/analytics/utm-tracking";
import { analytics } from "@/lib/analytics/events";
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract";

describe("township campaign attribution", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("captures both campaign and CTA placement after client-side navigation", () => {
    window.history.pushState(
      {},
      "",
      "/?utm_source=township_deadline_page&utm_medium=organic&utm_campaign=ot_2026_stickney_deadline&utm_content=body#hero-check",
    );

    captureUTMParams();

    expect(getStoredUTMParams()).toMatchObject({
      utm_source: "township_deadline_page",
      utm_medium: "organic",
      utm_campaign: "ot_2026_stickney_deadline",
      utm_content: "body",
    });
  });

  /**
   * This used to assert that `free_check_qualified` carried `utm_campaign` and
   * `utm_content`. It no longer does, and the assertion is dropped rather than
   * relaxed: stored UTM values are unvalidated URL input, and this event is the
   * one that says a specific identified parcel qualified. Campaign attribution
   * for the funnel is read from the session's own page_view instead, which GA4
   * already records against a sanitized page_location.
   *
   * The PII-negative assertions below are unchanged and extended, not weakened.
   */
  it("emits a qualified result with no campaign attribution, address, PIN, township, or savings", () => {
    window.history.replaceState(
      {},
      "",
      "/?utm_campaign=ot_2026_stickney_deadline&utm_content=body",
    );
    captureUTMParams();
    expect(getStoredUTMParams()).toMatchObject({
      utm_campaign: "ot_2026_stickney_deadline",
    });
    window.gtag = jest.fn();

    // Qualification comes from the route's evaluated outcome. It used to be
    // inferred here from a dollar figure the route no longer computes on any
    // path, and it shipped the township name as a free-form string.
    analytics.freeCheckCompleted({
      surface: "home_hero",
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: false,
    });

    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "free_check_qualified",
      expect.objectContaining({
        surface: "home_hero",
        outcome_code: "supportive",
        window_status: "open",
      }),
    );

    const qualified = (window.gtag as jest.Mock).mock.calls.find(
      (call) => call[1] === "free_check_qualified",
    );
    for (const forbidden of ["address", "pin", "township", "savings_band", "estimatedAnnualSavings"]) {
      expect(qualified[2]).not.toHaveProperty(forbidden);
    }
    // Stored attribution is available here — it is simply not attached.
    for (const key of Object.keys(qualified[2] as Record<string, unknown>)) {
      expect(key).not.toMatch(/^utm_/);
    }
    const serialized = JSON.stringify((window.gtag as jest.Mock).mock.calls);
    expect(serialized).not.toContain("Stickney");
    expect(serialized).not.toContain("ot_2026_stickney_deadline");
  });
});
