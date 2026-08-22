/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HomePage from "@/components/ot-design/HomePage";
import { CC_02 } from "@/lib/copy/canonical";

const apiResultWithLegacyField = {
  address: "Sample result — not your submitted address",
  township: "Cicero",
  windowStatus: "open",
  windowCloses: "Cicero Township appeal window open through July 31, 2026",
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

  it("submits the hero form and renders the Cicero sample without crashing if API returns legacy equityRatio", async () => {
    const fetchMock = mockPreviewFetch();

    render(<HomePage />);

    fireEvent.change(screen.getAllByPlaceholderText("123 S Sample Ave, La Grange IL")[1], {
      target: { value: "1234 N State St, Chicago IL 60610" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Sample data — not your submitted address · Sample result/i)).toBeTruthy());
    expect(screen.getAllByText(/12\.1%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Cicero Township/).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/free-check",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sticky quick check dispatches the same visible result panel", async () => {
    mockPreviewFetch();

    render(<HomePage />);

    fireEvent.change(screen.getAllByPlaceholderText("123 S Sample Ave, La Grange IL")[0], {
      target: { value: "1234 N State St, Chicago IL 60610" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Sample data — not your submitted address · Sample result/i)).toBeTruthy());
    // Was: assert the DIY CTA renders. The offer is now gated solely on the
    // route's `outcome.allowCheckout`, which a preview never sets — a sample
    // that can be checked out from is a sample that sells. The Done-For-You and
    // Contingency links stay gone in every state: presenting a held product as
    // a choice is still offering it.
    expect(screen.queryByText(/DIY Appeal Packet \$69/)).toBeNull();
    expect(screen.getByText(/We are not offering a filing package from this check\./)).toBeTruthy();
    expect(screen.queryByText(/Done-For-You/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^Contingency$/ })).toBeNull();
  });

  it("offers the packet only when the route says checkout is allowed", async () => {
    // The mirror of the case above: the same panel, the same client code, with
    // `allowCheckout` true. Without this, "no CTA" is also satisfied by a panel
    // that can no longer render one at all.
    mockFetch({
      success: true,
      disclosure: CC_02,
      outcome: {
        code: "supportive",
        headline: "Appears supportive of closer review",
        allowCheckout: true,
        reason: null,
        showFigures: true,
        showRecordComparison: true,
      },
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
        status: "open",
        openDate: "2026-05-28",
        closeDate: "2026-07-13",
      },
      source: "Cook County Open Data - Parcel Sales",
    });

    render(<HomePage />);

    fireEvent.change(screen.getAllByPlaceholderText("123 S Sample Ave, La Grange IL")[1], {
      target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Your free check · 5236 N KENMORE AVE/i)).toBeTruthy());
    expect(screen.getByText(/DIY Appeal Packet \$69/)).toBeTruthy();
    expect(screen.queryByText(/Done-For-You/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^Contingency$/ })).toBeNull();
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
        // The route's single evaluated outcome. The panel renders this decision
        // rather than re-deriving one from the figures, which is what used to
        // let the same property be told it had a finding, be shown no figures,
        // and be offered checkout in one render.
        outcome: {
          code: "not_supportive",
          headline: "Does not presently appear supportive",
          allowCheckout: false,
          reason: "below_evidence_threshold",
          showFigures: true,
          showRecordComparison: true,
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

    fireEvent.change(screen.getAllByPlaceholderText("123 S Sample Ave, La Grange IL")[1], {
      target: { value: "100 W Randolph St, Chicago IL 60601" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Your free check · 100 W RANDOLPH ST/i)).toBeTruthy());
    expect(screen.queryByText(/Sample data — not your submitted address/i)).toBeNull();
    // Was "No overpayment flagged" — copy this component composed itself. The
    // headline is now CC-04 byte-exact, chosen by the route.
    expect(screen.getByText("Does not presently appear supportive")).toBeTruthy();
    expect(screen.queryByText(/No overpayment flagged/i)).toBeNull();
    expect(screen.queryByText(/Estimated annual overpayment found/i)).toBeNull();
    expect(screen.getByText("-$13,858")).toBeTruthy();
    expect(screen.queryByText(/\+-\$/)).toBeNull();
    expect(screen.queryByText(/DIY Appeal Packet \$69/)).toBeNull();
    expect(screen.queryByText(/Done-For-You/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^Contingency$/ })).toBeNull();
  });

  it("shows API errors instead of falling back to the sample", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "No Cook County property found for this address. Try your 14-digit PIN instead." }),
    });
    Object.defineProperty(global, "fetch", { value: fetchMock, writable: true });

    render(<HomePage />);

    fireEvent.change(screen.getAllByPlaceholderText("123 S Sample Ave, La Grange IL")[1], {
      target: { value: "asdfqwer not a real address" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/No Cook County property found/i)).toBeTruthy());
    expect(screen.queryByText(/Sample data — not your submitted address/i)).toBeNull();
    expect(screen.queryByText(/Your free check · Sample result/i)).toBeNull();
    expect(screen.queryByText(/DIY Appeal Packet \$69/)).toBeNull();
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

    fireEvent.change(screen.getAllByPlaceholderText("123 S Sample Ave, La Grange IL")[1], {
      target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Your free check · 5236 N KENMORE AVE/i)).toBeTruthy());
    // Was "Check dates" / "Exact appeal dates unavailable". The deadline strip
    // now says which of the two it is: no date was verified, so confirm with
    // the authority. Nothing here implies the county has not published one.
    expect(screen.getByText(/No verified date/i)).toBeTruthy();
    expect(screen.getByText(/Confirm with the county/i)).toBeTruthy();
    expect(screen.queryByText(/Window closes Jul 31, 2026/i)).toBeNull();
    expect(screen.queryByText(/Lake View window closes/i)).toBeNull();
    expect(screen.queryByText(/until close/i)).toBeNull();
    expect(screen.queryByText(/DIY Appeal Packet \$69/)).toBeNull();
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
        // Was `future_cycle`, a status that meant both "the county has not
        // opened this window yet" and "we have no row for this township". The
        // union splits them: `upcoming` is a fact about the calendar,
        // `unknown` is a fact about us.
        township: "Lake View",
        status: "upcoming",
        openDate: "2028-05-08",
        closeDate: "2028-06-12",
      },
      source: "Cook County Open Data - Parcel Sales",
    });

    render(<HomePage />);

    fireEvent.change(screen.getAllByPlaceholderText("123 S Sample Ave, La Grange IL")[1], {
      target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Your free check · 5236 N KENMORE AVE/i)).toBeTruthy());
    expect(screen.getByText(/Not open yet/i)).toBeTruthy();
    expect(screen.queryByText(/until close/i)).toBeNull();
    expect(screen.queryByText(/No verified date/i)).toBeNull();
    // "Upcoming" is not "open", however close it is: no countdown and no offer.
    expect(screen.queryByText(/DIY Appeal Packet \$69/)).toBeNull();
  });

});
