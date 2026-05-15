/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HomePage from "@/components/ot-design/HomePage";

const apiResultWithLegacyField = {
  address: "Sample result — not your submitted address",
  township: "Lyons",
  windowStatus: "open",
  windowCloses: "Lyons Township appeal window open through Jun 9, 2026",
  windowDaysRemaining: 27,
  yourAssessed: 42500,
  compsAvg: 35100,
  equityRatio: 12.1,
  overpayPerYear: 1420,
  overpay3Year: 4260,
  comps: 3,
};

describe("OT home free-check flow", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, "scrollTo", { value: jest.fn(), writable: true });
  });

  function mockPreviewFetch() {
    return mockFetch({ ok: true, preview: true, result: apiResultWithLegacyField });
  }

  function mockFetch(payload: unknown, ok = true) {
    const fetchMock = jest.fn().mockResolvedValue({
      ok,
      json: async () => payload,
    });
    Object.defineProperty(global, "fetch", { value: fetchMock, writable: true });
    return fetchMock;
  }

  it("submits the hero form and renders the Lyons sample without crashing if API returns legacy equityRatio", async () => {
    const fetchMock = mockPreviewFetch();

    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText("123 Main St, Chicago, IL 60601"), {
      target: { value: "1234 N State St, Chicago IL 60610" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Sample data — not your submitted address · Sample result/i)).toBeTruthy());
    expect(screen.getAllByText(/12\.1%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Lyons Township/).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/free-check",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sticky quick check dispatches the same visible result panel", async () => {
    mockPreviewFetch();

    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText("123 N Main St, Chicago IL"), {
      target: { value: "1234 N State St, Chicago IL 60610" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Sample data — not your submitted address · Sample result/i)).toBeTruthy());
    expect(screen.getByText(/DIY \$69/)).toBeTruthy();
    expect(screen.getByText(/Done-For-You \$97/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Contingency$/ })).toBeTruthy();
  });

  it("renders real fair-assessment results without sample copy or double signs", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        source: "Cook County Open Data - Parcel Sales",
        subject: {
          pin: "17-09-434-020-8064",
          address: "100 W RANDOLPH ST",
          city: "CHICAGO",
          zipCode: "60601",
          township: "South Chicago",
          assessedTotalValue: 22538,
        },
        compCount: 3,
        avgComparableAssessedValue: 36396,
        equityRatio: 10,
        potentialOverpaymentPerYear: null,
        potentialOverpayment3Year: null,
        appealWindowStatus: {
          township: "South Chicago",
          status: "closed",
          closeDate: "2026-04-01",
        },
      }),
    });
    Object.defineProperty(global, "fetch", { value: fetchMock, writable: true });

    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText("123 Main St, Chicago, IL 60601"), {
      target: { value: "100 W Randolph St, Chicago IL 60601" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Your free check · 100 W RANDOLPH ST/i)).toBeTruthy());
    expect(screen.queryByText(/Sample data — not your submitted address/i)).toBeNull();
    expect(screen.getByText(/No overpayment flagged/i)).toBeTruthy();
    expect(screen.queryByText(/Estimated annual overpayment found/i)).toBeNull();
    expect(screen.getByText("-$13,858")).toBeTruthy();
    expect(screen.queryByText(/\+-\$/)).toBeNull();
    expect(screen.queryByText(/DIY \$69/)).toBeNull();
    expect(screen.queryByText(/Done-For-You \$97/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^Contingency$/ })).toBeNull();
  });

  it("shows API errors instead of falling back to the Lyons sample", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "No Cook County property found for this address. Try your 14-digit PIN instead." }),
    });
    Object.defineProperty(global, "fetch", { value: fetchMock, writable: true });

    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText("123 Main St, Chicago, IL 60601"), {
      target: { value: "asdfqwer not a real address" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/No Cook County property found/i)).toBeTruthy());
    expect(screen.queryByText(/Sample data — not your submitted address/i)).toBeNull();
    expect(screen.queryByText(/Your free check · Sample result/i)).toBeNull();
    expect(screen.queryByText(/DIY \$69/)).toBeNull();
  });

  it("does not fabricate a deadline when the API appeal window is unknown", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        source: "Cook County Open Data - Parcel Sales",
        subject: {
          pin: "14-08-123-456-0000",
          address: "5236 N KENMORE AVE",
          city: "CHICAGO",
          zipCode: "60640",
          township: "Lake View",
          assessedTotalValue: 37500,
        },
        compCount: 3,
        avgComparableAssessedValue: 30692,
        equityRatio: 12.2,
        potentialOverpaymentPerYear: 1447,
        potentialOverpayment3Year: 4341,
        appealWindowStatus: {
          township: "Lake View",
          status: "unknown",
          openDate: null,
          closeDate: null,
          note: "Check the assessor's site for your township's exact appeal dates.",
        },
      }),
    });
    Object.defineProperty(global, "fetch", { value: fetchMock, writable: true });

    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText("123 Main St, Chicago, IL 60601"), {
      target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Your free check · 5236 N KENMORE AVE/i)).toBeTruthy());
    expect(screen.getByText(/Check dates/i)).toBeTruthy();
    expect(screen.getAllByText(/Exact appeal dates unavailable/i)).toHaveLength(1);
    expect(screen.queryByText(/Window closes Jun 9, 2026/i)).toBeNull();
    expect(screen.queryByText(/Lake View window closes/i)).toBeNull();
  });

  it("renders future-cycle township windows without green/open urgency", async () => {
    mockFetch({
      success: true,
      subject: {
        address: "5236 N KENMORE AVE",
        city: "CHICAGO",
        zipCode: "60640",
        township: "Lake View",
        assessedTotalValue: 37500,
      },
      compCount: 3,
      avgComparableAssessedValue: 30692,
      equityRatio: 12.2,
      potentialOverpaymentPerYear: 1447,
      potentialOverpayment3Year: 4341,
      appealWindowStatus: {
        township: "Lake View",
        status: "future_cycle",
        openDate: "2028-05-08",
        closeDate: "2028-06-12",
      },
      source: "Cook County Open Data - Parcel Sales",
    });

    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText("123 Main St, Chicago, IL 60601"), {
      target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Your free check · 5236 N KENMORE AVE/i)).toBeTruthy());
    expect(screen.getByText(/Future cycle/i)).toBeTruthy();
    expect(screen.getByText(/Opens May 8, 2028/i)).toBeTruthy();
    expect(screen.getByText(/Lake View window closes Jun 12, 2028/i)).toBeTruthy();
    expect(screen.queryByText(/days until close/i)).toBeNull();
    expect(screen.queryByText(/Exact appeal dates unavailable/i)).toBeNull();
  });

});
