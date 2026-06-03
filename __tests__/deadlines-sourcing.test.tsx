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
  DEADLINE_VERIFY_NOTICE,
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
      expect(s.href).toMatch(/cookcounty(assessoril\.gov|assessor\.com|boardofreview\.com)/);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.note.length).toBeGreaterThan(0);
    }
  });

  it("verify notice tells users to confirm with the official source", () => {
    expect(DEADLINE_VERIFY_NOTICE).toMatch(/confirm/i);
    expect(DEADLINE_VERIFY_NOTICE).toMatch(/official/i);
    expect(DEADLINE_VERIFY_NOTICE).toMatch(/not an official deadline/i);
  });
});
