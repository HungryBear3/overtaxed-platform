/**
 * The customer delivery promise.
 *
 * The approved wording (Gate A owner ruling 2026-08-31, D-3 / T-1) is delivery
 * within ONE BUSINESS DAY. The repository shipped "within 24 hours", which is a
 * different and harder commitment: a Friday-evening purchase is about fifteen
 * hours from a 24-hour promise expiring and three days from the end of the next
 * business day.
 *
 * This suite sweeps the shipped roots for the old wording — and its
 * paraphrases — and requires every remaining match to be a deliberate, named
 * exemption rather than a survivor.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * Every phrasing that reads as a twenty-four-hour or one-day delivery promise.
 * Widened after independent review (L4): the first version matched only
 * "24 hours" / "24-hour" and would have missed "24 hrs", "twenty-four hours"
 * and "within a day".
 */
export const TWENTY_FOUR_HOUR_PATTERN =
  /\b24[ -]?(?:hours?|hrs?)\b|\btwenty[- ]four[ -]hours?\b|\bwithin a day\b/i;

/**
 * Roots that ship to a customer in some form. `public/` is served verbatim, so
 * it is included; `__tests__/`, `reports/`, `docs/` and `scripts/` are not
 * customer surfaces and are deliberately out of scope for a copy guard.
 */
const SHIPPED_ROOTS = [
  "app",
  "lib",
  "components",
  "content",
  "public",
  "hooks",
  "styles",
  "types",
];

/**
 * Every file under a shipped root that still matches, with the reason it is
 * allowed to. A new customer-facing promise cannot be added without either
 * failing this suite or arguing itself into this table in review.
 */
const EXEMPTIONS: Array<{ file: string; why: string }> = [
  {
    file: "app/api/auth/register/route.ts",
    why: "email-verification link validity, which is a real token lifetime and not a delivery promise",
  },
  {
    file: "app/api/auth/resend-verification/route.ts",
    why: "email-verification link validity, as above",
  },
  {
    file: "lib/email/send.ts",
    why: "internal operations alert to staff ('respond to customer within 24 hours') plus the comment recording this change; neither is shown to a customer",
  },
  {
    file: "app/api/checkout/session/route.ts",
    why: "code comment describing the 24-hour source-freshness default",
  },
  {
    file: "lib/checkout/ot-contract.ts",
    why: "code comments describing the 24-hour source-freshness default",
  },
  {
    file: "lib/deadlines/official-source-state.ts",
    why: "code comment contrasting calendar days with elapsed 24-hour periods",
  },
  {
    file: "public/downloads/landlord-notices/03-entry-notice.md",
    why: "an Illinois landlord entry-notice template describing the customary 24-hour advance notice to a tenant; statutory-practice content, not an OverTaxed delivery promise",
  },
];

/** Files outside the shipped roots that are still enumerated for the record. */
const HISTORICAL_EXEMPTIONS: Array<{ file: string; why: string }> = [
  {
    file: "PRD-BILLING-OVERHAUL.md",
    why: "historical product requirements document, not shipped copy and not rendered to any customer; retained as a record of what the promise used to be",
  },
];

describe("the approved delivery promise", () => {
  it("is what the confirmation email sends", () => {
    const send = read("lib/email/send.ts");
    expect(send).toContain(
      "We'll email you within one business day with your completed appeal packet.",
    );
    expect(send).not.toContain(
      "We'll email you within 24 hours with your completed appeal packet.",
    );
  });

  it("is what the checkout success page renders", () => {
    const page = read("app/checkout/success/page.tsx");
    expect(page).toContain("<strong>one business day</strong>");
    expect(page).not.toContain("<strong>24 hours</strong>");
  });

  it("promises no outcome, acceptance, or saving alongside it", () => {
    for (const file of ["lib/email/send.ts", "app/checkout/success/page.tsx"]) {
      const text = read(file);
      expect(text).not.toMatch(
        /guarantee[ds]?\s+(a\s+)?(reduction|approval|acceptance|saving)/i,
      );
      expect(text).not.toMatch(/we will (win|reduce|lower) your/i);
      expect(text).not.toMatch(/(estimated|potential|expected) savings/i);
    }
  });

  it("keeps the homeowner-files posture on the paid confirmation", () => {
    const send = read("lib/email/send.ts");
    expect(send).toMatch(/appeal packet/i);
    expect(send).not.toMatch(/we (will )?file (it|your appeal)/i);
    expect(send).not.toMatch(/filed on your behalf/i);
  });

  it("carries no unexplained twenty-four-hour promise under any shipped root", () => {
    // This walks the tree. An earlier version iterated a hardcoded five-file
    // list and swallowed missing files with try/catch, so a brand-new
    // customer-facing 24-hour promise in any other file passed unnoticed. A
    // later version walked four roots with one pattern and skipped `public/`.
    const exemptFiles = new Set(EXEMPTIONS.map((e) => e.file));
    for (const { file, why } of [...EXEMPTIONS, ...HISTORICAL_EXEMPTIONS]) {
      expect(why.length).toBeGreaterThan(20);
      // An exemption that no longer matches is stale and must be removed.
      expect(read(file)).toMatch(TWENTY_FOUR_HOUR_PATTERN);
    }

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), {
        withFileTypes: true,
      })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue;
          walk(rel);
          continue;
        }
        if (
          !/\.(ts|tsx|js|jsx|md|mdx|json|html|txt|svg|xml|css)$/.test(
            entry.name,
          )
        )
          continue;
        if (exemptFiles.has(rel)) continue;
        const text = readFileSync(join(ROOT, rel), "utf8");
        if (TWENTY_FOUR_HOUR_PATTERN.test(text)) offenders.push(rel);
      }
    };
    let rootsWalked = 0;
    for (const root of SHIPPED_ROOTS) {
      try {
        walk(root);
        rootsWalked += 1;
      } catch {
        // directory absent on this branch
      }
    }
    // The roots that carry the customer surfaces must actually exist.
    expect(rootsWalked).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });

  it("proves the sweep actually detects a new offender in every phrasing", () => {
    // Guards the guard: if the sweep silently stopped matching, this fails.
    const probes = [
      "We will email your completed appeal packet within 24 hours.",
      "Your packet arrives within 24 hrs of purchase.",
      "Delivered within 24hrs.",
      "Expect it within twenty-four hours.",
      "You'll have it within a day.",
      "A 24-hour turnaround.",
    ];
    for (const probe of probes)
      expect(TWENTY_FOUR_HOUR_PATTERN.test(probe)).toBe(true);
    // And does not fire on the approved wording or on unrelated numbers.
    for (const clean of [
      "We'll email you within one business day.",
      "The 2024 hours of operation are unchanged.",
      "Within a daylight window.",
    ]) {
      expect(TWENTY_FOUR_HOUR_PATTERN.test(clean)).toBe(false);
    }
    expect(EXEMPTIONS.every((e) => !probes[0].includes(e.file))).toBe(true);
  });
});
