/** @jest-environment node */
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract";
import {
  recordFreeCheckCompletion,
  resolveFreeCheckMeasurementAttribution,
} from "@/lib/analytics/free-check-measurement";
import { exportFreeCheckMeasurement } from "@/lib/analytics/free-check-measurement-report";
jest.mock("@/lib/attribution/registry", () => ({
  ...jest.requireActual("@/lib/attribution/registry"),
  shippedAttributionRegistry: () => ({
    version: "synthetic_v1",
    campaigns: [{ campaignCode: "synth_campaign", creativeCodes: ["synth_a"] }],
  }),
}));
const db = { $executeRaw: jest.fn(), $queryRaw: jest.fn() };
const input = {
  body: {
    attributionCampaignCode: "synth_campaign",
    attributionCreativeCode: "synth_a",
  },
  outcome: canonicalFreeCheckOutcome("supportive", "window_not_open"),
  windowStatus: "closed",
  preview: false,
};
const original = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env.OT_FREE_CHECK_MEASUREMENT_ENABLED = "1";
  process.env.VERCEL_ENV = "production";
  db.$executeRaw.mockResolvedValue(1);
});
afterAll(() => {
  process.env = original;
});
it("default off makes no DB call; preview, sample and invalid outcomes excluded", async () => {
  delete process.env.OT_FREE_CHECK_MEASUREMENT_ENABLED;
  expect(await recordFreeCheckCompletion(input, db)).toBe("disabled");
  process.env.OT_FREE_CHECK_MEASUREMENT_ENABLED = "1";
  expect(await recordFreeCheckCompletion({ ...input, preview: true }, db)).toBe(
    "excluded",
  );
  process.env.VERCEL_ENV = "preview";
  expect(await recordFreeCheckCompletion(input, db)).toBe("excluded");
  process.env.VERCEL_ENV = "production";
  expect(
    await recordFreeCheckCompletion(
      { ...input, outcome: { code: "supportive", allowCheckout: true } },
      db,
    ),
  ).toBe("excluded");
  expect(db.$executeRaw).not.toHaveBeenCalled();
});
it("persists only approved codes and canonical server outcome, not private request fields", async () => {
  expect(
    await recordFreeCheckCompletion(
      {
        ...input,
        body: {
          ...input.body,
          pin: "18062140010000",
          address: "PRIVATE",
          utm_campaign: "PRIVATE",
          email: "PRIVATE",
        },
      },
      db,
    ),
  ).toBe("recorded");
  const values = db.$executeRaw.mock.calls[0].slice(1);
  expect(values).toContain("synth_campaign");
  expect(values).toContain("supportive");
  expect(values).toContain(false);
  expect(JSON.stringify(values)).not.toMatch(/PRIVATE|18062140010000/);
});
it.each([
  { attributionCampaignCode: "18062140010000" },
  { attributionCampaignCode: "a@b.com" },
  { attributionCreativeCode: "synth_a" },
  { attributionCampaignCode: null },
  { attributionCampaignCode: [] },
  {
    attributionCampaignCode: "synth_campaign",
    attributionCreativeCode: "other",
  },
])("rejects unknown/malformed pair without storing raw input: %p", (body) => {
  const result = resolveFreeCheckMeasurementAttribution(body);
  expect(result.state).toBe("unknown");
  expect(result.campaign).toBeNull();
  expect(result.creative).toBeNull();
});
it("does not infer organic from absence, untagged observation is a separate state", () => {
  expect(resolveFreeCheckMeasurementAttribution({}).state).toBe("unknown");
  expect(
    resolveFreeCheckMeasurementAttribution({
      freeCheckAttributionObservation: "untagged",
    }).state,
  ).toBe("untagged_request");
});
it("counts repeated evaluations independently; no client supplied id/outcome can overwrite", async () => {
  await recordFreeCheckCompletion(
    {
      ...input,
      body: {
        ...input.body,
        completionId: "forged",
        outcome: { allowCheckout: true },
      },
    },
    db,
  );
  await recordFreeCheckCompletion(input, db);
  expect(db.$executeRaw.mock.calls[0][1]).not.toBe(
    db.$executeRaw.mock.calls[1][1],
  );
  expect(JSON.stringify(db.$executeRaw.mock.calls)).not.toContain("forged");
});
it("failure is unavailable, logs no exception content, no automatic retry", async () => {
  const log = jest.spyOn(console, "warn").mockImplementation(() => {});
  db.$executeRaw.mockRejectedValue(new Error("PRIVATE SQL"));
  expect(await recordFreeCheckCompletion(input, db)).toBe("unavailable");
  expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
  log.mockRestore();
});
it("exports provenance and supportive separately from checkout eligibility, never fills missing as zero", async () => {
  db.$queryRaw.mockResolvedValue([
    {
      attribution_state: "campaign",
      campaign_code: "synth_campaign",
      creative_code: "synth_a",
      registry_version: "synthetic_v1",
      completed: "5",
      supportive: "3",
      allow_checkout: "0",
    },
  ]);
  const report = await exportFreeCheckMeasurement(
    db,
    new Date("2026-11-03"),
    new Date("2026-11-04"),
  );
  expect(report.status).toBe("available");
  expect(report.groups?.[0]).toMatchObject({
    completed: 5,
    supportive: 3,
    allowCheckout: 0,
  });
  expect(report).toMatchObject({
    organicCount: null,
    missingMeasurementCount: null,
    deduplicatedPeople: false,
  });
  db.$queryRaw.mockRejectedValue(new Error("PRIVATE"));
  expect(
    await exportFreeCheckMeasurement(
      db,
      new Date("2026-11-03"),
      new Date("2026-11-04"),
    ),
  ).toMatchObject({ status: "unavailable", groups: null });
});

it("bounded wait reports uncertain persistence rather than blocking the result", async () => {
  jest.useFakeTimers();
  const log = jest.spyOn(console, "warn").mockImplementation(() => {});
  db.$executeRaw.mockReturnValue(new Promise(() => {}));
  const pending = recordFreeCheckCompletion(input, db);
  await jest.advanceTimersByTimeAsync(750);
  expect(await pending).toBe("unavailable");
  expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  log.mockRestore();
  jest.useRealTimers();
});
it("report refuses impossible counts and malformed provenance rather than echoing raw fields", async () => {
  db.$queryRaw.mockResolvedValue([
    {
      attribution_state: "unknown",
      campaign_code: "PRIVATE@a.com",
      creative_code: null,
      registry_version: "synthetic_v1",
      completed: "0",
      supportive: "1",
      allow_checkout: "0",
    },
  ]);
  expect(
    await exportFreeCheckMeasurement(
      db,
      new Date("2026-11-03"),
      new Date("2026-11-04"),
    ),
  ).toMatchObject({ status: "unavailable", groups: null });
});
