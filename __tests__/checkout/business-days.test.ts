/**
 * The Chicago three-business-day checkout cutoff.
 *
 * Every case here is an instant or a date the rule has to get exactly right:
 * the two daylight-saving transitions, the last millisecond of a Chicago day,
 * weekends spanning the cutoff, and every way a close date can be absent or
 * malformed. The rule fails closed on all of them.
 */
import {
  CHICAGO_TIME_ZONE,
  MIN_BUSINESS_DAYS_BEFORE_CLOSE,
  NO_HOLIDAY_AUTHORITY,
  businessDaysBetween,
  chicagoCalendarDay,
  evaluateCheckoutBusinessDayCutoff,
  isChicagoBusinessDay,
  parseCalendarDay,
  stripeSessionExpiry,
} from "@/lib/checkout/business-days";

describe("Chicago calendar day", () => {
  it("uses the county time zone, not the host zone", () => {
    expect(CHICAGO_TIME_ZONE).toBe("America/Chicago");
  });

  it("treats the last millisecond of a Chicago day as that day", () => {
    // 2026-06-10T23:59:59.999 Chicago is 2026-06-11T04:59:59.999Z (CDT, UTC-5).
    expect(chicagoCalendarDay(Date.parse("2026-06-11T04:59:59.999Z"))).toBe(
      "2026-06-10",
    );
    expect(chicagoCalendarDay(Date.parse("2026-06-11T05:00:00.000Z"))).toBe(
      "2026-06-11",
    );
  });

  it("is not the UTC day for a late-evening Chicago instant", () => {
    // The old close-date clamp used a UTC midnight. This is the discrepancy.
    const instant = Date.parse("2026-06-11T03:30:00.000Z");
    expect(new Date(instant).toISOString().slice(0, 10)).toBe("2026-06-11");
    expect(chicagoCalendarDay(instant)).toBe("2026-06-10");
  });

  it("handles the spring-forward transition", () => {
    // 2026-03-08 02:00 CST becomes 03:00 CDT.
    expect(chicagoCalendarDay(Date.parse("2026-03-08T07:59:00.000Z"))).toBe(
      "2026-03-08",
    );
    expect(chicagoCalendarDay(Date.parse("2026-03-08T08:00:00.000Z"))).toBe(
      "2026-03-08",
    );
    // From here Chicago is CDT (UTC-5), so its midnight is 05:00Z, not 06:00Z.
    // A rule that assumed a fixed offset would put these two on the wrong day.
    expect(chicagoCalendarDay(Date.parse("2026-03-09T04:59:00.000Z"))).toBe(
      "2026-03-08",
    );
    expect(chicagoCalendarDay(Date.parse("2026-03-09T05:00:00.000Z"))).toBe(
      "2026-03-09",
    );
  });

  it("handles the fall-back transition", () => {
    // 2026-11-01 02:00 CDT becomes 01:00 CST.
    expect(chicagoCalendarDay(Date.parse("2026-11-01T05:30:00.000Z"))).toBe(
      "2026-11-01",
    );
    expect(chicagoCalendarDay(Date.parse("2026-11-02T05:59:00.000Z"))).toBe(
      "2026-11-01",
    );
    expect(chicagoCalendarDay(Date.parse("2026-11-02T06:00:00.000Z"))).toBe(
      "2026-11-02",
    );
  });
});

describe("calendar day parsing", () => {
  it("accepts a real date and rejects an impossible one", () => {
    expect(parseCalendarDay("2026-06-10")).toBe("2026-06-10");
    expect(parseCalendarDay("2026-02-31")).toBeNull();
    expect(parseCalendarDay("2026-13-01")).toBeNull();
    expect(parseCalendarDay("06/10/2026")).toBeNull();
    expect(parseCalendarDay("")).toBeNull();
    expect(parseCalendarDay(null)).toBeNull();
    expect(parseCalendarDay(undefined)).toBeNull();
  });

  it("accepts a leap day in a leap year and rejects it otherwise", () => {
    expect(parseCalendarDay("2028-02-29")).toBe("2028-02-29");
    expect(parseCalendarDay("2026-02-29")).toBeNull();
  });
});

describe("business days", () => {
  it("counts weekdays and refuses weekends", () => {
    expect(isChicagoBusinessDay("2026-06-08")).toBe(true); // Monday
    expect(isChicagoBusinessDay("2026-06-12")).toBe(true); // Friday
    expect(isChicagoBusinessDay("2026-06-13")).toBe(false); // Saturday
    expect(isChicagoBusinessDay("2026-06-14")).toBe(false); // Sunday
  });

  it("ships with no holiday authority, because the repository has none", () => {
    expect(NO_HOLIDAY_AUTHORITY.size).toBe(0);
  });

  it("honours an injected holiday set when one is supplied", () => {
    const holidays = new Set(["2026-06-10"]);
    expect(isChicagoBusinessDay("2026-06-10")).toBe(true);
    expect(isChicagoBusinessDay("2026-06-10", holidays)).toBe(false);
    // Monday..Friday with Wednesday a holiday leaves four.
    expect(businessDaysBetween("2026-06-07", "2026-06-12", holidays)).toBe(4);
  });

  it("excludes the from-day and includes the through-day", () => {
    // Mon 2026-06-08 -> Thu 2026-06-11 is Tue, Wed, Thu.
    expect(businessDaysBetween("2026-06-08", "2026-06-11")).toBe(3);
  });

  it("returns zero when the through-day is on or before the from-day", () => {
    expect(businessDaysBetween("2026-06-10", "2026-06-10")).toBe(0);
    expect(businessDaysBetween("2026-06-10", "2026-06-09")).toBe(0);
  });

  it("skips a weekend that falls inside the span", () => {
    // Thu 2026-06-11 -> Tue 2026-06-16 is Fri, Mon, Tue.
    expect(businessDaysBetween("2026-06-11", "2026-06-16")).toBe(3);
  });

  it("counts correctly across a daylight-saving transition", () => {
    // Thu 2026-03-05 -> Tue 2026-03-10 spans the spring-forward Sunday.
    expect(businessDaysBetween("2026-03-05", "2026-03-10")).toBe(3);
    // Thu 2026-10-29 -> Tue 2026-11-03 spans the fall-back Sunday.
    expect(businessDaysBetween("2026-10-29", "2026-11-03")).toBe(3);
  });

  it("returns null for an unparseable day", () => {
    expect(businessDaysBetween("nope", "2026-06-11")).toBeNull();
    expect(businessDaysBetween("2026-06-11", "2026-02-31")).toBeNull();
  });
});

describe("the approved checkout cutoff", () => {
  const at = (iso: string) => Date.parse(iso);

  it("requires three business days", () => {
    expect(MIN_BUSINESS_DAYS_BEFORE_CLOSE).toBe(3);
  });

  it("allows a window with exactly three business days left", () => {
    // Monday 09:00 Chicago, closing Thursday: Tue, Wed, Thu.
    const decision = evaluateCheckoutBusinessDayCutoff({
      closeDate: "2026-06-11",
      now: at("2026-06-08T14:00:00.000Z"),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.businessDaysRemaining).toBe(3);
  });

  it("refuses a window with exactly two business days left", () => {
    const decision = evaluateCheckoutBusinessDayCutoff({
      closeDate: "2026-06-10",
      now: at("2026-06-08T14:00:00.000Z"),
    });
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({
      reason: "insufficient_business_days",
      businessDaysRemaining: 2,
    });
  });

  it("refuses when the window closes today", () => {
    const decision = evaluateCheckoutBusinessDayCutoff({
      closeDate: "2026-06-08",
      now: at("2026-06-08T14:00:00.000Z"),
    });
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({
      reason: "insufficient_business_days",
      businessDaysRemaining: 0,
    });
  });

  it("refuses a window that already closed", () => {
    const decision = evaluateCheckoutBusinessDayCutoff({
      closeDate: "2026-06-05",
      now: at("2026-06-08T14:00:00.000Z"),
    });
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ reason: "window_already_closed" });
  });

  it("refuses a missing or malformed close date", () => {
    for (const closeDate of [null, undefined, "", "soon", "2026-02-31"]) {
      const decision = evaluateCheckoutBusinessDayCutoff({
        closeDate,
        now: at("2026-06-08T14:00:00.000Z"),
      });
      expect(decision.allowed).toBe(false);
      expect(["close_date_missing", "close_date_invalid"]).toContain(
        (decision as { reason: string }).reason,
      );
    }
  });

  it("flips at the exact Chicago midnight, not the UTC one", () => {
    // Closing Thursday 2026-06-11. At 23:59:59.999 Chicago on Monday there are
    // still three business days (Tue/Wed/Thu). One millisecond later it is
    // Tuesday in Chicago and only two remain.
    const lastInstantOfMonday = at("2026-06-09T04:59:59.999Z");
    const firstInstantOfTuesday = at("2026-06-09T05:00:00.000Z");
    expect(chicagoCalendarDay(lastInstantOfMonday)).toBe("2026-06-08");
    expect(chicagoCalendarDay(firstInstantOfTuesday)).toBe("2026-06-09");

    expect(
      evaluateCheckoutBusinessDayCutoff({
        closeDate: "2026-06-11",
        now: lastInstantOfMonday,
      }).allowed,
    ).toBe(true);
    const after = evaluateCheckoutBusinessDayCutoff({
      closeDate: "2026-06-11",
      now: firstInstantOfTuesday,
    });
    expect(after.allowed).toBe(false);
    expect(after.businessDaysRemaining).toBe(2);
  });

  it("counts a weekend as no runway at all", () => {
    // Friday, closing the following Monday: only Monday is a business day.
    const decision = evaluateCheckoutBusinessDayCutoff({
      closeDate: "2026-06-15",
      now: at("2026-06-12T14:00:00.000Z"),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.businessDaysRemaining).toBe(1);
  });

  it("refuses when an injected holiday removes the third day", () => {
    const base = {
      closeDate: "2026-06-11",
      now: at("2026-06-08T14:00:00.000Z"),
    };
    expect(evaluateCheckoutBusinessDayCutoff(base).allowed).toBe(true);
    const withHoliday = evaluateCheckoutBusinessDayCutoff({
      ...base,
      holidays: new Set(["2026-06-10"]),
    });
    expect(withHoliday.allowed).toBe(false);
    expect(withHoliday.businessDaysRemaining).toBe(2);
  });

  it("never widens: a longer window is allowed, a shorter one never is", () => {
    const now = at("2026-06-08T14:00:00.000Z");
    const days = [
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-15",
    ];
    const allowed = days.map(
      (d) => evaluateCheckoutBusinessDayCutoff({ closeDate: d, now }).allowed,
    );
    // Monotonic: once allowed, every later close date stays allowed.
    expect(allowed).toEqual([false, false, false, true, true, true]);
  });
});

describe("the Stripe session-expiry clamp", () => {
  // Extracted from the checkout route so it has coverage of its own. Behind the
  // three-business-day product cutoff it is no longer reachable on the T2 path,
  // and it was left both unreachable and untested by the first candidate. It is
  // retained as defence in depth, so it is verified as defence in depth.
  const MIN = 30 * 60;
  const MAX = 24 * 60 * 60;
  const at = (iso: string) => Date.parse(iso);

  it("clamps to the end of the close day in Chicago, not a UTC midnight", () => {
    const result = stripeSessionExpiry({
      closeDate: "2026-06-11",
      now: at("2026-06-11T12:00:00.000Z"),
      maxSeconds: MAX,
      minSeconds: MIN,
    });
    // End of 2026-06-11 in Chicago (CDT, UTC-5) is 2026-06-12T04:59:59Z.
    expect(new Date(result.expiresAtEpochSeconds * 1000).toISOString()).toBe(
      "2026-06-12T04:59:59.000Z",
    );
    expect(result.viable).toBe(true);
  });

  it("refuses when under thirty minutes remain before the window's last moment", () => {
    const result = stripeSessionExpiry({
      closeDate: "2026-06-11",
      now: at("2026-06-12T04:45:00.000Z"), // 14m59s before the Chicago day ends
      maxSeconds: MAX,
      minSeconds: MIN,
    });
    expect(result.viable).toBe(false);
    expect(result.secondsAvailable).toBeLessThan(MIN);
  });

  it("clamps to the provider maximum when the window is far away", () => {
    const now = at("2026-06-01T12:00:00.000Z");
    const result = stripeSessionExpiry({
      closeDate: "2026-12-31",
      now,
      maxSeconds: MAX,
      minSeconds: MIN,
    });
    expect(result.expiresAtEpochSeconds).toBe(
      Math.floor((now + MAX * 1000) / 1000),
    );
    expect(result.viable).toBe(true);
  });

  it("is unbounded by the window for an approved-notice order", () => {
    const now = at("2026-06-12T04:45:00.000Z");
    const bounded = stripeSessionExpiry({
      closeDate: "2026-06-11",
      now,
      maxSeconds: MAX,
      minSeconds: MIN,
    });
    const unbounded = stripeSessionExpiry({
      closeDate: "2026-06-11",
      now,
      maxSeconds: MAX,
      minSeconds: MIN,
      unboundedByWindow: true,
    });
    expect(bounded.viable).toBe(false);
    expect(unbounded.viable).toBe(true);
  });

  it("falls back to the provider maximum when the close date is unusable", () => {
    for (const closeDate of [null, undefined, "", "2026-02-31", "nope"]) {
      const now = at("2026-06-01T12:00:00.000Z");
      const result = stripeSessionExpiry({
        closeDate,
        now,
        maxSeconds: MAX,
        minSeconds: MIN,
      });
      expect(result.expiresAtEpochSeconds).toBe(
        Math.floor((now + MAX * 1000) / 1000),
      );
    }
  });

  it("cannot fire for any window the product cutoff allows", () => {
    // The relationship between the two rules, asserted rather than assumed:
    // three Chicago business days is always far more than thirty minutes, so
    // the provider clamp is unreachable behind the product cutoff.
    const now = at("2026-06-08T14:00:00.000Z");
    let checked = 0;
    for (let step = 0; step <= 45; step += 1) {
      const day = new Date(
        Date.parse("2026-06-08T00:00:00Z") + step * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      if (!evaluateCheckoutBusinessDayCutoff({ closeDate: day, now }).allowed)
        continue;
      checked += 1;
      expect(
        stripeSessionExpiry({
          closeDate: day,
          now,
          maxSeconds: MAX,
          minSeconds: MIN,
        }).viable,
      ).toBe(true);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("handles a close day across both daylight-saving transitions", () => {
    // Spring forward: 2026-03-08 ends at 2026-03-09T04:59:59Z (CDT).
    expect(
      new Date(
        stripeSessionExpiry({
          closeDate: "2026-03-08",
          now: at("2026-03-08T12:00:00.000Z"),
          maxSeconds: MAX,
          minSeconds: MIN,
        }).expiresAtEpochSeconds * 1000,
      ).toISOString(),
    ).toBe("2026-03-09T04:59:59.000Z");
    // Fall back: 2026-11-01 ends at 2026-11-02T05:59:59Z (CST).
    expect(
      new Date(
        stripeSessionExpiry({
          closeDate: "2026-11-01",
          now: at("2026-11-01T12:00:00.000Z"),
          maxSeconds: MAX,
          minSeconds: MIN,
        }).expiresAtEpochSeconds * 1000,
      ).toISOString(),
    ).toBe("2026-11-02T05:59:59.000Z");
  });
});
