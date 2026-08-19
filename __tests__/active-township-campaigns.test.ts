import {
  ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS,
  buildCampaignFreeCheckHref,
  getActiveTownshipCampaign,
} from "@/lib/marketing/active-township-campaigns";
import {
  TOWNSHIP_FOLLOWUP_DRAFTS,
  TOWNSHIP_FOLLOWUP_STATUS,
} from "@/lib/marketing/township-followup-drafts";

describe("four township campaign funnels", () => {
  it("contains exactly the approved township set", () => {
    expect(ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS).toEqual([
      "cicero",
      "elk-grove",
      "stickney",
      "west-chicago",
    ]);
  });

  it.each(ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS)(
    "keeps %s reachable and dateless while the snapshot is unverified",
    (slug) => {
      // Was: an it.each pinning a hard-coded Last File Date per township and
      // the Chicago-midnight active→expired flip. Those dates were the
      // hard-coded 2026 map that this branch removes, so the assertion could
      // only pass by keeping a second deadline authority alive in this module.
      // What the committed (synthetic) snapshot must produce instead is a
      // campaign that still resolves — these four URLs are indexed and paid —
      // and carries no date at all. Phase mapping and the midnight boundary
      // move to the fixture-driven test below.
      const campaign = getActiveTownshipCampaign(
        slug,
        new Date("2026-07-22T12:00:00Z"),
      );
      expect(campaign).not.toBeNull();
      expect(campaign!.official).toBe(false);
      expect(campaign!.phase).toBe("pending");
      expect(campaign).not.toHaveProperty("lastFileDate");
      expect(campaign).not.toHaveProperty("noticeDate");
      expect(campaign).not.toHaveProperty("daysRemaining");
      expect(campaign).not.toHaveProperty("retrievedAt");
      expect(campaign!.calendarUrl).toBe(
        "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      );
    },
  );

  it("adds bounded UTM attribution to the free-check CTA", () => {
    const campaign = getActiveTownshipCampaign(
      "cicero",
      new Date("2026-07-22T12:00:00Z"),
    )!;
    const href = buildCampaignFreeCheckHref(campaign, "hero");
    expect(href).toContain("utm_source=township_deadline_page");
    expect(href).toContain("utm_medium=organic");
    expect(href).toContain("utm_campaign=ot_2026_cicero_deadline");
    expect(href).toContain("utm_content=hero");
    expect(href.endsWith("#hero-check")).toBe(true);
  });
});

describe("follow-up content safety", () => {
  it("remains an inert draft with consent and deadline suppression", () => {
    expect(TOWNSHIP_FOLLOWUP_STATUS).toBe("DRAFT_NOT_ACTIVATED");
    const sms = TOWNSHIP_FOLLOWUP_DRAFTS.filter(
      (step) => step.channel === "sms",
    );
    expect(sms).toHaveLength(1);
    expect(sms[0].suppressWhen).toContain("no_express_sms_consent");
    for (const step of TOWNSHIP_FOLLOWUP_DRAFTS) {
      expect(step.suppressWhen).toContain("deadline_closed");
    }
  });
});

/**
 * Phase mapping against a verified snapshot.
 *
 * The campaign module performs no date arithmetic — it reads `status` off the
 * canonical projection — so this proves the mapping and the boundary that used
 * to be asserted with hard-coded dates. The snapshot is injected as a module
 * mock; nothing here is written to `data/deadlines/cook-county.json`, and the
 * committed file stays synthetic.
 */
describe("phase mapping over a verified snapshot", () => {
  const LAST_FILE = "2026-07-31";
  const OPEN = "2026-06-01";

  /** A non-synthetic snapshot whose retrieval instant is `retrievedAt`. */
  function snapshotAt(retrievedAt: string) {
    const source = {
      authority: "cook_county_assessor",
      sourceUrl:
        "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      retrievedAt,
      sourceUpdatedAt: null,
      contentSha256: "a".repeat(64),
      httpStatus: 200,
      finalUrl:
        "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      parseStatus: "ok",
      parserVersion: "1.0.0",
    };
    return {
      schemaVersion: 1,
      synthetic: false,
      sources: { assessor: source, bor: source },
      townships: {
        cicero: {
          townshipName: "Cicero",
          stages: {
            assessor: {
              noticeDate: "2026-05-01",
              openDate: OPEN,
              lastFileDate: LAST_FILE,
            },
          },
        },
      },
    };
  }

  /** Read the campaign with the fixture snapshot in place at instant `nowIso`. */
  function campaignAt(nowIso: string) {
    let campaign: unknown;
    jest.isolateModules(() => {
      jest.doMock("@/data/deadlines/cook-county.json", () =>
        snapshotAt(new Date(Date.parse(nowIso) - 5000).toISOString()),
      );
      const mod = require("@/lib/marketing/active-township-campaigns");
      campaign = mod.getActiveTownshipCampaign("cicero", new Date(nowIso));
    });
    return campaign as ReturnType<typeof getActiveTownshipCampaign>;
  }

  afterEach(() => {
    jest.resetModules();
    jest.dontMock("@/data/deadlines/cook-county.json");
  });

  it("reports the verified window and its provenance", () => {
    const campaign = campaignAt("2026-07-30T12:00:00.000Z")!;
    expect(campaign.official).toBe(true);
    expect(campaign.phase).toBe("active");
    expect((campaign as { lastFileDate: string }).lastFileDate).toBe(LAST_FILE);
    expect((campaign as { retrievedAt: string }).retrievedAt).toBe(
      "2026-07-30T11:59:55.000Z",
    );
  });

  it("runs no countdown on a campaign page even when the window is verified", () => {
    // The reader is anonymous, so this is the informational tier: a date may
    // be described, a countdown may not. `null`, not `0` — `0` is the value a
    // page renders as "today is the last day".
    const campaign = campaignAt("2026-07-30T12:00:00.000Z")!;
    expect((campaign as { daysRemaining: number | null }).daysRemaining).toBeNull();
  });

  it("expires at Chicago midnight, not UTC midnight", () => {
    // 2026-07-31 23:59:59.999 Chicago is 2026-08-01 04:59:59.999Z.
    expect(campaignAt("2026-08-01T04:59:59.999Z")!.phase).toBe("active");
    expect(campaignAt("2026-08-01T05:00:00.000Z")!.phase).toBe("expired");
  });

  it("is upcoming before the window opens", () => {
    expect(campaignAt("2026-05-15T12:00:00.000Z")!.phase).toBe("upcoming");
  });
});
