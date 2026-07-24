/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    expect(analytics.deadlineMapView).toHaveBeenCalledWith({
      officialCount: 16,
      openCount: 5,
      closedCount: 11,
      pendingCount: 22,
      sourceUpdated: "2026-07-23",
    });
  });

  it("tracks township selection from the reminder dropdown", () => {
    render(<DeadlinesPage />);

    fireEvent.change(screen.getByLabelText("Township"), { target: { value: "cicero" } });

    expect(analytics.deadlineTownshipSelected).toHaveBeenCalledWith({
      source: "reminder_dropdown",
      townshipSlug: "cicero",
      townshipName: "Cicero",
      status: "open",
    });
  });

  it("tracks reminder signup without sending the visitor email to analytics", async () => {
    render(<DeadlinesPage />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Township"), { target: { value: "palos" } });
    fireEvent.click(screen.getByRole("button", { name: /send me reminders/i }));

    await waitFor(() => expect(analytics.deadlineReminderSignup).toHaveBeenCalled());
    expect(analytics.deadlineReminderSignup).toHaveBeenCalledWith({
      townshipSlug: "palos",
      townshipName: "Palos",
      status: "closed",
    });
    expect(JSON.stringify((analytics.deadlineReminderSignup as jest.Mock).mock.calls)).not.toContain("owner@example.com");
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
      expect(JSON.stringify((analytics.deadlineFreeCheckStart as jest.Mock).mock.calls)).not.toContain("100 W Randolph");
    } finally {
      consoleError.mockRestore();
    }
  });
});
