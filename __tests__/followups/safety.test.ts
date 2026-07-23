import { followupDeliveryEnabled, normalizeUsPhone } from "@/lib/followups/config";
import { buildFollowupSchedule } from "@/lib/followups/schedule";
import { parseSmsKeyword } from "@/lib/followups/sms";
import { buildFollowupEmail } from "@/lib/followups/templates";

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

  it("uses official published deadlines and includes unsubscribe", () => {
    const email = buildFollowupEmail({
      step: "FINAL",
      township: "Stickney",
      resultUrl: "https://www.overtaxed-il.com/#hero-check",
      unsubscribeUrl: "https://www.overtaxed-il.com/api/followups/unsubscribe?token=test",
    });
    expect(email?.subject).toContain("August 12, 2026");
    expect(email?.text).toContain("Unsubscribe:");
    expect(email?.text).toContain("opted in to email follow-up");
    expect(email?.text).toContain("file directly with the Cook County Assessor at no charge");
    expect(email?.text).not.toMatch(/guaranteed savings|keep 100%/i);
  });

  it("keeps every email single-purpose and avoids unsafe legal or outcome claims", () => {
    for (const step of ["RESULT", "DAY_1", "DAY_3", "FINAL"]) {
      const email = buildFollowupEmail({
        step,
        township: "Cicero",
        address: "1234 W Sample St",
        resultUrl: "https://www.overtaxed-il.com/#hero-check",
        unsubscribeUrl: "https://www.overtaxed-il.com/api/followups/unsubscribe?token=test",
      });
      expect(email).not.toBeNull();
      expect(email?.text).toContain("Unsubscribe:");
      expect(email?.text).not.toMatch(/we will file|we provide legal advice|guaranteed reduction|keep 100%/i);
      expect((email?.html.match(/<a /g) ?? []).length).toBe(2);
    }
  });
});
