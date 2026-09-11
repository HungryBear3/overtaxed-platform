/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import DeadlinesPage from "@/components/ot-design/DeadlinesPage";
import { analytics } from "@/lib/analytics/events";

jest.mock("@/lib/analytics/events", () => ({
  analytics: {
    deadlineMapView: jest.fn(),
    deadlineTownshipSelected: jest.fn(),
    deadlineReminderSignup: jest.fn(),
    deadlineFreeCheckStart: jest.fn(),
  },
}));

describe("/deadlines lead tracking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/deadlines");
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as jest.Mock;
  });

  it("tracks deadline map page views with official count context", () => {
    render(<DeadlinesPage />);

    // Was: 16 official / 5 open / 11 closed / 22 pending, and `sourceUpdated:
    // "2026-07-23"` — the day a developer last edited a constant, reported to
    // analytics as though it were a retrieval. The counts now come from the
    // canonical view model. 6a intentionally carries eight same-day verified
    // rows and leaves the other 30 pending.
    expect(analytics.deadlineMapView).toHaveBeenCalledWith({
      officialCount: 8,
      openCount: 8,
      closedCount: 0,
      pendingCount: 30,
      sourceUpdated: "2026-09-11T08:19:28.891Z",
    });
  });

  it("does not render reminder capture for informational township rows", () => {
    render(<DeadlinesPage />);
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(screen.queryByLabelText("Township")).toBeNull();
    expect(analytics.deadlineReminderSignup).not.toHaveBeenCalled();
  });

  it("tracks deadline-page free-check starts without storing the address", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<DeadlinesPage />);

      fireEvent.change(screen.getByLabelText("Cook County address"), {
        target: { value: "100 W Randolph St, Chicago IL" },
      });
      fireEvent.click(screen.getByRole("button", { name: /check eligibility/i }));

      expect(analytics.deadlineFreeCheckStart).toHaveBeenCalledWith({
        source: "deadline_bottom_cta",
        hasAddressInput: true,
      });
      expect(JSON.stringify((analytics.deadlineFreeCheckStart as jest.Mock).mock.calls)).not.toContain(
        "100 W Randolph",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
