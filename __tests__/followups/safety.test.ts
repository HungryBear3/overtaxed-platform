import { followupDeliveryEnabled, normalizeUsPhone } from "@/lib/followups/config";
import { buildFollowupSchedule } from "@/lib/followups/schedule";
import { parseSmsKeyword } from "@/lib/followups/sms";
import { buildFollowupEmail } from "@/lib/followups/templates";
import {
  evaluateOfficialDeadlineState,
  projectDeadline,
  type OfficialDeadlineSnapshot,
} from "@/lib/deadlines/official-source-state";
import type { TownshipResolution } from "@/lib/deadlines/township-resolution";

describe("free-check follow-up safety", () => {
  it("defaults delivery off and requires exact production activation", () => {
    expect(followupDeliveryEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(followupDeliveryEnabled({ NODE_ENV: "test", OT_FREE_CHECK_FOLLOWUPS_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(followupDeliveryEnabled({ NODE_ENV: "production", OT_FREE_CHECK_FOLLOWUPS_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(followupDeliveryEnabled({ NODE_ENV: "production", OT_FREE_CHECK_FOLLOWUPS_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("normalizes valid US phones and rejects invalid numbers", () => {
    expect(normalizeUsPhone("(312) 555-0123")).toBe("+13125550123");
    expect(normalizeUsPhone("+1 312 555 0123")).toBe("+13125550123");
    expect(normalizeUsPhone("123")).toBeNull();
    expect(normalizeUsPhone("0125550123")).toBeNull();
  });

  it("email consent does not imply an SMS step", () => {
    const schedule = buildFollowupSchedule({
      subscriberId: "sub_1",
      township: "Cicero",
      smsConsented: false,
      now: new Date("2026-07-23T12:00:00-05:00"),
    });
    expect(schedule.some((item) => item.channel === "SMS")).toBe(false);
    expect(new Set(schedule.map((item) => item.idempotencyKey)).size).toBe(schedule.length);
  });

  it("does not schedule final reminders for closed or unpublished deadlines", () => {
    const closed = buildFollowupSchedule({
      subscriberId: "sub_closed", township: "Maine", smsConsented: true,
      now: new Date("2026-07-23T12:00:00-05:00"),
    });
    const unpublished = buildFollowupSchedule({
      subscriberId: "sub_pending", township: "Bremen", smsConsented: true,
      now: new Date("2026-07-23T12:00:00-05:00"),
    });
    expect(closed.some((item) => item.step === "FINAL" || item.channel === "SMS")).toBe(false);
    expect(unpublished.some((item) => item.step === "FINAL" || item.channel === "SMS")).toBe(false);
  });

  it("parses STOP/START/HELP without coupling email consent", () => {
    expect(parseSmsKeyword(" stop ")).toBe("STOP");
    expect(parseSmsKeyword("UNSUBSCRIBE now")).toBe("STOP");
    expect(parseSmsKeyword("start")).toBe("START");
    expect(parseSmsKeyword("help")).toBe("HELP");
    expect(parseSmsKeyword("hello")).toBe("UNKNOWN");
  });

  it("names no date when no projection verified the window", () => {
    // Was: `expect(email?.subject).toContain("August 12, 2026")` — a date read
    // from the hard-coded 2026 map by township name. `buildFollowupEmail` no
    // longer performs a lookup; the caller passes a projection, so a template
    // with no projection has no date to name and must not invent one.
    const email = buildFollowupEmail({
      step: "FINAL",
      township: "Stickney",
      resultUrl: "https://www.overtaxed-il.com/#hero-check",
      unsubscribeUrl: "https://www.overtaxed-il.com/api/followups/unsubscribe?token=test",
    });
    expect(email).not.toBeNull();
    expect(email!.subject).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(email!.text).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(email!.text).toContain("Unsubscribe:");
    expect(email!.text).not.toMatch(/guaranteed savings|keep 100%/i);
  });

  describe("with a projection", () => {
    const RETRIEVED = "2026-08-04T11:59:55.000Z";
    const NOW = "2026-08-04T12:00:00.000Z";
    const source = {
      authority: "cook_county_assessor" as const,
      sourceUrl:
        "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      retrievedAt: RETRIEVED,
      sourceUpdatedAt: null,
      contentSha256: "d".repeat(64),
      httpStatus: 200,
      finalUrl:
        "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      parseStatus: "ok" as const,
      parserVersion: "1.0.0",
    };
    const snapshot: OfficialDeadlineSnapshot = {
      schemaVersion: 1,
      synthetic: false,
      sources: { assessor: source, bor: source },
      townships: {
        stickney: {
          townshipName: "Stickney",
          stages: {
            assessor: {
              noticeDate: "2026-07-01",
              openDate: "2026-07-14",
              lastFileDate: "2026-08-12",
            },
          },
        },
      },
    };
    const resolution: TownshipResolution = {
      inputKind: "pin",
      normalizedPin: "19064010250000",
      normalizedAddress: null,
      townshipKey: "stickney",
      townshipName: "Stickney",
      resolutionSource: "official_property_record",
      resolvedAt: RETRIEVED,
    };

    function projectionAt(now: string) {
      return projectDeadline(
        evaluateOfficialDeadlineState({
          snapshot,
          township: resolution,
          stage: "assessor",
          evaluatedAt: now,
        }),
        now,
      );
    }

    it("names the verified last-file date and still carries unsubscribe", () => {
      const email = buildFollowupEmail({
        step: "FINAL",
        township: "Stickney",
        resultUrl: "https://www.overtaxed-il.com/#hero-check",
        unsubscribeUrl:
          "https://www.overtaxed-il.com/api/followups/unsubscribe?token=test",
        deadline: projectionAt(NOW),
      });
      expect(email?.subject).toContain("August 12, 2026");
      expect(email?.text).toContain("Unsubscribe:");
      expect(email?.text).not.toMatch(/guaranteed savings|keep 100%/i);
    });

    it("falls back to the dateless variant once the window has closed", () => {
      // `allowDeadlineEmail` is false for a closed window, so a scheduled send
      // that lands late cannot mail a deadline that has already passed.
      const closed = projectionAt("2026-08-13T12:00:00.000Z");
      const email = buildFollowupEmail({
        step: "FINAL",
        township: "Stickney",
        resultUrl: "https://www.overtaxed-il.com/#hero-check",
        unsubscribeUrl:
          "https://www.overtaxed-il.com/api/followups/unsubscribe?token=test",
        deadline: closed,
      });
      expect(email!.subject).not.toContain("August 12, 2026");
      expect(email!.text).not.toContain("August 12, 2026");
    });
  });
});
