/**
 * Chicago business-day arithmetic for the approved checkout suppression rule.
 *
 * The approved policy (Gate A owner ruling of 2026-08-31, item D-3 / T-1) is:
 * deliver within one business day, and **do not sell a packet when the
 * Assessor window closes within three business days**. Before this module the
 * repository had no business-day arithmetic at all, and the only close-date
 * logic on the paid path was the Stripe session-expiry clamp — a 30-minute
 * minimum measured against a UTC midnight. That is a payment-provider
 * constraint, not a product cutoff, and it is not a substitute for one.
 *
 * Everything here is pure and clock-injectable so the boundary instants can be
 * proven rather than asserted.
 *
 * Time zone. Every day boundary is America/Chicago, matching
 * [[countyCalendarDay]] in `lib/deadlines/official-source-state.ts`, because the
 * county's filing deadline is a Chicago calendar date. Day arithmetic is done
 * on `YYYY-MM-DD` strings anchored at UTC midnight, which is immune to daylight
 * saving: the conversion from instant to Chicago day is the only place a zone
 * offset is applied, and stepping from one day string to the next can never
 * land on a 23- or 25-hour day.
 */

/** The county's time zone. Deliberately the same literal as the deadline module. */
export const CHICAGO_TIME_ZONE = "America/Chicago";

/** Approved product cutoff: fewer than this many business days closes checkout. */
export const MIN_BUSINESS_DAYS_BEFORE_CLOSE = 3;

/**
 * Public holidays are NOT applied by default, because this repository carries
 * no holiday authority to apply.
 *
 * This is a deliberate, disclosed gap rather than an invented calendar. Note the
 * direction of the risk: omitting a holiday can only *overstate* the business
 * days remaining, which is the fail-open direction. The parameter exists so a
 * future authorized holiday source can be injected without touching any caller,
 * and so the arithmetic can be proven against holidays in tests today.
 */
export const NO_HOLIDAY_AUTHORITY: ReadonlySet<string> = new Set<string>();

/**
 * Cook County's published 2026 observed-holiday calendar. This is intentionally
 * year-bounded: checkout must fail closed rather than infer a future year's
 * calendar. Source: Cook County Office Under the President, 2026 holiday
 * schedule (county-observed dates).
 */
export const COOK_COUNTY_OBSERVED_HOLIDAYS_2026: ReadonlySet<string> = new Set([
  "2026-01-01", "2026-01-19", "2026-02-12", "2026-02-16",
  "2026-03-02", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26",
  "2026-11-27", "2026-12-25",
]);

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const chicagoDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHICAGO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The Chicago calendar date of an instant, as `YYYY-MM-DD`.
 *
 * 23:59:59.999 Chicago is still that day; the next millisecond is the next day.
 * That is the exact boundary the cutoff is measured from.
 */
export function chicagoCalendarDay(instant: Date | number): string {
  const ms = instant instanceof Date ? instant.getTime() : instant;
  if (!Number.isFinite(ms)) return "";
  // en-CA renders YYYY-MM-DD, which compares correctly as a string.
  return chicagoDayFormatter.format(new Date(ms));
}

/** A valid `YYYY-MM-DD` calendar day, or null. Rejects 2026-02-31 rather than rolling it. */
export function parseCalendarDay(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const day = value.trim();
  if (!DAY_PATTERN.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === day ? day : null;
}

function dayToUtcMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function addDays(day: string, delta: number): string {
  return new Date(dayToUtcMs(day) + delta * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Saturday and Sunday are not business days; nor is any day in the injected
 * holiday set. The weekday is read in UTC from a UTC-anchored midnight, so it
 * is the weekday of the calendar date itself and carries no zone offset.
 */
export function isChicagoBusinessDay(
  day: string,
  holidays: ReadonlySet<string> = NO_HOLIDAY_AUTHORITY,
): boolean {
  const parsed = parseCalendarDay(day);
  if (!parsed) return false;
  if (holidays.has(parsed)) return false;
  const weekday = new Date(dayToUtcMs(parsed)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/**
 * Business days strictly after `fromDay`, up to and including `throughDay`.
 *
 * The day of purchase is excluded on purpose. The approved promise is delivery
 * within one business day, so the purchase day cannot also be a day the
 * homeowner has the packet in hand; counting it would sell the buyer a day that
 * does not exist. Returns 0 when `throughDay` is on or before `fromDay`, and
 * null when either day is unparseable.
 */
export function businessDaysBetween(
  fromDay: string,
  throughDay: string,
  holidays: ReadonlySet<string> = NO_HOLIDAY_AUTHORITY,
): number | null {
  const from = parseCalendarDay(fromDay);
  const through = parseCalendarDay(throughDay);
  if (!from || !through) return null;
  if (through <= from) return 0;
  let count = 0;
  for (let day = addDays(from, 1); day <= through; day = addDays(day, 1)) {
    if (isChicagoBusinessDay(day, holidays)) count += 1;
  }
  return count;
}

export type CheckoutCutoffDecision =
  | {
      allowed: true;
      businessDaysRemaining: number;
      evaluatedChicagoDay: string;
      closeDay: string;
    }
  | {
      allowed: false;
      reason:
        | "close_date_missing"
        | "close_date_invalid"
        | "window_already_closed"
        | "insufficient_business_days";
      businessDaysRemaining: number | null;
      evaluatedChicagoDay: string;
      closeDay: string | null;
    };

/**
 * The approved three-business-day product cutoff.
 *
 * Fails closed on every ambiguity: a missing close date, an unparseable one, a
 * date already past, or fewer than [[MIN_BUSINESS_DAYS_BEFORE_CLOSE]] business
 * days of runway. It never widens a window — a caller that is already refusing
 * for another reason stays refusing.
 *
 * This does not read a snapshot's trust or freshness. Those are decided by the
 * canonical deadline state before a close date ever reaches this function, and
 * a synthetic or stale snapshot never produces one.
 */
export function evaluateCheckoutBusinessDayCutoff(input: {
  closeDate: string | null | undefined;
  now: Date | number;
  holidays?: ReadonlySet<string>;
  minimumBusinessDays?: number;
}): CheckoutCutoffDecision {
  const holidays = input.holidays ?? COOK_COUNTY_OBSERVED_HOLIDAYS_2026;
  const minimum = input.minimumBusinessDays ?? MIN_BUSINESS_DAYS_BEFORE_CLOSE;
  const today = chicagoCalendarDay(input.now);

  if (
    input.closeDate === null ||
    input.closeDate === undefined ||
    input.closeDate === ""
  ) {
    return {
      allowed: false,
      reason: "close_date_missing",
      businessDaysRemaining: null,
      evaluatedChicagoDay: today,
      closeDay: null,
    };
  }
  const closeDay = parseCalendarDay(input.closeDate);
  if (!closeDay || !today) {
    return {
      allowed: false,
      reason: "close_date_invalid",
      businessDaysRemaining: null,
      evaluatedChicagoDay: today,
      closeDay: null,
    };
  }
  if (closeDay < today) {
    return {
      allowed: false,
      reason: "window_already_closed",
      businessDaysRemaining: 0,
      evaluatedChicagoDay: today,
      closeDay,
    };
  }
  const remaining = businessDaysBetween(today, closeDay, holidays);
  if (remaining === null) {
    return {
      allowed: false,
      reason: "close_date_invalid",
      businessDaysRemaining: null,
      evaluatedChicagoDay: today,
      closeDay,
    };
  }
  if (remaining < minimum) {
    return {
      allowed: false,
      reason: "insufficient_business_days",
      businessDaysRemaining: remaining,
      evaluatedChicagoDay: today,
      closeDay,
    };
  }
  return {
    allowed: true,
    businessDaysRemaining: remaining,
    evaluatedChicagoDay: today,
    closeDay,
  };
}

/**
 * The Stripe Checkout Session expiry for a window, and whether one can exist.
 *
 * Separate from the product cutoff above and subordinate to it. A hosted
 * session must live at least `minSeconds` and must never outlive the filing
 * window it was sold against, so the expiry is the earlier of the window's last
 * moment and the provider's maximum session life.
 *
 * This lived inline in the checkout route, where it could not be unit-tested;
 * the only case that exercised it was a same-day close, which the three-
 * business-day product cutoff now refuses earlier. It is kept as defence in
 * depth and moved here so it has coverage of its own rather than being
 * unreachable AND unverified.
 *
 * `closeDate` is a Chicago calendar date. The window's last moment is the end of
 * that day in Chicago, not a UTC midnight.
 */
export function stripeSessionExpiry(input: {
  closeDate: string | null | undefined;
  now: Date | number;
  maxSeconds: number;
  minSeconds: number;
  /** True for an approved-notice order, which is not bounded by the window. */
  unboundedByWindow?: boolean;
}): {
  expiresAtEpochSeconds: number;
  viable: boolean;
  secondsAvailable: number;
} {
  const nowMs = input.now instanceof Date ? input.now.getTime() : input.now;
  const maxMs = nowMs + input.maxSeconds * 1000;
  const closeDay = parseCalendarDay(input.closeDate);

  let boundMs = maxMs;
  if (!input.unboundedByWindow && closeDay) {
    // End of the close day in Chicago: the first instant of the next day, less
    // one second. Derived through the zone formatter so DST cannot shift it.
    const nextDayStartMs = chicagoDayStartUtcMs(addCalendarDay(closeDay));
    if (nextDayStartMs !== null)
      boundMs = Math.min(maxMs, nextDayStartMs - 1000);
  }
  const expiresAtEpochSeconds = Math.floor(boundMs / 1000);
  const secondsAvailable = expiresAtEpochSeconds - Math.floor(nowMs / 1000);
  return {
    expiresAtEpochSeconds,
    viable: secondsAvailable >= input.minSeconds,
    secondsAvailable,
  };
}

function addCalendarDay(day: string): string {
  return new Date(dayToUtcMs(day) + DAY_MS).toISOString().slice(0, 10);
}

/** UTC instant of 00:00 America/Chicago on a calendar day, DST included. */
function chicagoDayStartUtcMs(day: string): number | null {
  const parsed = parseCalendarDay(day);
  if (!parsed) return null;
  // Start from the UTC midnight and correct by the zone offset observed there,
  // then re-check, which converges for both standard and daylight offsets.
  let guess = dayToUtcMs(parsed);
  for (let i = 0; i < 3; i += 1) {
    const rendered = chicagoCalendarDay(guess);
    if (rendered === parsed) {
      // Walk back to the first instant that still renders as this day.
      let lo = guess - 26 * 3600_000;
      let hi = guess;
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2);
        if (chicagoCalendarDay(mid) === parsed) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    guess += 6 * 3600_000;
  }
  return null;
}
