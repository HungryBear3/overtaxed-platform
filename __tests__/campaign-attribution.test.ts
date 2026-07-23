import {
  captureUTMParams,
  getStoredUTMParams,
} from "@/lib/analytics/utm-tracking";
import { analytics } from "@/lib/analytics/events";

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

  it("emits qualified-result analytics without address, PIN, or exact savings", () => {
    window.history.replaceState(
      {},
      "",
      "/?utm_campaign=ot_2026_stickney_deadline&utm_content=body",
    );
    captureUTMParams();
    window.gtag = jest.fn();

    analytics.freeCheckQualified({
      township: "Stickney",
      windowStatus: "open",
      estimatedAnnualSavings: 1420,
      preview: false,
    });

    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "free_check_qualified",
      expect.objectContaining({
        township: "Stickney",
        window_status: "open",
        savings_band: "1000_1999",
        utm_campaign: "ot_2026_stickney_deadline",
        utm_content: "body",
      }),
    );
    const payload = (window.gtag as jest.Mock).mock.calls[0][2];
    expect(payload).not.toHaveProperty("address");
    expect(payload).not.toHaveProperty("pin");
    expect(payload).not.toHaveProperty("estimatedAnnualSavings");
  });
});
