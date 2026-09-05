/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import { FreeCheckFormWrapper } from "@/components/check/FreeCheckFormWrapper"
import HomePage from "@/components/ot-design/HomePage"
import { CC_02 } from "@/lib/copy/canonical"
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract"

/**
 * Runtime proof that the funnel counts user actions and authoritative results,
 * one for one. These drive the real components against a stubbed route and
 * observe the real `window.gtag`, so an extra render, a retried request, a
 * restored session, or an error path that fabricates a completion shows up here
 * as a count that is not 1.
 */

const SESSION_KEY = "freeCheckResult_v2"

function supportiveResponse() {
  return {
    success: true,
    subject: {
      pin: "16012160010000",
      address: "100 W Randolph St",
      city: "Chicago",
      zipCode: "60601",
      township: "Stickney",
      neighborhoodCode: "071",
      taxYear: 2025,
      assessedTotalValue: 40000,
      marketValue: 400000,
    },
    compCount: 6,
    comps: [],
    avgComparableAssessedValue: 30000,
    equityRatio: 0.1,
    targetEquityRatio: 0.1,
    avgCompEquityRatio: 0.08,
    assessmentGap: 10000,
    potentialOverpaymentPerYear: null,
    potentialOverpayment3Year: null,
    appealArgumentText: null,
    appealWindowStatus: {
      township: "Stickney",
      status: "open",
      openDate: "2026-09-01",
      closeDate: "2026-10-01",
      filingUrl: "https://example.gov",
      note: null,
    },
    propertyCharacteristics: null,
    source: "cook-county",
    disclosure: CC_02,
    outcome: canonicalFreeCheckOutcome("supportive", null),
  }
}

function insufficientResponse() {
  return {
    ...supportiveResponse(),
    outcome: canonicalFreeCheckOutcome("insufficient_evidence", "no_comparables"),
  }
}

describe("free-check funnel across both surfaces", () => {
  let gtag: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    window.sessionStorage.clear()
    window.localStorage.clear()
    window.history.replaceState({}, "", "/check")
    gtag = jest.fn()
    window.gtag = gtag
  })

  afterEach(() => {
    delete (window as { gtag?: unknown }).gtag
  })

  function countOf(name: string): number {
    return gtag.mock.calls.filter((call) => call[0] === "event" && call[1] === name).length
  }

  function paramsOf(name: string): Record<string, unknown> {
    const call = gtag.mock.calls.find((c) => c[0] === "event" && c[1] === name)
    return (call?.[2] ?? {}) as Record<string, unknown>
  }

  function stubRoute(response: unknown, init: { ok?: boolean; status?: number } = {}) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => response,
    }) as unknown as typeof fetch
  }

  describe("/check page", () => {
    function submitPin(value = "16012160010000") {
      fireEvent.change(screen.getByLabelText(/Cook County PIN/i), { target: { value } })
      fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }))
    }

    it("counts one start and one completion for one successful check", async () => {
      stubRoute(supportiveResponse())
      render(<FreeCheckFormWrapper />)

      submitPin()

      await waitFor(() => expect(countOf("free_check_completed")).toBe(1))
      expect(countOf("free_check_started")).toBe(1)
      expect(paramsOf("free_check_started")).toMatchObject({
        surface: "check_page",
        input_mode: "pin",
      })
      expect(paramsOf("free_check_completed")).toMatchObject({
        surface: "check_page",
        outcome_code: "supportive",
        allow_checkout: true,
        window_status: "open",
      })
    })

    it("binds the qualified event to the route's outcome, not to the figures on screen", async () => {
      stubRoute(insufficientResponse())
      render(<FreeCheckFormWrapper />)

      submitPin()

      await waitFor(() => expect(countOf("free_check_completed")).toBe(1))
      expect(countOf("free_check_qualified")).toBe(0)
      expect(paramsOf("free_check_completed")).toMatchObject({
        outcome_code: "insufficient_evidence",
        outcome_reason: "no_comparables",
        qualified: false,
      })
    })

    it("sends nothing when client-side validation rejects the form", () => {
      stubRoute(supportiveResponse())
      render(<FreeCheckFormWrapper />)

      fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }))

      expect(global.fetch).not.toHaveBeenCalled()
      expect(gtag).not.toHaveBeenCalled()
    })

    it("sends no completion when the records service is unavailable", async () => {
      stubRoute({ error: "records service down" }, { ok: false, status: 503 })
      render(<FreeCheckFormWrapper />)

      submitPin()

      await waitFor(() => expect(countOf("free_check_started")).toBe(1))
      await screen.findByRole("status")
      expect(countOf("free_check_completed")).toBe(0)
      expect(countOf("free_check_qualified")).toBe(0)
    })

    it("sends no completion when the request is aborted", async () => {
      const abort = Object.assign(new Error("aborted"), { name: "AbortError" })
      global.fetch = jest.fn().mockRejectedValue(abort) as unknown as typeof fetch
      render(<FreeCheckFormWrapper />)

      submitPin()

      await waitFor(() => expect(countOf("free_check_started")).toBe(1))
      await screen.findByRole("alert")
      expect(countOf("free_check_completed")).toBe(0)
    })

    it("does not count a second start when the reader picks a parcel from the ambiguity list", async () => {
      const ambiguous = {
        code: "ADDRESS_AMBIGUOUS",
        candidateCount: 2,
        candidates: [
          { pin: "16012160010000", address: "100 W Randolph St", city: "Chicago", zipCode: "60601", unit: "1" },
          { pin: "16012160020000", address: "100 W Randolph St", city: "Chicago", zipCode: "60601", unit: "2" },
        ],
      }
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ambiguous })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => supportiveResponse() }) as unknown as typeof fetch

      render(<FreeCheckFormWrapper />)

      fireEvent.click(screen.getByRole("button", { name: /look up by address/i }))
      fireEvent.change(screen.getByLabelText(/Street address/i), {
        target: { value: "100 W Randolph St" },
      })
      fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }))

      await waitFor(() => expect(countOf("free_check_started")).toBe(1))
      const candidate = await screen.findByRole("button", { name: /Unit 1/ })
      fireEvent.click(candidate)

      await waitFor(() => expect(countOf("free_check_completed")).toBe(1))
      expect(countOf("free_check_started")).toBe(1)
    })

    it("emits nothing when a cached result is rehydrated from sessionStorage", async () => {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(supportiveResponse()))
      stubRoute(supportiveResponse())

      render(<FreeCheckFormWrapper />)

      // The restored result renders — this is the rehydration path, not a no-op.
      await screen.findByText(CC_02)
      expect(global.fetch).not.toHaveBeenCalled()
      expect(gtag).not.toHaveBeenCalled()
    })

    it("does not replay a completion when the surface re-renders", async () => {
      stubRoute(supportiveResponse())
      const { rerender } = render(<FreeCheckFormWrapper />)

      submitPin()
      await waitFor(() => expect(countOf("free_check_completed")).toBe(1))

      rerender(<FreeCheckFormWrapper />)

      expect(countOf("free_check_completed")).toBe(1)
      expect(countOf("free_check_qualified")).toBe(1)
    })

    it("carries no stored UTM value into any payload, however hostile the stored attribution", async () => {
      // Seeded the way a crafted inbound link would seed it: these are URL
      // query values, so nothing upstream constrains their shape or length,
      // and `getStoredUTMParams` returns them unvalidated.
      const hostile = {
        utm_source: "owner@example.com",
        utm_medium: "100 W Randolph St Apt 4B",
        utm_campaign: "16-01-216-001-0000",
        utm_term: "Jane Q Homeowner",
        utm_content: "case-778341-order-99123",
      }
      window.localStorage.setItem("utm_params", JSON.stringify(hostile))
      window.localStorage.setItem("utm_timestamp", String(Date.now()))
      stubRoute(supportiveResponse())
      render(<FreeCheckFormWrapper />)

      submitPin()

      await waitFor(() => expect(countOf("free_check_qualified")).toBe(1))
      const serialized = JSON.stringify(gtag.mock.calls)
      for (const value of Object.values(hostile)) {
        expect(serialized).not.toContain(value)
      }
      expect(serialized).not.toContain("utm_")
    })

    it("carries no identifying value from the checked property into any payload", async () => {
      stubRoute(supportiveResponse())
      render(<FreeCheckFormWrapper />)

      submitPin()

      await waitFor(() => expect(countOf("free_check_completed")).toBe(1))
      const serialized = JSON.stringify(gtag.mock.calls)
      for (const forbidden of [
        "16012160010000",
        "100 W Randolph",
        "Chicago",
        "60601",
        "Stickney",
        "071",
      ]) {
        expect(serialized).not.toContain(forbidden)
      }
    })
  })

  describe("homepage hero", () => {
    beforeEach(() => {
      window.history.replaceState({}, "", "/")
    })

    /**
     * The homepage mounts the hero card more than once (the sticky rail repeats
     * it), so the interaction is scoped to a single form. Submitting one card
     * must produce one start — a second instance sitting on the page is exactly
     * the kind of thing that would otherwise double the count.
     */
    function submitHeroAddress() {
      const card = document.querySelector("form.ot-check-card") as HTMLFormElement
      const input = within(card).getByPlaceholderText(/La Grange IL/i)
      fireEvent.change(input, { target: { value: "100 W Randolph St" } })
      fireEvent.click(within(card).getByRole("button", { name: /check my assessment/i }))
    }

    it("counts one start and one completion for one hero check", async () => {
      stubRoute(supportiveResponse())
      render(<HomePage />)

      submitHeroAddress()

      await waitFor(() => expect(countOf("free_check_completed")).toBe(1))
      expect(countOf("free_check_started")).toBe(1)
      expect(paramsOf("free_check_started")).toMatchObject({
        surface: "home_hero",
        input_mode: "address",
      })
      expect(countOf("free_check_qualified")).toBe(1)
      expect(paramsOf("free_check_qualified")).toMatchObject({
        surface: "home_hero",
        outcome_code: "supportive",
        window_status: "open",
      })
    })

    /**
     * The sticky address bar is a third entry point into the same route. Its
     * result is dispatched to the homepage listener, which renders it in the
     * hero card — so an uninstrumented sticky bar means a check the reader
     * completed and saw reported as no completion at all, and instrumenting the
     * listener instead of the bar would double-count the hero card's own checks.
     */
    function submitStickyAddress() {
      const input = screen.getByLabelText(/Property address/i)
      const card = input.closest("form") as HTMLFormElement
      fireEvent.change(input, { target: { value: "100 W Randolph St" } })
      fireEvent.click(within(card).getByRole("button", { name: /check my assessment/i, hidden: true }))
    }

    it("counts one start and one completion for a sticky-bar check", async () => {
      stubRoute(supportiveResponse())
      render(<HomePage />)

      submitStickyAddress()

      await waitFor(() => expect(countOf("free_check_completed")).toBe(1))
      expect(countOf("free_check_started")).toBe(1)
      expect(paramsOf("free_check_started")).toMatchObject({
        surface: "home_hero",
        input_mode: "address",
      })
      expect(countOf("free_check_qualified")).toBe(1)
    })

    it("does not double-count when the sticky-bar result reaches the hero listener", async () => {
      stubRoute(supportiveResponse())
      render(<HomePage />)

      submitStickyAddress()

      await waitFor(() => expect(countOf("free_check_completed")).toBe(1))
      // Let the dispatched result settle through the homepage listener.
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
      expect(countOf("free_check_completed")).toBe(1)
      expect(countOf("free_check_started")).toBe(1)
    })

    it("sends no completion when a sticky-bar lookup fails", async () => {
      stubRoute({ error: "not found" }, { ok: false, status: 404 })
      render(<HomePage />)

      submitStickyAddress()

      await waitFor(() => expect(countOf("free_check_started")).toBe(1))
      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      expect(countOf("free_check_completed")).toBe(0)
      expect(countOf("free_check_qualified")).toBe(0)
    })

    it("sends no completion when the hero lookup fails", async () => {
      stubRoute({ error: "not found" }, { ok: false, status: 404 })
      render(<HomePage />)

      submitHeroAddress()

      await waitFor(() => expect(countOf("free_check_started")).toBe(1))
      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      expect(countOf("free_check_completed")).toBe(0)
      expect(countOf("free_check_qualified")).toBe(0)
    })
  })
})
