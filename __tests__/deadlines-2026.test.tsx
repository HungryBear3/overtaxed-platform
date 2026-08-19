/**
 * @jest-environment node
 *
 * Proves /deadlines cannot publish a deadline it has not verified.
 *
 * This suite used to assert the opposite shape of the same concern: it pinned
 * sixteen hard-coded 2026 Last File Dates, the constant
 * `TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED`, and the open/closed arithmetic that
 * `lib/deadlines-2026.ts` did for itself. Those were the branch's competing
 * deadline authority — dates with no retrieval time, no content hash, and no
 * parse status — and removing them is the point of this work, so every
 * assertion that depended on them had to change. What replaces them:
 *
 *   - the removed symbols are gone from the module surface, not merely unused;
 *   - against the committed (synthetic) snapshot every township is pending and
 *     no date field exists anywhere in the view model or the rendered page;
 *   - the page says the gap is ours, not the county's;
 *   - and against an injected *verified* snapshot the same code paths do
 *     produce dates, labels, and provenance — so fail-closed here is a
 *     conclusion about the data, not a page that can no longer show anything.
 */
import { renderToStaticMarkup } from "react-dom/server";
import DeadlinesRoutePage from "../app/deadlines/page";
import * as townshipDeadlines from "@/lib/appeals/township-deadlines";
import { ASSESSOR_CALENDAR_URL } from "@/lib/appeals/township-deadlines";
import {
  buildTownship2026Views,
  count2026Views,
  official2026Provenance,
} from "@/lib/deadlines-2026";

const at = (iso: string) => new Date(iso + "T12:00:00Z");

describe("removed deadline authority", () => {
  it("no longer exports a hard-coded schedule or a hand-maintained source date", () => {
    const surface = Object.keys(townshipDeadlines);
    expect(surface).not.toContain("TOWNSHIP_DEADLINES_2025");
    expect(surface).not.toContain("TOWNSHIP_DEADLINES_2026");
    expect(surface).not.toContain("TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED");
    expect(surface).not.toContain("getOfficial2026Deadline");
  });

  it("keeps the neutral official-source link, at the canonical .gov host", () => {
    // A link to the authority's own page is not a claim about a date, and it
    // is what a suppressed projection offers the reader instead of one.
    expect(ASSESSOR_CALENDAR_URL).toBe(
      "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
    );
  });

  it("contains no date literal that could become a fallback", () => {
    // The durable half of the removal: re-adding a fallback here would mean
    // re-adding the data, which is visible in review.
    const source = require("fs").readFileSync(
      require("path").join(process.cwd(), "lib/appeals/township-deadlines.ts"),
      "utf8",
    );
    const body = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(body).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
  });
});

describe("2026 view model against the committed snapshot", () => {
  const views = buildTownship2026Views(at("2026-06-02"));
  const counts = count2026Views(views);

  it("covers the full township roster", () => {
    expect(counts.total).toBe(38);
    expect(views).toHaveLength(38);
  });

  it("verifies nothing, because the committed snapshot is a synthetic fixture", () => {
    expect(counts.official).toBe(0);
    expect(counts.pending).toBe(counts.total);
    expect(counts.open).toBe(0);
    expect(counts.closed).toBe(0);
    expect(counts.upcoming).toBe(0);
    for (const v of views) {
      expect(v.official).toBe(false);
      expect(v.status).toBe("pending");
      expect(v.pendingReason).toBe("synthetic_source");
    }
  });

  it("carries no date field on any pending row", () => {
    // The pending arm has no dates to reach past a boolean for. `1900` is the
    // fixture's placeholder year, so its absence proves the seed did not leak.
    for (const v of views) {
      expect(v.lastFileDate).toBeUndefined();
      expect(v.noticeDate).toBeUndefined();
      expect(v.openDate).toBeUndefined();
      expect(v.lastFileLabel).toBeUndefined();
      expect(v.lastFileLabelShort).toBeUndefined();
      expect(v.openLabel).toBeUndefined();
      expect(v.retrievedAt).toBeUndefined();
      expect(v.daysUntilLastFile).toBeUndefined();
      expect(JSON.stringify(v)).not.toContain("1900");
    }
  });

  it("attributes no source when no row verified", () => {
    // CC-08 wants a source and a retrieval instant wherever a deadline shows.
    // With no deadline showing there is nothing to attribute, and naming one
    // would assert a page we did not read.
    expect(official2026Provenance(views)).toBeNull();
  });
});

describe("/deadlines page render", () => {
  const html = renderToStaticMarkup(DeadlinesRoutePage());

  it("shows the official Assessor calendar source URL", () => {
    expect(html).toContain(ASSESSOR_CALENDAR_URL);
  });

  it("publishes no township deadline date", () => {
    expect(html).not.toMatch(/Last file:/);
    expect(html).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
    expect(html).not.toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+(19|20)\d{2}\b/,
    );
    expect(html).not.toMatch(/1900/);
  });

  it("marks every township pending", () => {
    expect(html).toContain("Pending official date");
    const pendingMatches = html.match(/Pending official date/g) ?? [];
    // One per township in the table and one per township in the grid, plus the
    // copy that names the label. The floor that matters is that no township
    // escaped the label.
    expect(pendingMatches.length).toBeGreaterThanOrEqual(38);
  });

  it("says the gap is ours rather than attributing it to the county", () => {
    expect(html).toMatch(/we have not (verified|read)/i);
    expect(html).not.toMatch(/The 0 townships/);
    // "the county hasn't posted that township yet" is a claim about the
    // Assessor's calendar and is only available once we have read it.
    expect(html).not.toMatch(/county hasn&#x27;t posted/i);
  });

  it("carries verify-before-filing language and the county contact", () => {
    expect(html).toMatch(/confirm[^<]*deadline/i);
    expect(html).toMatch(/before (you )?fil/i);
  });

  it("renders official township boundaries and one status dot per township", () => {
    expect(html).toContain("politicalBoundary/MapServer/export");
    expect(html).toContain("layers=show:3");
    expect(html).toContain("bbox=-88.45,41.45,-87.2055556,42.15");
    expect(html).toContain("size=1600,900");
    expect(html).toContain(
      "Cook County township deadline status dots over official township boundaries",
    );
    const mapDotMatches = html.match(/class="ot-deadline-map-dot ot-deadline-map-dot-/g) ?? [];
    expect(mapDotMatches.length).toBe(38);
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

/**
 * The same view model over an injected verified snapshot.
 *
 * Without this, every assertion above is also satisfied by a page that has been
 * broken into silence. The snapshot is a jest module mock; the committed
 * `data/deadlines/cook-county.json` is untouched and stays synthetic.
 */
describe("2026 view model over a verified snapshot", () => {
  function snapshotAt(retrievedAt: string) {
    const source = {
      authority: "cook_county_assessor",
      sourceUrl:
        "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      retrievedAt,
      sourceUpdatedAt: null,
      contentSha256: "b".repeat(64),
      httpStatus: 200,
      finalUrl:
        "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      parseStatus: "ok",
      parserVersion: "1.0.0",
    };
    const stage = (openDate: string, lastFileDate: string) => ({
      assessor: { noticeDate: "2026-05-01", openDate, lastFileDate },
    });
    return {
      schemaVersion: 1,
      synthetic: false,
      sources: { assessor: source, bor: source },
      townships: {
        "oak-park": { townshipName: "Oak Park", stages: stage("2026-05-18", "2026-06-18") },
        "river-forest": { townshipName: "River Forest", stages: stage("2026-05-04", "2026-06-02") },
        "norwood-park": { townshipName: "Norwood Park", stages: stage("2026-04-27", "2026-05-26") },
      },
    };
  }

  function viewsAt(nowIso: string) {
    let result: {
      views: ReturnType<typeof buildTownship2026Views>;
      counts: ReturnType<typeof count2026Views>;
      provenance: ReturnType<typeof official2026Provenance>;
    };
    jest.isolateModules(() => {
      jest.doMock("@/data/deadlines/cook-county.json", () =>
        snapshotAt(new Date(Date.parse(nowIso) - 5000).toISOString()),
      );
      const mod = require("@/lib/deadlines-2026");
      const views = mod.buildTownship2026Views(new Date(nowIso));
      result = {
        views,
        counts: mod.count2026Views(views),
        provenance: mod.official2026Provenance(views),
      };
    });
    return result!;
  }

  afterEach(() => {
    jest.resetModules();
    jest.dontMock("@/data/deadlines/cook-county.json");
  });

  it("marks exactly the verified townships official and leaves the rest pending", () => {
    const { views, counts } = viewsAt("2026-06-02T17:00:00.000Z");
    expect(counts.official).toBe(3);
    expect(counts.pending).toBe(counts.total - 3);
    const oakPark = views.find((v) => v.slug === "oak-park")!;
    expect(oakPark.official).toBe(true);
    expect(oakPark.lastFileDate).toBe("2026-06-18");
    expect(oakPark.lastFileLabel).toBe("June 18, 2026");
    const proviso = views.find((v) => v.slug === "proviso")!;
    expect(proviso.official).toBe(false);
    expect(proviso.status).toBe("pending");
    expect(proviso.lastFileDate).toBeUndefined();
  });

  it("derives status from the canonical projection, not its own arithmetic", () => {
    // 2026-06-02 17:00Z is 12:00 Chicago on the River Forest last-file day.
    const { views } = viewsAt("2026-06-02T17:00:00.000Z");
    expect(views.find((v) => v.slug === "river-forest")!.status).toBe("open");
    expect(views.find((v) => v.slug === "norwood-park")!.status).toBe("closed");
    expect(views.find((v) => v.slug === "oak-park")!.status).toBe("open");
  });

  it("runs no countdown for an anonymous reader", () => {
    const { views } = viewsAt("2026-06-02T17:00:00.000Z");
    for (const v of views) {
      expect(v.daysUntilLastFile).toBeUndefined();
    }
  });

  it("attributes the oldest retrieval behind the rows it shows", () => {
    const { provenance } = viewsAt("2026-06-02T17:00:00.000Z");
    expect(provenance).not.toBeNull();
    expect(provenance!.source).toBe("the Cook County Assessor");
    expect(provenance!.retrievedAt).toBe("2026-06-02T16:59:55.000Z");
  });
});
