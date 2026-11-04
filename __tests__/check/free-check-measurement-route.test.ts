/** @jest-environment node */
jest.mock("@/lib/cook-county", () => ({
  getPropertyByPIN: jest.fn(),
  searchPropertiesByAddress: jest.fn(),
  getComparableSales: jest.fn(),
  getComparableEquity: jest.fn(),
  formatPIN: (v: string) => v,
  normalizePIN: (v: string) => v,
  isValidPIN: () => true,
  ADDRESS_LOOKUP_UNAVAILABLE: "unavailable",
}));
jest.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ allowed: true }),
  getClientIdentifier: () => "synthetic",
}));
jest.mock("@/lib/db/prisma", () => ({
  prisma: { $executeRaw: jest.fn(), $queryRaw: jest.fn() },
}));
import { POST } from "@/app/api/free-check/route";
import { prisma } from "@/lib/db/prisma";
import {
  getComparableSales,
  getComparableEquity,
  getPropertyByPIN,
} from "@/lib/cook-county";
const original = { ...process.env };
const write = prisma.$executeRaw as jest.Mock;
const lookup = getPropertyByPIN as jest.Mock;
const req = (body: unknown) =>
  ({
    headers: { get: () => "overtaxed-il.com" },
    json: async () => body,
  }) as unknown as Parameters<typeof POST>[0];
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    OT_FREE_CHECK_MEASUREMENT_ENABLED: "1",
  });
  delete process.env.OT_FORCE_PREVIEW_STUB;
  delete process.env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB;
  lookup.mockResolvedValue({
    success: true,
    data: {
      pin: "18062140010000",
      address: "SYNTHETIC",
      city: "Chicago",
      county: "Cook",
      township: "Lake View",
      assessedTotalValue: 0,
      assessmentHistory: [],
      buildingClass: "2-03",
    },
  });
  write.mockResolvedValue(1);
});
afterAll(() => {
  process.env = original;
});
it("real route records server evaluated no-value outcome and ignores forged client outcome", async () => {
  const response = await POST(
    req({
      pin: "18062140010000",
      outcome: { code: "supportive", allowCheckout: true },
      attributionCampaignCode: "private@example.com",
    }),
  );
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.outcome.code).toBe("insufficient_evidence");
  expect(body.measurement).toBe("recorded");
  const values = write.mock.calls[0].slice(1);
  expect(values).toContain("unknown");
  expect(values).toContain("no_assessed_value");
  expect(values).toContain(false);
  expect(JSON.stringify(values)).not.toMatch(
    /18062140010000|SYNTHETIC|private@example/,
  );
});
it("storage failure preserves successful county result but exposes unavailable measurement", async () => {
  const log = jest.spyOn(console, "warn").mockImplementation(() => {});
  write.mockRejectedValue(new Error("PRIVATE"));
  const response = await POST(req({ pin: "18062140010000" }));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.measurement).toBe("unavailable");
  expect(body.outcome.code).toBe("insufficient_evidence");
  log.mockRestore();
});
it("sample address, forced preview and Vercel Preview never write", async () => {
  await POST(req({ address: "123 S Sample Ave" }));
  expect(write).not.toHaveBeenCalled();
  process.env.OT_FORCE_PREVIEW_STUB = "true";
  await POST(req({ pin: "18062140010000" }));
  expect(write).not.toHaveBeenCalled();
  delete process.env.OT_FORCE_PREVIEW_STUB;
  process.env.VERCEL_ENV = "preview";
  const body = await (await POST(req({ pin: "18062140010000" }))).json();
  expect(body.measurement).toBe("excluded");
  expect(write).not.toHaveBeenCalled();
});
it("disabled gate never reads DB; two separate successful HTTP evaluations count twice", async () => {
  delete process.env.OT_FREE_CHECK_MEASUREMENT_ENABLED;
  expect(
    await (await POST(req({ pin: "18062140010000" }))).json(),
  ).toMatchObject({ measurement: "disabled" });
  expect(write).not.toHaveBeenCalled();
  process.env.OT_FREE_CHECK_MEASUREMENT_ENABLED = "1";
  await POST(req({ pin: "18062140010000" }));
  await POST(req({ pin: "18062140010000" }));
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[0][1]).not.toBe(write.mock.calls[1][1]);
});

it("main successful branch records only its evaluated outcome", async () => {
  const record = (await lookup()).data;
  lookup.mockResolvedValue({
    success: true,
    data: { ...record, assessedTotalValue: 42500, marketValue: 425000 },
  });
  (getComparableSales as jest.Mock).mockResolvedValue({
    success: true,
    data: [],
  });
  (getComparableEquity as jest.Mock).mockResolvedValue({
    success: true,
    data: [],
  });
  const response = await POST(
    req({ pin: "18062140010000", freeCheckAttributionObservation: "untagged" }),
  );
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.measurement).toBe("recorded");
  expect(write.mock.calls[0].slice(1)).toContain(body.outcome.code);
  expect(write.mock.calls[0].slice(1)).toContain("untagged_request");
});

describe("non-canonical Production hosts", () => {
  const reqFrom = (headers: Record<string, string>, body: unknown) =>
    ({
      headers: { get: (name: string) => headers[name] ?? null },
      json: async () => body,
    }) as unknown as Parameters<typeof POST>[0];
  const branches = {
    "no-assessed-value": async () => undefined,
    main: async () => {
      const record = (await lookup()).data;
      lookup.mockResolvedValue({
        success: true,
        data: { ...record, assessedTotalValue: 42500, marketValue: 425000 },
      });
      (getComparableSales as jest.Mock).mockResolvedValue({
        success: true,
        data: [],
      });
      (getComparableEquity as jest.Mock).mockResolvedValue({
        success: true,
        data: [],
      });
    },
  };
  const cases = Object.keys(branches) as (keyof typeof branches)[];
  const outcomeOf = async (headers: Record<string, string>) => {
    const response = await POST(
      reqFrom(headers, {
        pin: "18062140010000",
        freeCheckAttributionObservation: "untagged",
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.outcome).toBeDefined();
    return body.measurement;
  };

  describe.each(cases)("%s success branch", (branch) => {
    beforeEach(() => branches[branch]());
    it.each([
      [{ host: "ot-abc123.vercel.app" }],
      [{ "x-forwarded-host": "ot-abc123.vercel.app" }],
      [{ "x-forwarded-host": "ot-abc123.vercel.app", host: "overtaxed-il.com" }],
      [{ host: "overtaxed-il.com.evil.example" }],
      [{}],
    ])("excludes %j and writes nothing", async (headers) => {
      expect(await outcomeOf(headers)).toBe("excluded");
      expect(write).not.toHaveBeenCalled();
    });
    it.each([
      [{ host: "overtaxed-il.com" }],
      [{ host: "www.overtaxed-il.com" }],
      [{ "x-forwarded-host": "WWW.OVERTAXED-IL.COM:443" }],
    ])("records canonical %j", async (headers) => {
      expect(await outcomeOf(headers)).toBe("recorded");
      expect(write).toHaveBeenCalledTimes(1);
    });
  });

  it("a fixed unknown client observation is stored as unknown, not untagged", async () => {
    await POST(
      reqFrom(
        { host: "overtaxed-il.com" },
        { pin: "18062140010000", freeCheckAttributionObservation: "unknown" },
      ),
    );
    const values = write.mock.calls[0].slice(1);
    expect(values).toContain("unknown");
    expect(values).not.toContain("untagged_request");
  });
});
