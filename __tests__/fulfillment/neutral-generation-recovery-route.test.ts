/** @jest-environment node */
const sweep = jest.fn(async () => ({
  reviewed: 3,
  completed: 1,
  failed: 0,
  deferred: 2,
}));
jest.mock("@/lib/fulfillment-runtime/neutral-generation-recovery", () => ({
  sweepNeutralReportGeneration: () => sweep(),
}));
import { GET } from "@/app/api/cron/neutral-report-production/route";

const request = (authorization?: string) =>
  new Request("https://example.test/api/cron/neutral-report-production", {
    headers: authorization ? { authorization } : {},
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.CRON_SECRET;
});

test("route fails closed unless CRON_SECRET is configured and exact", async () => {
  expect((await GET(request())).status).toBe(401);
  process.env.CRON_SECRET = "synthetic-secret";
  expect((await GET(request("Bearer wrong"))).status).toBe(401);
  expect(sweep).not.toHaveBeenCalled();
});

test("authorized route invokes the bounded sweep", async () => {
  process.env.CRON_SECRET = "synthetic-secret";
  const response = await GET(request("Bearer synthetic-secret"));
  expect(response.status).toBe(200);
  // The bounded sweep reports what it deferred as well as what it ran, so an
  // invocation that runs out of wall budget is visible rather than silent.
  expect(await response.json()).toEqual({
    ok: true,
    reviewed: 3,
    completed: 1,
    failed: 0,
    deferred: 2,
  });
  expect(sweep).toHaveBeenCalledTimes(1);
});
