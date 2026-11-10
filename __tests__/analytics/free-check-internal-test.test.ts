/** @jest-environment node */
// Internal-test provenance: only a verified ADMIN session plus an explicit
// marker, behind a default-OFF flag, keeps an evaluation out of the customer
// ledger. Synthetic values only; no session secret, PII or Production setting.
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
jest.mock("@/lib/analytics/free-check-measurement-runtime", () => ({
  withMeasurementClient: async (run: (db: unknown) => Promise<unknown>) =>
    run(jest.requireMock("@/lib/db/prisma").prisma),
}));
jest.mock("@/lib/fulfillment-runtime/free-comparison", () => ({
  readFreeComparison: async () => ({ ok: false, blocker: "TEST_NOT_STUBBED" }),
}));
jest.mock("@/lib/auth/session", () => ({ getSession: jest.fn() }));
import { POST } from "@/app/api/free-check/route";
import { prisma } from "@/lib/db/prisma";
import { getPropertyByPIN } from "@/lib/cook-county";
import { getSession } from "@/lib/auth/session";
import { exportFreeCheckMeasurement } from "@/lib/analytics/free-check-measurement-report";

const original = { ...process.env };
const write = prisma.$executeRaw as jest.Mock;
const session = getSession as jest.Mock;
const req = (body: unknown) =>
  ({
    headers: { get: () => "overtaxed-il.com" },
    json: async () => body,
  }) as unknown as Parameters<typeof POST>[0];
const ADMIN = { user: { id: "synthetic-admin", role: "ADMIN" } };
const MARKED = { pin: "18062140010000", freeCheckInternalTest: "requested" };

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    OT_FREE_CHECK_MEASUREMENT_ENABLED: "1",
    OT_FREE_CHECK_INTERNAL_TEST_CLASSIFICATION_ENABLED: "1",
  });
  delete process.env.OT_FORCE_PREVIEW_STUB;
  delete process.env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB;
  (getPropertyByPIN as jest.Mock).mockResolvedValue({
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
  session.mockResolvedValue(ADMIN);
});
afterAll(() => {
  process.env = original;
});

it("verified ADMIN + explicit marker is internal_test: same result, no ledger row", async () => {
  const body = await (await POST(req(MARKED))).json();
  expect(body.success).toBe(true);
  expect(body.outcome.code).toBe("insufficient_evidence");
  expect(body.measurement).toBe("internal_test");
  expect(write).not.toHaveBeenCalled();
});

it("flag OFF (default): marker is ignored and the session is never read", async () => {
  delete process.env.OT_FREE_CHECK_INTERNAL_TEST_CLASSIFICATION_ENABLED;
  const body = await (await POST(req(MARKED))).json();
  expect(body.measurement).toBe("recorded");
  expect(session).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledTimes(1);
});

it.each([
  ["no session", null],
  ["non-admin role", { user: { id: "synthetic-user", role: "USER" } }],
  ["admin role without id", { user: { role: "ADMIN" } }],
])("a client claim with %s grants nothing and is measured normally", async (_, s) => {
  session.mockResolvedValue(s);
  const body = await (await POST(req(MARKED))).json();
  expect(body.measurement).toBe("recorded");
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0].slice(1)).not.toContain("internal_test");
});

it("a session read failure is not an admin session", async () => {
  session.mockRejectedValue(new Error("PRIVATE"));
  expect((await (await POST(req(MARKED))).json()).measurement).toBe("recorded");
  expect(write).toHaveBeenCalledTimes(1);
});

it.each([[true], ["1"], ["REQUESTED"], [undefined]])(
  "ADMIN without the exact marker (%p) is measured as a customer completion",
  async (marker) => {
    const body = await (
      await POST(req({ pin: "18062140010000", freeCheckInternalTest: marker }))
    ).json();
    expect(body.measurement).toBe("recorded");
    expect(write).toHaveBeenCalledTimes(1);
  },
);

it("disabled ledger and Preview keep their existing status for internal tests", async () => {
  process.env.VERCEL_ENV = "preview";
  expect((await (await POST(req(MARKED))).json()).measurement).toBe("excluded");
  process.env.VERCEL_ENV = "production";
  delete process.env.OT_FREE_CHECK_MEASUREMENT_ENABLED;
  expect((await (await POST(req(MARKED))).json()).measurement).toBe("disabled");
  expect(write).not.toHaveBeenCalled();
});

it("export never labels existing rows customer or organic; no relabel query", async () => {
  const queryRaw = jest.fn().mockResolvedValue([
    {
      attribution_state: "unknown",
      campaign_code: null,
      creative_code: null,
      registry_version: "ot-attribution-v1",
      completed: "3",
      supportive: "0",
      allow_checkout: "0",
    },
  ]);
  const result = await exportFreeCheckMeasurement(
    { $queryRaw: queryRaw, $executeRaw: jest.fn() } as never,
    new Date("2026-11-01T00:00:00Z"),
    new Date("2026-11-09T00:00:00Z"),
  );
  expect(result.status).toBe("available");
  expect(result.groups?.[0]).toMatchObject({ attributionState: "unknown", completed: 3 });
  expect(result.organicCount).toBeNull();
  expect(result.internalTestRows).toBe("not_persisted_when_classified");
  expect(result.customerProvenance).toBe(
    "unverified_rows_may_include_unclassified_tests",
  );
  const sql = (queryRaw.mock.calls[0][0] as string[]).join("?");
  expect(sql).not.toMatch(/UPDATE|DELETE|INSERT/i);
});
