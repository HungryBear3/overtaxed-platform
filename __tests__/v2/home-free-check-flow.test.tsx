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
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ ok: true, preview: true, result: apiResultWithLegacyField }),
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
    expect(screen.getByText(/Estimated annual overpayment found/i)).toBeTruthy();
    expect(screen.getByText("-$13,858")).toBeTruthy();
    expect(screen.queryByText(/\+-\$/)).toBeNull();
  });

});
