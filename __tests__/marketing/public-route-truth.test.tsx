/**
 * @jest-environment node
 *
 * Public-route truth for /township/[slug], /deadlines and the shared footer.
 *
 * - No reassessment-cycle year labels. The roster's `cycleYear` filed Jefferson
 *   (City of Chicago) under "2028 (next: 2031)", which the official sources do
 *   not support; restating a different year would itself be an inference, so
 *   the labels are omitted rather than corrected.
 * - No $69 preparation upsell (CC-10, pricing link, "$69 packet prepared") on
 *   township routes. The approved boundary is a free public-records check.
 * - No "overassessed" / "too high" / "Check eligibility" / "overpayment
 *   estimate" framing on the free-check CTAs; they reuse the approved neutral
 *   `/check` strings instead.
 * - The township, deadline and townships-index routes always render the
 *   informational footer: CC-12 verbatim, never CC-01's prepared-packet
 *   sentence and never the neutral report's name or limits.
 * - The explicit official-calendar fallback stays: an unverified township still
 *   says so and links the Cook County Assessor calendar.
 *
 * The verified-window fixture is hypothetical. It asserts what the page would
 * render, not any real calendar or retrieval.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";
import { UNAVAILABLE_INFORMATIONAL_SNAPSHOT } from "@/lib/deadlines/use-live-informational-snapshot";
import { CC_01, CC_10, CC_12, CC_18 } from "@/lib/copy/canonical";
import { NEUTRAL_REPORT_LIMITS, NEUTRAL_REPORT_NAME } from "@/lib/copy/neutral-report";

// `var`: modules call the views builder at import time, before a `let` would initialise.
var mockSnapshot: OfficialDeadlineSnapshot | undefined; // eslint-disable-line no-var
var mockNow: Date | undefined; // eslint-disable-line no-var
jest.mock("@/lib/deadlines-2026", () => {
  const actual = jest.requireActual("@/lib/deadlines-2026");
  return {
    ...actual,
    buildTownship2026Views: () =>
      actual.buildTownship2026Views(mockNow ?? new Date(), mockSnapshot),
  };
});
jest.mock("@/lib/analytics/events", () => ({
  analytics: new Proxy({}, { get: () => jest.fn() }),
}));

import TownshipRoutePage, { generateMetadata } from "../../app/township/[slug]/page";
import DeadlinesRoutePage from "../../app/deadlines/page";
import TownshipsRoutePage from "../../app/townships/page";
import DeadlinesPage from "@/components/ot-design/DeadlinesPage";
import { SiteFooter } from "@/components/ot-design/SiteChrome";

const CALENDAR = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";

function hypotheticalVerifiedJefferson(): OfficialDeadlineSnapshot {
  return { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
    authority: "cook_county_assessor", sourceUrl: CALENDAR, finalUrl: CALENDAR, httpStatus: 200,
    retrievedAt: "2026-06-02T16:55:00Z", sourceUpdatedAt: "2026-05-20T00:00:00Z",
    contentSha256: "c".repeat(64), parseStatus: "ok", parserVersion: "test-fixture",
  } }, townships: { jefferson: { townshipName: "Jefferson", stages: { assessor: {
    noticeDate: "2026-05-20", openDate: "2026-05-25", lastFileDate: "2026-06-08",
  } } } } };
}

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

async function renderTownship(slug: string) {
  const element = await TownshipRoutePage({ params: Promise.resolve({ slug }) });
  const html = renderToStaticMarkup(element);
  const metadata = await generateMetadata({ params: Promise.resolve({ slug }) });
  return { html, visible: text(html), metadata };
}

const CYCLE_CLAIMS = [/\b20\d\d\b[^.]{0,20}cycle/i, /reassessment cycle/i, /\(next: \d{4}\)/, /\b2028\b/, /\b2031\b/];
const UPSELL_CLAIMS = [/\$69/, /preparation service/i, /packet prepared/i, /See the pricing details/];
const DIRECTIONAL_CLAIMS = [/overassessed/i, /too high/i, /Check eligibility/, /overpayment/i];

function expectNone(where: string, haystack: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    expect({ where, pattern: String(pattern), matched: pattern.test(haystack) }).toEqual({
      where, pattern: String(pattern), matched: false,
    });
  }
}

afterEach(() => { mockSnapshot = undefined; mockNow = undefined; });

describe("/township/jefferson without a verified date (current production state)", () => {
  it("renders no cycle-year label and no $69 preparation upsell, in body, JSON-LD or metadata", async () => {
    const { html, visible, metadata } = await renderTownship("jefferson");
    const meta = JSON.stringify(metadata);
    expectNone("visible", visible, [...CYCLE_CLAIMS, ...UPSELL_CLAIMS, ...DIRECTIONAL_CLAIMS]);
    expectNone("json-ld+html", html, [...CYCLE_CLAIMS, ...UPSELL_CLAIMS]);
    expectNone("metadata", meta, [...CYCLE_CLAIMS, ...UPSELL_CLAIMS]);
    expect(visible).not.toContain(CC_10);
    expect(metadata.title).toBe("Jefferson Township Property Tax Appeal Deadline");
  });

  it("keeps the explicit official-calendar fallback", async () => {
    const { html, visible } = await renderTownship("jefferson");
    expect(visible).toContain("Not verified");
    expect(visible).toContain("We do not have a verified filing deadline for this township, so this page does not show one.");
    expect(html).toContain(`href="${CALENDAR}"`);
    expect(visible).toContain("The Cook County Assessor charges no fee to file.");
  });
});

describe("/township/jefferson with a (hypothetical) verified open window", () => {
  it("shows the verified dates without cycle years, upsell or over-assessment framing", async () => {
    mockSnapshot = hypotheticalVerifiedJefferson();
    mockNow = new Date("2026-06-02T17:00:00Z");
    const { html, visible, metadata } = await renderTownship("jefferson");
    expect(visible).toContain("June 8, 2026");
    expect(visible).toContain("Free Cook County Property Check");
    expectNone("visible", visible, [...CYCLE_CLAIMS, ...UPSELL_CLAIMS, ...DIRECTIONAL_CLAIMS, /next opportunity/i]);
    expectNone("json-ld+html", html, [...CYCLE_CLAIMS, ...UPSELL_CLAIMS, /next opportunity/i]);
    expectNone("metadata", JSON.stringify(metadata), [...CYCLE_CLAIMS, ...UPSELL_CLAIMS]);
  });

  // The CTA renders only for a verified open window, which no route has today,
  // so this fixture is the only thing standing between its copy and a deploy.
  it("the open-window check CTA reuses the approved neutral /check strings", async () => {
    mockSnapshot = hypotheticalVerifiedJefferson();
    mockNow = new Date("2026-06-02T17:00:00Z");
    const { html } = await renderTownship("jefferson");
    const section = html.match(/<section class="ot-tp-check">[\s\S]*?<\/section>/)?.[0] ?? "";
    const visible = text(section);
    expect(section).not.toBe("");
    expect(visible).toContain("Free Cook County Property Check");
    expect(visible).toContain(
      "Enter your PIN or address. We'll compare your assessed value with comparable properties on the public record, and show your township's appeal-window status where we have verified it. No account, no card.",
    );
    expect(visible).toContain("Check my assessment");
    expect(visible).toContain("Free · No account required · Uses public Cook County Assessor records");
    expect(section).toMatch(/<input[^>]*aria-label="Jefferson address"/);
    expect(visible).toContain("Window closes June 8, 2026");
    expectNone("check cta", visible, [/30 seconds/i, /no signup/i, /Run free check/]);
  });
});

/*
 * Informational-page footer: owner-authorized exception (2026-10-05).
 *
 * The township, deadline and townships-index routes always render the
 * informational footer, whatever OT_NEUTRAL_REPORT_CHECKOUT_ENABLED says. The
 * default footer's CC-01 describes a prepared appeal packet these pages must
 * not offer, and the neutral report's name and limits describe a product they
 * do not offer either. Frozen BL-F2 asks for CC-12 on every consumer surface,
 * so CC-12 stays, verbatim and in its own element. The frozen fixtures are
 * unchanged.
 */
describe("informational routes render the CC-12 informational footer unconditionally", () => {
  const ROUTES: Array<[string, () => Promise<string> | string]> = [
    ["/township/jefferson", async () => renderToStaticMarkup(await TownshipRoutePage({ params: Promise.resolve({ slug: "jefferson" }) }))],
    ["/deadlines", () => renderToStaticMarkup(<DeadlinesRoutePage />)],
    ["/townships", () => renderToStaticMarkup(<TownshipsRoutePage />)],
  ];
  const original = process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED;
  afterAll(() => {
    if (original === undefined) delete process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED;
    else process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = original;
  });

  describe.each([undefined, "false", "true"])("OT_NEUTRAL_REPORT_CHECKOUT_ENABLED=%s", (flag) => {
    beforeEach(() => {
      if (flag === undefined) delete process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED;
      else process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = flag;
    });

    it.each(ROUTES)("%s", async (_route, render) => {
      const html = await render();
      const footer = html.slice(html.indexOf("<footer"));
      const visible = text(footer);
      expect(visible).not.toContain(CC_01);
      expect(visible).not.toMatch(/appeal packet/i);
      expect(visible).not.toContain("Cook County property tax appeals, built for homeowners.");
      expect(visible).toContain("Cook County assessment records, organized for homeowners.");
      expect(visible).toContain("Official-record compilation, not advice");
      // BL-F2: CC-12 verbatim, alone in its own element, not concatenated or split.
      expect(visible).toContain(CC_12);
      expect(footer).toContain(`<p class="ot-footer-disclaimer">${CC_12}</p>`);
      // No dormant product name or offer promise.
      expect(visible).not.toContain(NEUTRAL_REPORT_NAME);
      expect(visible).not.toContain(NEUTRAL_REPORT_LIMITS);
      expect(visible).not.toMatch(/This report/);
      // Layout and counts preserved; the pricing link stays valid and unchanged.
      for (const label of ["South & West", "North Suburbs", "City of Chicago"]) expect(visible).toContain(label);
      expect(visible).toMatch(/City of Chicago \d+/);
      expect(footer).toContain('href="/#pricing"');
      expect(footer).toContain('href="/refunds"');
      expectNone("footer", visible, [...CYCLE_CLAIMS, ...UPSELL_CLAIMS, ...DIRECTIONAL_CLAIMS]);
    });
  });
});

describe("township OG image", () => {
  it("does not print a reassessment cycle year", () => {
    const src = readFileSync(join(process.cwd(), "app/township/[slug]/opengraph-image.tsx"), "utf8");
    expect(src).not.toMatch(/reassessment cycle`/);
    expect(src).not.toMatch(/cycleYear/);
  });
});

describe("/deadlines body (SSR all-pending fallback)", () => {
  const html = renderToStaticMarkup(<DeadlinesPage snapshot={UNAVAILABLE_INFORMATIONAL_SNAPSHOT} />);
  const visible = text(html);

  it("drops cycle-year district labels, the Cycle column and the overpayment-estimate CTA", () => {
    expectNone("deadlines", visible, [...DIRECTIONAL_CLAIMS, /\b2027 North Suburbs/, /\b2028 City of Chicago/, /\$69/]);
    expect(html).not.toMatch(/<th[^>]*>Cycle<\/th>/);
  });

  // Dropping the Cycle column made the arrow column 5; the mobile rule that hid
  // the old Cycle column must not hide it. Column 3 (the deadline) stays hidden.
  it("the mobile table rule hides only the deadline column, not the arrow column", () => {
    const thead = html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    expect(thead.match(/<th\b/g)).toHaveLength(5);
    const css = readFileSync(join(process.cwd(), "app/ot-design.css"), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 600px) {\n  .ot-tbl th:nth-child(3)"));
    const block = mobile.slice(0, mobile.indexOf("}\n}") + 3);
    expect(block).toContain(".ot-tbl td:nth-child(3)");
    expect(block).not.toMatch(/nth-child\(5\)/);
  });

  it("uses the approved neutral /check strings for the free-check CTA", () => {
    expect(visible).toContain("Free Cook County Property Check");
    expect(visible).toContain("Check my assessment");
    expect(visible).toContain("Free · No account required · Uses public Cook County Assessor records");
  });

  it("keeps the explicit pending fallback and the official calendar link", () => {
    expect(visible).toContain("Pending official date");
    expect(html).toContain(CALENDAR);
  });
});

describe("shared footer", () => {
  it("default footer drops cycle-year labels and keeps CC-18 and the district links", () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    const visible = text(html);
    expect(visible).not.toMatch(/\d{4} cycle/);
    expect(visible).toContain(CC_18);
    for (const label of ["South & West", "North Suburbs", "City of Chicago"]) expect(visible).toContain(label);
    expect(html).toContain('href="/township/jefferson"');
  });
});
