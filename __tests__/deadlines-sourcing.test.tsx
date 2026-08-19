/**
 * @jest-environment node
 *
 * Guards the /deadlines page against unsourced hard deadline claims.
 *
 * The township windows shown on the page are an indicative planning aid, not a
 * verified per-year county feed. These tests pin that the page (a) does not
 * publish those dates as machine-readable Event structured data, (b) does not
 * assert the dates are "tracked from" official records, and (c) always carries
 * verify-before-filing language plus a link to the official county source.
 */
import { renderToStaticMarkup } from "react-dom/server";
import DeadlinesRoutePage from "../app/deadlines/page";
import {
  OFFICIAL_DEADLINE_SOURCES,
  DEADLINE_PENDING_NOTICE,
  ASSESSOR_CALENDAR_URL,
} from "@/lib/deadline-sources";

function renderPage(): string {
  return renderToStaticMarkup(DeadlinesRoutePage());
}

describe("/deadlines sourcing safety", () => {
  it("emits no Event JSON-LD with specific appeal dates", () => {
    const html = renderPage();
    const scripts = [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ].map((m) => m[1]);
    for (const script of scripts) {
      expect(script).not.toContain('"@type":"Event"');
      expect(script).not.toContain("startDate");
      expect(script).not.toContain("endDate");
    }
  });

  it("drops the unsupported 'tracked from ... records' sourcing claim", () => {
    const html = renderPage();
    expect(html).not.toMatch(/tracked from public Cook County Board of Review records/i);
  });

  it("carries verify-before-filing language", () => {
    const html = renderPage();
    expect(html).toMatch(/confirm[^<]*deadline/i);
    expect(html).toMatch(/before (you )?fil/i);
  });

  it("links to the official Cook County Assessor calendar", () => {
    const html = renderPage();
    expect(html).toContain(ASSESSOR_CALENDAR_URL);
  });

  it("shows the official OverTaxed IL contact, not a personal name", () => {
    const html = renderPage();
    expect(html).toContain("support@overtaxed-il.com");
    expect(html).toContain("(847) 461-3189");
  });
});

describe("official deadline sources data", () => {
  it("only lists official, https county sources", () => {
    expect(OFFICIAL_DEADLINE_SOURCES.length).toBeGreaterThan(0);
    for (const s of OFFICIAL_DEADLINE_SOURCES) {
      expect(s.href).toMatch(/^https:\/\//);
      expect(s.href).toMatch(/cookcounty(assessoril\.gov|boardofreview\.com)/);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.note.length).toBeGreaterThan(0);
    }
  });

  it("cites the Assessor only at the canonical .gov host", () => {
    // Controller ruling 2026-08-19: `cookcountyassessor.com` and bare-host
    // variants redirect to `www.cookcountyassessoril.gov`, which is the one
    // authorized spelling. A second host reads to a homeowner as a second
    // corroborating source when it is the same page.
    expect(ASSESSOR_CALENDAR_URL).toBe(
      "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
    );
    for (const s of OFFICIAL_DEADLINE_SOURCES) {
      expect(s.href).not.toContain("cookcountyassessor.com");
    }
  });

  it("pending notice withholds the date instead of disclaiming it", () => {
    // Replaces the old DEADLINE_VERIFY_NOTICE assertions. That notice sat next
    // to a rendered seed date and called it "not an official deadline", which
    // transferred the risk to the reader without removing it. The replacement
    // has to say no date is being shown at all.
    expect(DEADLINE_PENDING_NOTICE).toMatch(/not verified/i);
    expect(DEADLINE_PENDING_NOTICE).toMatch(/not showing one/i);
    expect(DEADLINE_PENDING_NOTICE).toMatch(/confirm/i);
    expect(DEADLINE_PENDING_NOTICE).toMatch(/official county source/i);
    // And it must not itself carry a date a reader could plan around.
    expect(DEADLINE_PENDING_NOTICE).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(DEADLINE_PENDING_NOTICE).not.toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/,
    );
  });
});
