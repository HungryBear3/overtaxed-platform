/**
 * @jest-environment node
 *
 * Proves /deadlines shows ONLY official Tax Year 2026 Cook County Assessor data:
 *   - a township-specific date appears only when sourced from the official 2026 map
 *   - pending townships show "Pending official date" (never inferred / prior-year)
 *   - the official source URL is visible
 *   - stale 2025 data is never surfaced or labeled 2026
 *   - no JSON-LD publishes township Event dates
 */
import { renderToStaticMarkup } from "react-dom/server";
import DeadlinesRoutePage from "../app/deadlines/page";
import {
  TOWNSHIP_DEADLINES_2026,
  TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED,
  getOfficial2026Deadline,
  ASSESSOR_CALENDAR_URL,
} from "@/lib/appeals/township-deadlines";
import {
  buildTownship2026Views,
  count2026Views,
} from "@/lib/deadlines-2026";

const at = (iso: string) => new Date(iso + "T12:00:00Z");

describe("official 2026 deadline data", () => {
  it("every entry is a 2026 date (no stale prior-year data)", () => {
    for (const [name, d] of Object.entries(TOWNSHIP_DEADLINES_2026)) {
      expect(d.noticeDate.startsWith("2026-")).toBe(true);
      expect(d.lastFileDate.startsWith("2026-")).toBe(true);
      expect(name).toBe(name.toLowerCase());
    }
  });

  it("matches the official calendar for corroborated townships", () => {
    expect(getOfficial2026Deadline("Oak Park")?.lastFileDate).toBe("2026-06-18");
    expect(getOfficial2026Deadline("Riverside")?.lastFileDate).toBe("2026-06-08");
    expect(getOfficial2026Deadline("River Forest")?.lastFileDate).toBe("2026-06-02");
    // Source URL is the official Assessor calendar.
    expect(getOfficial2026Deadline("Oak Park")?.calendarUrl).toBe(ASSESSOR_CALENDAR_URL);
    expect(ASSESSOR_CALENDAR_URL).toContain("cookcountyassessoril.gov");
    expect(TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED).toBe("2026-06-02");
  });

  it("normalizes the Township suffix", () => {
    expect(getOfficial2026Deadline("Oak Park Township")?.lastFileDate).toBe("2026-06-18");
  });

  it("maps the roster's 'Lake View' to the official 'Lakeview' entry (no regression)", () => {
    // The Assessor calendar spells it "Lakeview" (one word); our roster uses
    // "Lake View" (two words). The roster spelling must resolve to the official
    // 2026 date, and the data key must stay roster-aligned, not "lakeview".
    expect(getOfficial2026Deadline("Lake View")?.lastFileDate).toBe("2026-07-13");
    expect(getOfficial2026Deadline("Lake View Township")?.lastFileDate).toBe("2026-07-13");
    expect(Object.keys(TOWNSHIP_DEADLINES_2026)).toContain("lake view");
    expect(Object.keys(TOWNSHIP_DEADLINES_2026)).not.toContain("lakeview");
    // And the roster actually carries that spelling, so the join holds.
    const lakeView = buildTownship2026Views(at("2026-06-02")).find((v) => v.slug === "lake-view");
    expect(lakeView?.name).toBe("Lake View");
    expect(lakeView?.official).toBe(true);
  });

  it("returns null (pending) for townships with no published 2026 date", () => {
    expect(getOfficial2026Deadline("Palos")).toBeNull();
    expect(getOfficial2026Deadline("Cicero")).toBeNull();
    expect(getOfficial2026Deadline("")).toBeNull();
  });
});

describe("2026 view model", () => {
  const views = buildTownship2026Views(at("2026-06-02"));
  const counts = count2026Views(views);

  it("marks exactly the official townships and leaves the rest pending", () => {
    expect(counts.official).toBe(Object.keys(TOWNSHIP_DEADLINES_2026).length);
    expect(counts.official).toBe(9);
    expect(counts.pending).toBe(counts.total - counts.official);
  });

  it("pending townships carry no date fields", () => {
    const palos = views.find((v) => v.slug === "palos")!;
    expect(palos.official).toBe(false);
    expect(palos.status).toBe("pending");
    expect(palos.lastFileDate).toBeUndefined();
    expect(palos.lastFileLabel).toBeUndefined();
  });

  it("derives open/closed from the official last-file date vs now", () => {
    const riverForest = views.find((v) => v.slug === "river-forest")!;
    const norwood = views.find((v) => v.slug === "norwood-park")!;
    const oakPark = views.find((v) => v.slug === "oak-park")!;
    expect(riverForest.status).toBe("open"); // last file 6/2, now 6/2 → open
    expect(norwood.status).toBe("closed"); // last file 5/26 → past
    expect(oakPark.status).toBe("open");
    expect(oakPark.lastFileLabel).toBe("June 18, 2026");
  });
});

describe("/deadlines page render", () => {
  const html = renderToStaticMarkup(DeadlinesRoutePage());

  it("shows the official Assessor calendar source URL", () => {
    expect(html).toContain(ASSESSOR_CALENDAR_URL);
  });

  it("shows official 2026 dates for published townships", () => {
    expect(html).toContain("June 18, 2026"); // Oak Park official last file date
    expect(html).toMatch(/9 townships/); // hero count of officially-published townships
  });

  it("shows pending copy and never invents a date", () => {
    expect(html).toContain("Pending official date");
    // Exactly the 9 official townships render a "Last file:" date in the table.
    const lastFileMatches = html.match(/Last file:/g) ?? [];
    expect(lastFileMatches.length).toBe(9);
  });

  it("never surfaces stale 2025 data", () => {
    expect(html).not.toMatch(/2025/);
  });

  it("publishes no Event JSON-LD with appeal dates", () => {
    const scripts = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((m) => m[1]);
    for (const script of scripts) {
      expect(script).not.toContain('"@type":"Event"');
      expect(script).not.toContain("startDate");
    }
  });
});
