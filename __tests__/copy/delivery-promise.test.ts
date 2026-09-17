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
 * exemption rather than a survivor. Exemptions are by LINE CONTENT, not by
 * file (independent re-review of e5383bbc, L3): a whole-file exemption let a
 * brand-new 24-hour promise inside the customer e-mail module pass unnoticed.
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

const SWEPT_EXTENSIONS = /\.(ts|tsx|js|jsx|md|mdx|json|html|txt|svg|xml|css)$/;

type Exemption = {
  file: string;
  /**
   * The exact phrases that are allowed to match on a line of this file. A line
   * is allowed only if, once every allowed phrase is removed from it, nothing
   * on the line still matches the pattern. A new 24-hour variant beside an
   * allowed phrase, or anywhere else in the file, is therefore an offender.
   */
  allow: RegExp[];
  why: string;
};

/**
 * Every line under a shipped root that still matches, with the reason it is
 * allowed to. A new customer-facing promise cannot be added without either
 * failing this suite or arguing itself into this table in review.
 */
const EXEMPTIONS: Exemption[] = [
  {
    file: "app/api/auth/register/route.ts",
    allow: [/\(valid 24 hours\)/, /\(link valid 24 hours\)/],
    why: "email-verification link validity, which is a real token lifetime and not a delivery promise",
  },
  {
    file: "app/api/auth/resend-verification/route.ts",
    allow: [/\(valid 24 hours\)/, /\(link valid 24 hours\)/],
    why: "email-verification link validity, as above",
  },
  {
    file: "lib/email/send.ts",
    allow: [
      /respond to customer within 24 hours\./,
      /one business day, not 24 hours\. The two are not the same commitment/,
      /~15 hours from a 24-hour promise expiring/,
    ],
    why: "internal operations alert to staff ('respond to customer within 24 hours') plus the comment recording this change; neither is shown to a customer",
  },
  {
    file: "app/api/checkout/session/route.ts",
    allow: [/so the 24-hour default, the$/],
    why: "code comment describing the 24-hour source-freshness default",
  },
  {
    file: "lib/checkout/ot-contract.ts",
    allow: [
      /The frozen default is 24 hours,$/,
      /already applied the 24-hour default, the same-day$/,
    ],
    why: "code comments describing the 24-hour source-freshness default",
  },
  {
    file: "lib/deadlines/official-source-state.ts",
    allow: [/Calendar days, not elapsed 24-hour periods:/],
    why: "code comment contrasting calendar days with elapsed 24-hour periods",
  },
  {
    file: "public/downloads/landlord-notices/03-entry-notice.md",
    allow: [
      /Most leases specify 24 hours; some municipalities require more\./,
      /\*\*Standard practice and most leases:\*\* 24 hours advance notice$/,
    ],
    why: "an Illinois landlord entry-notice template describing the customary 24-hour advance notice to a tenant; statutory-practice content, not an OverTaxed delivery promise",
  },
];

/** Files outside the shipped roots that are still enumerated for the record. */
const HISTORICAL_EXEMPTIONS: Exemption[] = [
  {
    file: "PRD-BILLING-OVERHAUL.md",
    allow: [/We'll be in touch within 24 hours/],
    why: "historical product requirements document, not shipped copy and not rendered to any customer; retained as a record of what the promise used to be",
  },
];

type SweptFile = { rel: string; text: string };

/**
 * Pure classifier over file contents, so the guard itself can be tested with
 * planted offenders without touching the tree. Returns `rel:line` for every
 * line that matches the pattern and is not covered by an exact exemption.
 */
export function findOffenders(
  files: ReadonlyArray<SweptFile>,
  exemptions: ReadonlyArray<Exemption> = EXEMPTIONS,
): string[] {
  const byFile = new Map(exemptions.map((e) => [e.file, e.allow]));
  const offenders: string[] = [];
  for (const { rel, text } of files) {
    const allow = byFile.get(rel) ?? [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!TWENTY_FOUR_HOUR_PATTERN.test(line)) continue;
      let residue = line;
      for (const phrase of allow) residue = residue.replace(phrase, " ");
      if (TWENTY_FOUR_HOUR_PATTERN.test(residue))
        offenders.push(`${rel}:${i + 1}`);
    }
  }
  return offenders;
}

function walkShippedRoots(): { files: SweptFile[]; rootsWalked: number } {
  const files: SweptFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(rel);
        continue;
      }
      if (!SWEPT_EXTENSIONS.test(entry.name)) continue;
      files.push({ rel, text: readFileSync(join(ROOT, rel), "utf8") });
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
  return { files, rootsWalked };
}

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
    // The version before this one exempted whole files, so a new promise
    // inside an exempted file — the customer e-mail module included — passed.
    for (const { file, allow, why } of [
      ...EXEMPTIONS,
      ...HISTORICAL_EXEMPTIONS,
    ]) {
      expect(why.length).toBeGreaterThan(20);
      const lines = read(file).split("\n");
      // An allowed phrase that no longer matches any line is stale and must be
      // removed; an allowed phrase must itself be a 24-hour match.
      for (const phrase of allow) {
        expect(lines.some((line) => phrase.test(line))).toBe(true);
        expect(TWENTY_FOUR_HOUR_PATTERN.test(phrase.source)).toBe(true);
      }
    }

    const { files, rootsWalked } = walkShippedRoots();
    // The roots that carry the customer surfaces must actually exist.
    expect(rootsWalked).toBeGreaterThanOrEqual(4);
    expect(findOffenders(files)).toEqual([]);
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
    // Every phrasing is an offender in a fresh file under a shipped root.
    for (const probe of probes) {
      expect(
        findOffenders([{ rel: "public/new-page.txt", text: probe }]),
      ).toEqual(["public/new-page.txt:1"]);
    }
  });

  it("cannot be masked by an exemption: a new promise inside an exempted file fails", () => {
    const send = read("lib/email/send.ts");
    const landlord = read(
      "public/downloads/landlord-notices/03-entry-notice.md",
    );
    // Control: the files as shipped are clean.
    expect(
      findOffenders([
        { rel: "lib/email/send.ts", text: send },
        {
          rel: "public/downloads/landlord-notices/03-entry-notice.md",
          text: landlord,
        },
      ]),
    ).toEqual([]);

    // A new promise appended to the customer e-mail module.
    const sendLines = send.split("\n").length;
    expect(
      findOffenders([
        {
          rel: "lib/email/send.ts",
          text: `${send}\nexport const PROBE = "Your appeal packet arrives within 24 hours.";`,
        },
      ]),
    ).toEqual([`lib/email/send.ts:${sendLines + 1}`]);

    // A new promise on the line directly beside the allowed landlord language.
    const landlordLines = landlord.split("\n");
    const allowedAt = landlordLines.findIndex((l) =>
      /Most leases specify 24 hours; some municipalities require more\./.test(
        l,
      ),
    );
    expect(allowedAt).toBeGreaterThanOrEqual(0);
    const beside = [...landlordLines];
    beside.splice(allowedAt + 1, 0, "We deliver your packet within 24 hours.");
    expect(
      findOffenders([
        {
          rel: "public/downloads/landlord-notices/03-entry-notice.md",
          text: beside.join("\n"),
        },
      ]),
    ).toEqual([
      `public/downloads/landlord-notices/03-entry-notice.md:${allowedAt + 2}`,
    ]);

    // A second variant appended to the allowed line itself.
    const onSameLine = [...landlordLines];
    onSameLine[allowedAt] = `${onSameLine[allowedAt]} Delivered within a day.`;
    expect(
      findOffenders([
        {
          rel: "public/downloads/landlord-notices/03-entry-notice.md",
          text: onSameLine.join("\n"),
        },
      ]),
    ).toEqual([
      `public/downloads/landlord-notices/03-entry-notice.md:${allowedAt + 1}`,
    ]);

    // An exemption never reaches across files.
    expect(
      findOffenders([
        {
          rel: "lib/email/other.ts",
          text: "respond to customer within 24 hours.",
        },
      ]),
    ).toEqual(["lib/email/other.ts:1"]);
  });
});
