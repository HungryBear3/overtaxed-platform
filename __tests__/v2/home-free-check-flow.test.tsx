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

    await waitFor(() => expect(screen.getByText(/Your free check · Sample result/i)).toBeTruthy());
    expect(screen.getAllByText(/12\.1%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Lyons Township/).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/check",
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

    await waitFor(() => expect(screen.getByText(/Your free check · Sample result/i)).toBeTruthy());
    expect(screen.getByText(/Review filing options/)).toBeTruthy();
  });
});
