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

  it.each([
    [
      "cicero",
      "2026-07-31",
      "2026-08-01T04:59:59.999Z",
      "2026-08-01T05:00:00.000Z",
    ],
    [
      "elk-grove",
      "2026-08-04",
      "2026-08-05T04:59:59.999Z",
      "2026-08-05T05:00:00.000Z",
    ],
    [
      "stickney",
      "2026-08-12",
      "2026-08-13T04:59:59.999Z",
      "2026-08-13T05:00:00.000Z",
    ],
    [
      "west-chicago",
      "2026-08-21",
      "2026-08-22T04:59:59.999Z",
      "2026-08-22T05:00:00.000Z",
    ],
  ])(
    "uses official deadline and expires %s at Chicago midnight",
    (slug, deadline, justBeforeMidnight, midnight) => {
      const active = getActiveTownshipCampaign(
        slug,
        new Date(justBeforeMidnight),
      )!;
      const expired = getActiveTownshipCampaign(slug, new Date(midnight))!;
      expect(active.lastFileDate).toBe(deadline);
      expect(active.phase).toBe("active");
      expect(expired.phase).toBe("expired");
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
