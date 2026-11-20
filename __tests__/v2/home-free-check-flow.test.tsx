/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("fails closed when the homepage receives a contradictory outcome tuple", async () => {
    mockFetch({
      success: true,
      disclosure: CC_02,
      outcome: {
        code: "insufficient_evidence",
        headline: "We found the property, but the public record is not enough to support a conclusion",
        allowCheckout: true,
        reason: "no_assessed_value",
        showFigures: true,
        showRecordComparison: true,
      },
      subject: {
        address: "5236 N KENMORE AVE",
        city: "CHICAGO",
        zipCode: "60640",
        township: "Lake View",
        assessedTotalValue: 42500,
      },
      compCount: 3,
      avgComparableAssessedValue: 35100,
      equityRatio: 12.2,
      potentialOverpaymentPerYear: 1447,
      appealWindowStatus: { township: "Lake View", status: "open", closeDate: "2026-09-01" },
    });

    render(<HomePage />);
    fireEvent.change(screen.getAllByPlaceholderText("123 S Sample Ave, La Grange IL")[1], {
      target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }));

    await waitFor(() => expect(screen.getByText(/Your free check · 5236 N KENMORE AVE/i)).toBeTruthy());
    const panel = document.querySelector(".ot-check-result");
    expect(panel).not.toBeNull();
    const result = within(panel as HTMLElement);
    expect(result.getByText("We could not complete this check.")).toBeTruthy();
    expect(result.queryByText("$42,500")).toBeNull();
    expect(result.queryByText("$35,100")).toBeNull();
    expect(result.queryByText(/DIY Appeal Packet \$69/)).toBeNull();
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

  describe("input mode scoping", () => {
    const HERO_ADDRESS = "123 S Sample Ave, La Grange IL";
    const STALE_PIN = "16-01-216-001-0000";

    function heroForm() {
      return screen.getAllByPlaceholderText(HERO_ADDRESS)[1].closest("form") as HTMLFormElement;
    }

    function postedBody(fetchMock: jest.Mock, call = 0) {
      return JSON.parse(fetchMock.mock.calls[call][1].body as string);
    }

    function typeStalePinThenSwitchBack(form: HTMLFormElement) {
      fireEvent.click(within(form).getByRole("button", { name: /I have my PIN instead/i }));
      fireEvent.change(within(form).getByPlaceholderText(STALE_PIN), { target: { value: "16012160010000" } });
      fireEvent.click(within(form).getByRole("button", { name: /Look up by address instead/i }));
    }

    it("address mode never submits a PIN typed earlier in PIN mode", async () => {
      const fetchMock = mockFetch({ error: "stop" }, false);
      render(<HomePage />);
      const form = heroForm();

      typeStalePinThenSwitchBack(form);
      fireEvent.change(within(form).getByPlaceholderText(HERO_ADDRESS), {
        target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
      });
      fireEvent.click(within(form).getByRole("button", { name: /check my assessment/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = postedBody(fetchMock);
      expect(body.mode).toBe("address");
      expect(body.address).toBe("5236 N Kenmore Ave, Chicago IL 60640");
      expect(body).not.toHaveProperty("pin");
      expect(body).not.toHaveProperty("selectedPin");
    });

    it("PIN mode omits address and city", async () => {
      const fetchMock = mockFetch({ error: "stop" }, false);
      render(<HomePage />);
      const form = heroForm();

      fireEvent.change(within(form).getByPlaceholderText(HERO_ADDRESS), {
        target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
      });
      fireEvent.click(within(form).getByRole("button", { name: /I have my PIN instead/i }));
      fireEvent.change(within(form).getByPlaceholderText(STALE_PIN), { target: { value: "16012160010000" } });
      fireEvent.click(within(form).getByRole("button", { name: /check my assessment/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = postedBody(fetchMock);
      expect(body.mode).toBe("pin");
      expect(body.pin).toBe(STALE_PIN);
      expect(body).not.toHaveProperty("address");
      expect(body).not.toHaveProperty("city");
      expect(body).not.toHaveProperty("selectedPin");
    });

    it("a parcel picked from the selection step still carries no stale PIN", async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          json: async () => ({
            code: "ADDRESS_AMBIGUOUS",
            candidateCount: 2,
            candidates: [
              { pin: "14-08-123-456-1001", address: "5236 N KENMORE AVE", city: "CHICAGO", zipCode: "60640", unit: "1" },
              { pin: "14-08-123-456-1002", address: "5236 N KENMORE AVE", city: "CHICAGO", zipCode: "60640", unit: "2" },
            ],
          }),
        })
        .mockResolvedValue({ ok: false, json: async () => ({ error: "stop" }) });
      Object.defineProperty(global, "fetch", { value: fetchMock, writable: true });
      render(<HomePage />);
      const form = heroForm();

      typeStalePinThenSwitchBack(form);
      fireEvent.change(within(form).getByPlaceholderText(HERO_ADDRESS), {
        target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
      });
      fireEvent.click(within(form).getByRole("button", { name: /check my assessment/i }));
      const pick = await within(form).findByRole("button", { name: /Unit 2/ });
      fireEvent.click(pick);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const body = postedBody(fetchMock, 1);
      expect(body.mode).toBe("address");
      expect(body.selectedPin).toBe("14081234561002");
      expect(body).not.toHaveProperty("pin");
    });

    it("toggling input mode clears a stale parcel selection list", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          code: "ADDRESS_AMBIGUOUS",
          candidates: [
            { pin: "14-08-123-456-1001", address: "5236 N KENMORE AVE", city: "CHICAGO", zipCode: "60640", unit: "1" },
            { pin: "14-08-123-456-1002", address: "5236 N KENMORE AVE", city: "CHICAGO", zipCode: "60640", unit: "2" },
          ],
        }),
      });
      Object.defineProperty(global, "fetch", { value: fetchMock, writable: true });
      render(<HomePage />);
      const form = heroForm();

      fireEvent.change(within(form).getByPlaceholderText(HERO_ADDRESS), {
        target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
      });
      fireEvent.click(within(form).getByRole("button", { name: /check my assessment/i }));
      await within(form).findByText(/More than one Cook County property matches/i);

      fireEvent.click(within(form).getByRole("button", { name: /I have my PIN instead/i }));
      expect(within(form).queryByText(/More than one Cook County property matches/i)).toBeNull();
      expect(within(form).queryByRole("button", { name: /Unit 1/ })).toBeNull();

      fireEvent.click(within(form).getByRole("button", { name: /Look up by address instead/i }));
      expect(within(form).queryByText(/More than one Cook County property matches/i)).toBeNull();
    });

    it.each([
      [
        "the route's outage sentence",
        {
          error:
            "We could not reach the Cook County records service just now. Please try again in a few minutes — this is on our side, not your address.",
          code: "ADDRESS_LOOKUP_UNAVAILABLE",
          retryable: true,
        },
        /We could not reach the Cook County records service just now\..*this is on our side, not your address\./,
      ],
      [
        "the client fallback when the 503 body is unreadable",
        null,
        /We couldn't reach the Cook County records service\. Please try again shortly — this is on our side\./,
      ],
    ])("a 503 renders %s and never blames the address", async (_label, payload, expected) => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => {
          if (payload === null) throw new Error("unreadable");
          return payload;
        },
      });
      Object.defineProperty(global, "fetch", { value: fetchMock, writable: true });
      render(<HomePage />);
      const form = heroForm();

      fireEvent.change(within(form).getByPlaceholderText(HERO_ADDRESS), {
        target: { value: "5236 N Kenmore Ave, Chicago IL 60640" },
      });
      fireEvent.click(within(form).getByRole("button", { name: /check my assessment/i }));

      const alert = await within(form).findByRole("alert");
      expect(alert.textContent).toMatch(expected);
      expect(alert.textContent).not.toMatch(/couldn't find a Cook County property/i);
      expect(alert.textContent).not.toMatch(/Try your 14-digit PIN/i);
      expect(screen.queryByText(/Sample data — not your submitted address/i)).toBeNull();
    });
  });

});
