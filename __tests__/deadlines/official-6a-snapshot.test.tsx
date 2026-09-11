/**
 * @jest-environment node
 *
 * Release fixture for the hand-verified 2026-09-11 Assessor snapshot.
 * The general fail-closed suites inject their own synthetic fixture; this file
 * alone binds the production data file to the eight rows verified for 6a.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { dynamic as deadlinesRouteRendering } from "@/app/deadlines/page";
import TownshipRoute, { generateMetadata } from "@/app/township/[slug]/page";
import snapshotJson from "@/data/deadlines/cook-county.json";
import { evaluateOfficialDeadlineState, type OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";
import { buildTownship2026Views, count2026Views, official2026Provenance } from "@/lib/deadlines-2026";

const snapshot = snapshotJson as OfficialDeadlineSnapshot;
const evaluatedAt = "2026-09-11T08:25:00.000Z";

const expected = {
  barrington: {
    name: "Barrington",
    notice: "2026-08-11",
    lastFile: "2026-09-23",
  },
  bremen: { name: "Bremen", notice: "2026-08-12", lastFile: "2026-09-24" },
  lemont: { name: "Lemont", notice: "2026-08-17", lastFile: "2026-09-29" },
  calumet: { name: "Calumet", notice: "2026-08-20", lastFile: "2026-10-02" },
  "hyde-park": {
    name: "Hyde Park",
    notice: "2026-08-26",
    lastFile: "2026-10-08",
  },
  leyden: { name: "Leyden", notice: "2026-08-31", lastFile: "2026-10-14" },
  worth: { name: "Worth", notice: "2026-09-01", lastFile: "2026-10-15" },
  wheeling: { name: "Wheeling", notice: "2026-09-09", lastFile: "2026-10-22" },
} as const;

describe("OT deadline release 6a snapshot", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(evaluatedAt));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("contains only the eight hand-verified Assessor rows and no BOR authority", () => {
    expect(snapshot.synthetic).toBe(false);
    expect(snapshot.sources.assessor).toEqual(
      expect.objectContaining({
        authority: "cook_county_assessor",
        retrievedAt: "2026-09-11T08:19:28.891Z",
        sourceUpdatedAt: "2026-09-09T00:00:00-05:00",
        httpStatus: 200,
        parseStatus: "ok",
        parserVersion: "manual-6a-2026-09-11",
      }),
    );
    expect(snapshot.sources.bor).toBeUndefined();
    expect(Object.keys(snapshot.townships).sort()).toEqual(Object.keys(expected).sort());

    for (const [slug, row] of Object.entries(expected)) {
      expect(snapshot.townships[slug]).toEqual({
        townshipName: row.name,
        stages: {
          assessor: {
            noticeDate: row.notice,
            openDate: row.notice,
            lastFileDate: row.lastFile,
          },
        },
      });
    }
  });

  it("renders exactly eight open official rows and keeps the other 30 pending", () => {
    const views = buildTownship2026Views(new Date(evaluatedAt));
    expect(count2026Views(views)).toEqual({
      open: 8,
      closed: 0,
      upcoming: 0,
      pending: 30,
      official: 8,
      total: 38,
    });
    expect(official2026Provenance(views)).toEqual({
      source: "the Cook County Assessor",
      retrievedAt: "2026-09-11T08:19:28.891Z",
    });
  });

  it.each(Object.entries(expected))(
    "/township/%s is indexable and carries its verified last-file date",
    async (slug, row) => {
      const metadata = await generateMetadata({
        params: Promise.resolve({ slug }),
      });
      expect(metadata.robots).toEqual({ index: true, follow: true });
      expect(metadata.alternates?.canonical).toBe(`https://www.overtaxed-il.com/township/${slug}`);

      const longDate = new Date(`${row.lastFile}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
      expect(metadata.description).toContain(longDate);

      const html = renderToStaticMarkup(await TownshipRoute({ params: Promise.resolve({ slug }) }));
      expect(html).toContain(longDate);
      expect(html).toContain("Cook County Assessor");
    },
  );

  it("closes each row from date arithmetic without retaining an open state", () => {
    const onBarringtonClosePlusOne = "2026-09-24T05:05:00.000Z";
    const refreshed: OfficialDeadlineSnapshot = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        assessor: {
          ...snapshot.sources.assessor!,
          retrievedAt: "2026-09-24T05:00:00.000Z",
        },
      },
    };
    const state = evaluateOfficialDeadlineState({
      snapshot: refreshed,
      township: {
        townshipKey: "barrington",
        townshipName: "Barrington",
        resolutionSource: "page_slug",
      },
      stage: "assessor",
      evaluatedAt: onBarringtonClosePlusOne,
    });
    expect(state).toEqual(expect.objectContaining({ kind: "verified", status: "closed" }));
    expect(deadlinesRouteRendering).toBe("force-dynamic");
  });
});
