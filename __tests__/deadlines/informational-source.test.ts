/** @jest-environment node */

import {
  describeTownshipCalendar,
  projectTownshipDeadline,
} from "@/lib/appeals/township-deadlines";
import { buildTownship2026Views, count2026Views } from "@/lib/deadlines-2026";
import type {
  OfficialDeadlineSnapshot,
  SourceProvenance,
} from "@/lib/deadlines/official-source-state";
import type { TownshipResolution } from "@/lib/deadlines/township-resolution";

const NOW = "2026-06-02T17:00:00.000Z";
const SOURCE_URL =
  "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";

function provenance(over: Partial<SourceProvenance> = {}): SourceProvenance {
  return {
    authority: "cook_county_assessor",
    sourceUrl: SOURCE_URL,
    retrievedAt: "2026-06-02T16:55:00.000Z",
    sourceUpdatedAt: "2026-05-20T00:00:00.000Z",
    contentSha256: "c".repeat(64),
    httpStatus: 200,
    finalUrl: SOURCE_URL,
    parseStatus: "ok",
    parserVersion: "test-fixture",
    ...over,
  };
}

function snapshot(
  over: Partial<OfficialDeadlineSnapshot> = {},
): OfficialDeadlineSnapshot {
  return {
    schemaVersion: 1,
    // Local synthetic fixture: hypothetical Cook County Assessor calendar parse
    // shaped like a real retrieval, not an official capture or deployment stamp.
    synthetic: false,
    sources: { assessor: provenance(), bor: null },
    townships: {
      "oak-park": {
        townshipName: "Oak Park",
        stages: {
          assessor: {
            noticeDate: "2026-05-20",
            openDate: "2026-05-25",
            lastFileDate: "2026-06-08",
          },
        },
      },
    },
    ...over,
  };
}

const propertyRecord: TownshipResolution = {
  inputKind: "pin",
  normalizedPin: "16071234560000",
  normalizedAddress: null,
  townshipKey: "oak-park",
  townshipName: "Oak Park",
  resolutionSource: "official_property_record",
  resolvedAt: NOW,
};

describe("informational snapshot injection", () => {
  it("projects an explicitly injected fresh snapshot without mutating the default snapshot", () => {
    const injected = snapshot();

    const injectedProjection = describeTownshipCalendar(
      "Oak Park Township",
      NOW,
      "assessor",
      injected,
    );
    expect(injectedProjection.available).toBe(true);
    if (!injectedProjection.available)
      throw new Error("expected injected snapshot to verify");
    expect(injectedProjection.eligible).toBe(false);
    expect(injectedProjection.allowCheckout).toBe(false);
    expect(injectedProjection.allowReminderSignup).toBe(false);
    expect(injectedProjection.showCountdown).toBe(false);
    expect(injectedProjection.lastFileDate).toBe("2026-06-08");

    const views = buildTownship2026Views(new Date(NOW), injected);
    const oakPark = views.find((view) => view.slug === "oak-park");
    expect(count2026Views(views).official).toBe(1);
    expect(oakPark).toMatchObject({
      official: true,
      status: "open",
      lastFileDate: "2026-06-08",
      allowReminderSignup: false,
    });
    expect(oakPark?.daysUntilLastFile).toBeUndefined();

    const defaultProjection = describeTownshipCalendar(
      "Oak Park Township",
      NOW,
    );
    expect(defaultProjection.available).toBe(false);
    expect(defaultProjection.available || defaultProjection.reason).toBe(
      "synthetic_source",
    );
  });

  it("does not let informational injection enable property-record checkout", () => {
    const injected = snapshot();
    const informational = describeTownshipCalendar(
      "Oak Park",
      NOW,
      "assessor",
      injected,
    );
    const property = projectTownshipDeadline({
      township: propertyRecord,
      stage: "assessor",
      at: NOW,
    });

    expect(informational.available).toBe(true);
    expect(informational.available && informational.allowCheckout).toBe(false);
    expect(property.available).toBe(false);
    expect(property.available || property.reason).toBe("synthetic_source");
  });

  it("suppresses an open-window projection after the next Chicago calendar day", () => {
    const staleNextDay = describeTownshipCalendar(
      "Oak Park",
      "2026-06-03T05:01:00.000Z",
      "assessor",
      snapshot(),
    );

    expect(staleNextDay.available).toBe(false);
    expect(staleNextDay.available || staleNextDay.reason).toBe("source_stale");
  });

  it("applies the canonical 24-hour TTL when the window is far off", () => {
    const farWindow = snapshot({
      sources: {
        assessor: provenance({
          retrievedAt: "2026-06-01T16:00:00.000Z",
          sourceUpdatedAt: "2026-05-20T00:00:00.000Z",
        }),
        bor: null,
      },
      townships: {
        "oak-park": {
          townshipName: "Oak Park",
          stages: {
            assessor: {
              noticeDate: "2026-05-20",
              openDate: "2026-08-01",
              lastFileDate: "2026-08-31",
            },
          },
        },
      },
    });

    const projection = describeTownshipCalendar(
      "Oak Park",
      NOW,
      "assessor",
      farWindow,
    );
    expect(projection.available).toBe(false);
    expect(projection.available || projection.reason).toBe("source_stale");
  });

  it.each([
    [
      "missing provenance",
      { sources: { assessor: null, bor: null } },
      "source_unavailable",
    ],
    [
      "future provenance",
      {
        sources: {
          assessor: provenance({ retrievedAt: "2026-06-02T17:01:00.000Z" }),
          bor: null,
        },
      },
      "source_from_future",
    ],
    [
      "invalid provenance",
      {
        sources: {
          assessor: provenance({ contentSha256: "not-a-hash" }),
          bor: null,
        },
      },
      "parse_failed",
    ],
    ["synthetic data", { synthetic: true }, "synthetic_source"],
  ] as const)("refuses %s", (_label, over, reason) => {
    const projection = describeTownshipCalendar(
      "Oak Park",
      NOW,
      "assessor",
      snapshot(over as Partial<OfficialDeadlineSnapshot>),
    );

    expect(projection.available).toBe(false);
    expect(projection.available || projection.reason).toBe(reason);
  });
});
