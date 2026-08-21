/**
 * @jest-environment node
 *
 * The free check's view of a township filing window.
 *
 * These four cases used to assert hard-coded 2026 Assessor dates for Lake View,
 * Berwyn and Maine, and `future_cycle` for North Chicago. All of it came from
 * the hard-coded schedule this branch removes, and `future_cycle` was the
 * status that made "we have no row for this township" render as "your window is
 * later this cycle" — the collapse the `unknown` status exists to undo.
 *
 * What is asserted now: against the committed snapshot the module verifies
 * nothing and says so with a reason; against an injected verified snapshot it
 * produces the same dates and statuses it always did; and `allowCheckout` turns
 * on for an official property record and for nothing else.
 */
import {
  getFreeCheckAppealWindowStatus,
  appealWindowForIdentity,
} from "@/lib/free-check-appeal-window";
import type { TownshipResolution } from "@/lib/deadlines/township-resolution";

const ASSESSOR_CALENDAR_URL =
  "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";

describe("against the committed snapshot", () => {
  it.each(["Lake View", "Berwyn", "Maine", "North Chicago"])(
    "reports %s unknown with the reason, and no date",
    (township) => {
      const status = getFreeCheckAppealWindowStatus(
        township,
        new Date("2026-07-12T12:00:00Z"),
      );
      expect(status.township).toBe(township);
      expect(status.status).toBe("unknown");
      expect(status.openDate).toBeNull();
      expect(status.closeDate).toBeNull();
      expect(status.pendingReason).toBe("synthetic_source");
      expect(status.allowCheckout).toBe(false);
      expect(status.note).toContain(ASSESSOR_CALENDAR_URL);
    },
  );

  it("distinguishes an unresolved township from an unverified one", () => {
    // The old `future_cycle` status answered both with the same word.
    const noInput = getFreeCheckAppealWindowStatus("", new Date("2026-07-12T12:00:00Z"));
    expect(noInput.status).toBe("unknown");
    expect(noInput.pendingReason).toBe("township_unresolved");

    const named = getFreeCheckAppealWindowStatus("Berwyn", new Date("2026-07-12T12:00:00Z"));
    expect(named.pendingReason).toBe("synthetic_source");
  });

  it("never authorizes checkout, whatever identity is presented", () => {
    const resolution: TownshipResolution = {
      inputKind: "pin",
      normalizedPin: "16334020310000",
      normalizedAddress: null,
      townshipKey: "berwyn",
      townshipName: "Berwyn",
      resolutionSource: "official_property_record",
      resolvedAt: "2026-07-12T11:59:55.000Z",
    };
    expect(
      appealWindowForIdentity(resolution, new Date("2026-07-12T12:00:00Z")).allowCheckout,
    ).toBe(false);
  });
});

describe("against a verified snapshot", () => {
  const OPEN_TOWNSHIP = { key: "lake-view", name: "Lake View" };

  function snapshotAt(retrievedAt: string) {
    const source = {
      authority: "cook_county_assessor",
      sourceUrl: ASSESSOR_CALENDAR_URL,
      retrievedAt,
      sourceUpdatedAt: null,
      contentSha256: "c".repeat(64),
      httpStatus: 200,
      finalUrl: ASSESSOR_CALENDAR_URL,
      parseStatus: "ok",
      parserVersion: "1.0.0",
    };
    const stage = (openDate: string, lastFileDate: string) => ({
      assessor: { noticeDate: null, openDate, lastFileDate },
    });
    return {
      schemaVersion: 1,
      synthetic: false,
      sources: { assessor: source, bor: source },
      townships: {
        "lake-view": { townshipName: "Lake View", stages: stage("2026-05-28", "2026-07-13") },
        berwyn: { townshipName: "Berwyn", stages: stage("2026-05-20", "2026-07-06") },
        maine: { townshipName: "Maine", stages: stage("2026-08-05", "2026-09-21") },
      },
    };
  }

  function windowAt(township: string, nowIso: string) {
    let status: ReturnType<typeof getFreeCheckAppealWindowStatus>;
    jest.isolateModules(() => {
      jest.doMock("@/data/deadlines/cook-county.json", () =>
        snapshotAt(new Date(Date.parse(nowIso) - 5000).toISOString()),
      );
      const mod = require("@/lib/free-check-appeal-window");
      status = mod.getFreeCheckAppealWindowStatus(township, new Date(nowIso));
    });
    return status!;
  }

  function windowForIdentityAt(resolution: TownshipResolution, nowIso: string) {
    let status: ReturnType<typeof appealWindowForIdentity>;
    jest.isolateModules(() => {
      jest.doMock("@/data/deadlines/cook-county.json", () =>
        snapshotAt(new Date(Date.parse(nowIso) - 5000).toISOString()),
      );
      const mod = require("@/lib/free-check-appeal-window");
      status = mod.appealWindowForIdentity(resolution, new Date(nowIso));
    });
    return status!;
  }

  afterEach(() => {
    jest.resetModules();
    jest.dontMock("@/data/deadlines/cook-county.json");
  });

  it("reports an open window with both of its dates", () => {
    expect(windowAt(OPEN_TOWNSHIP.name, "2026-07-12T12:00:00.000Z")).toEqual(
      expect.objectContaining({
        township: "Lake View",
        status: "open",
        openDate: "2026-05-28",
        closeDate: "2026-07-13",
        pendingReason: null,
      }),
    );
  });

  it("marks a window closed after its last-file date", () => {
    expect(windowAt("Berwyn", "2026-07-14T12:00:00.000Z")).toEqual(
      expect.objectContaining({
        township: "Berwyn",
        status: "closed",
        openDate: "2026-05-20",
        closeDate: "2026-07-06",
        pendingReason: null,
      }),
    );
  });

  it("marks a window upcoming before it opens, rather than 'future cycle'", () => {
    expect(windowAt("Maine", "2026-07-14T12:00:00.000Z")).toEqual(
      expect.objectContaining({
        township: "Maine",
        status: "upcoming",
        openDate: "2026-08-05",
        closeDate: "2026-09-21",
        pendingReason: null,
      }),
    );
  });

  it("stays unknown for a township the snapshot does not carry", () => {
    const status = windowAt("North Chicago", "2026-07-14T12:00:00.000Z");
    expect(status.status).toBe("unknown");
    expect(status.openDate).toBeNull();
    expect(status.closeDate).toBeNull();
    expect(status.pendingReason).toBe("township_missing");
  });

  it("cites the retrieval instant behind a verified window", () => {
    const status = windowAt(OPEN_TOWNSHIP.name, "2026-07-12T12:00:00.000Z");
    expect(status.note).toContain("2026-07-12T11:59:55.000Z");
    expect(status.note).toContain("Cook County Assessor");
  });

  it("opens checkout only for an official property record, never for a name", () => {
    const byName = windowAt(OPEN_TOWNSHIP.name, "2026-07-12T12:00:00.000Z");
    expect(byName.status).toBe("open");
    expect(byName.allowCheckout).toBe(false);

    const resolution: TownshipResolution = {
      inputKind: "pin",
      normalizedPin: "14283040110000",
      normalizedAddress: null,
      townshipKey: OPEN_TOWNSHIP.key,
      townshipName: OPEN_TOWNSHIP.name,
      resolutionSource: "official_property_record",
      resolvedAt: "2026-07-12T11:59:55.000Z",
    };
    expect(
      windowForIdentityAt(resolution, "2026-07-12T12:00:00.000Z").allowCheckout,
    ).toBe(true);
  });

  it("closes checkout for a property record whose window is not open", () => {
    const resolution: TownshipResolution = {
      inputKind: "pin",
      normalizedPin: "16334020310000",
      normalizedAddress: null,
      townshipKey: "berwyn",
      townshipName: "Berwyn",
      resolutionSource: "official_property_record",
      resolvedAt: "2026-07-14T11:59:55.000Z",
    };
    const status = windowForIdentityAt(resolution, "2026-07-14T12:00:00.000Z");
    expect(status.status).toBe("closed");
    expect(status.allowCheckout).toBe(false);
  });
});
